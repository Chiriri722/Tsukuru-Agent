import fs from 'fs';
import path from 'path';
import { finished } from 'stream/promises';
import * as asar from '@electron/asar';
import {
    archiveEntryCollisionKey,
    assertOutsidePath,
    assertSafeArchiveEntries,
    isUnsafeArchiveEntry,
    isWithinPath,
    normalizeArchiveEntry,
} from '../archivePolicy';
import { detectContainerEngine, findNestedEngineRoot } from '../engineDetection';
import { assertNoSymbolicLinks, copyTreeWithoutLinks, isDirectory, sha256File } from '../fileSystemPolicy';
import {
    ArchiveInspection,
    ContainerFormatAdapter,
    ContainerInfo,
    ContainerLimits,
    effectiveContainerLimits,
} from '../types';
import { findLinkedPathComponent } from '../../pathSafety';

export function normalizeAsarListedEntry(value: string): string {
    return value.startsWith('\\') || value.startsWith('/') ? value.slice(1) : value;
}

type AsarRawHeader = ReturnType<typeof asar.getRawHeader> | null;

type AsarEntryAssessment =
    | { kind: 'directory' }
    | { kind: 'file'; size: number; unpacked: boolean }
    | { kind: 'invalid'; unsafeLink: boolean };

interface AsarInspectionState {
    validEntries: string[];
    invalidEntries: string[];
    fileEntries: string[];
    unpackedEntries: string[];
    fileCount: number;
    directoryCount: number;
    totalBytes: number;
    unsafeLinkCount: number;
}

function readAsarHeader(archivePath: string): {
    rawHeader: AsarRawHeader;
    integrity: ArchiveInspection['integrity'];
} {
    try {
        const rawHeader = asar.getRawHeader(archivePath);
        const integrity = JSON.stringify(rawHeader.header).includes('"integrity"') ? 'present' : 'absent';
        return { rawHeader, integrity };
    } catch {
        return { rawHeader: null, integrity: 'unreadable' };
    }
}

function assessUnpackedEntry(archivePath: string, entry: string, size: number): AsarEntryAssessment {
    const unpackedRoot = path.resolve(archivePath + '.unpacked');
    const unpackedFile = path.resolve(unpackedRoot, ...entry.split('/'));
    const linkedPath = findLinkedPathComponent(unpackedFile);
    if (!isWithinPath(unpackedRoot, unpackedFile) || linkedPath) {
        return { kind: 'invalid', unsafeLink: linkedPath !== null };
    }
    try {
        const unpackedStat = fs.lstatSync(unpackedFile);
        if (unpackedStat.isSymbolicLink()) return { kind: 'invalid', unsafeLink: true };
        if (!unpackedStat.isFile() || unpackedStat.size !== size) {
            return { kind: 'invalid', unsafeLink: false };
        }
    } catch {
        return { kind: 'invalid', unsafeLink: false };
    }
    return { kind: 'file', size, unpacked: true };
}

function assessAsarFile(
    archivePath: string,
    entry: string,
    stat: ReturnType<typeof asar.statFile>,
    rawHeader: AsarRawHeader,
    archiveBytes: number,
): AsarEntryAssessment {
    if (!('size' in stat)) return { kind: 'invalid', unsafeLink: false };
    const size = Number(stat.size);
    const offset = Number(stat.offset ?? 0);
    const finiteMetadata = Number.isSafeInteger(size) && size >= 0
        && Number.isSafeInteger(offset) && offset >= 0;
    const dataStart = rawHeader ? 8 + rawHeader.headerSize : 0;
    const fitsArchive = stat.unpacked === true
        || (rawHeader !== null && finiteMetadata && dataStart + offset + size <= archiveBytes);
    if (!finiteMetadata || !fitsArchive) return { kind: 'invalid', unsafeLink: false };
    return stat.unpacked === true
        ? assessUnpackedEntry(archivePath, entry, size)
        : { kind: 'file', size, unpacked: false };
}

function assessAsarEntry(
    archivePath: string,
    rawEntry: string,
    entry: string,
    rawHeader: AsarRawHeader,
    archiveBytes: number,
): AsarEntryAssessment {
    try {
        const stat = asar.statFile(archivePath, rawEntry, false);
        if ('files' in stat) return { kind: 'directory' };
        if ('link' in stat) return { kind: 'invalid', unsafeLink: true };
        return assessAsarFile(archivePath, entry, stat, rawHeader, archiveBytes);
    } catch {
        return { kind: 'invalid', unsafeLink: false };
    }
}

function recordAsarEntry(
    state: AsarInspectionState,
    entry: string,
    assessment: AsarEntryAssessment,
    limits: ReturnType<typeof effectiveContainerLimits>,
    archivePath: string,
): void {
    if (assessment.kind === 'invalid') {
        if (assessment.unsafeLink) state.unsafeLinkCount++;
        state.invalidEntries.push(entry);
        return;
    }
    if (assessment.kind === 'directory') {
        state.directoryCount++;
        state.validEntries.push(entry);
        return;
    }
    if (assessment.size > limits.maxFileBytes) throw new Error('archive 개별 파일 크기 제한 초과: ' + entry);
    state.fileCount++;
    state.fileEntries.push(entry);
    state.totalBytes += assessment.size;
    if (assessment.unpacked) state.unpackedEntries.push(entry);
    if (state.fileCount > limits.maxFiles) throw new Error('archive 파일 수 제한 초과: ' + archivePath);
    if (state.totalBytes > limits.maxBytes) throw new Error('archive 해제 크기 제한 초과: ' + archivePath);
    state.validEntries.push(entry);
}

function inspectAsarArchive(archivePath: string, limits: ContainerLimits = {}): ArchiveInspection {
    const effectiveLimits = effectiveContainerLimits(limits);
    const archiveBytes = fs.statSync(archivePath).size;
    if (archiveBytes > effectiveLimits.maxBytes) throw new Error('archive 물리 크기 제한 초과: ' + archivePath);
    const { rawHeader, integrity } = readAsarHeader(archivePath);
    const rawListed = asar.listPackage(archivePath, { isPack: false }).filter((entry) => entry.trim() !== '');
    const state: AsarInspectionState = {
        validEntries: [],
        invalidEntries: [],
        fileEntries: [],
        unpackedEntries: [],
        fileCount: 0,
        directoryCount: 0,
        totalBytes: 0,
        unsafeLinkCount: 0,
    };
    const seen = new Set<string>();
    for (const rawEntryValue of rawListed) {
        const rawEntry = normalizeAsarListedEntry(rawEntryValue);
        const entry = normalizeArchiveEntry(rawEntry);
        const collisionKey = archiveEntryCollisionKey(entry);
        if (!entry || isUnsafeArchiveEntry(rawEntry) || seen.has(collisionKey)) {
            state.invalidEntries.push(rawEntry || '<empty>');
            continue;
        }
        seen.add(collisionKey);
        const assessment = assessAsarEntry(archivePath, rawEntry, entry, rawHeader, archiveBytes);
        recordAsarEntry(state, entry, assessment, effectiveLimits, archivePath);
    }
    return {
        path: archivePath,
        entries: state.validEntries,
        fileEntries: state.fileEntries,
        fileCount: state.fileCount,
        directoryCount: state.directoryCount,
        totalBytes: state.totalBytes,
        sha256: sha256File(archivePath),
        integrity,
        invalidEntryCount: state.invalidEntries.length,
        invalidEntries: state.invalidEntries.slice(0, 20),
        unsafeLinkCount: state.unsafeLinkCount,
        unpackedEntries: state.unpackedEntries,
    };
}

function inspectAsar(archivePath: string, rootPath: string, limits: ContainerLimits = {}): ContainerInfo {
    const archive = inspectAsarArchive(archivePath, limits);
    const root = findNestedEngineRoot(archive.entries);
    const engine = detectContainerEngine(archive.entries, root);
    if (engine.type === 'gdevelop' && engine.wrapper === null) engine.wrapper = 'electron';
    if (archive.invalidEntryCount > 0) engine.features.push('asar-invalid-metadata');
    if (archive.unsafeLinkCount > 0) engine.features.push('asar-symbolic-links');
    return {
        type: 'electron-asar',
        rootPath,
        archivePath,
        unpackedPath: archivePath + '.unpacked',
        packagePath: archive.entries.includes('package.json') ? 'package.json' : null,
        archive,
        engine,
        entries: archive.entries,
    };
}

function extractValidAsarEntries(info: ContainerInfo, stagingDir: string): void {
    if (!info.archivePath || !info.archive) throw new Error('ASAR 경로가 없습니다');
    for (const entry of info.archive.entries) {
        const archiveEntry = entry.split('/').join(path.sep);
        const target = path.join(stagingDir, ...entry.split('/'));
        if (!isWithinPath(stagingDir, target)) throw new Error('안전하지 않은 archive 출력 경로입니다: ' + entry);
        const stat = asar.statFile(info.archivePath, archiveEntry, false);
        if ('files' in stat) {
            fs.mkdirSync(target, { recursive: true });
            continue;
        }
        if ('link' in stat) throw new Error('ASAR 심볼릭 링크는 지원하지 않습니다: ' + entry);
        const bytes = asar.extractFile(info.archivePath, archiveEntry, false);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, bytes);
    }
}

function assertAsarExtractable(info: ContainerInfo): void {
    if (!info.archivePath || !info.archive) throw new Error('ASAR 경로가 없습니다');
    const archiveLink = findLinkedPathComponent(info.archivePath);
    if (archiveLink) throw new Error('ASAR 경로에 심볼릭 링크/정션이 있습니다: ' + archiveLink);
    let archiveStat: fs.Stats;
    try {
        archiveStat = fs.lstatSync(info.archivePath);
    } catch {
        throw new Error('ASAR 파일이 더 이상 존재하지 않습니다: ' + info.archivePath);
    }
    if (!archiveStat.isFile()) throw new Error('ASAR 경로가 일반 파일이 아닙니다: ' + info.archivePath);
    if (sha256File(info.archivePath) !== info.archive.sha256) {
        throw new Error('검사 후 ASAR 파일이 변경되었습니다: ' + info.archivePath);
    }
    if (info.archive.unsafeLinkCount > 0) throw new Error('ASAR 심볼릭 링크/정션은 추출할 수 없습니다');
    const unpackedRoot = path.resolve(info.archivePath + '.unpacked');
    for (const entry of info.archive.unpackedEntries) {
        const unpackedFile = path.resolve(unpackedRoot, ...entry.split('/'));
        const linkedPath = findLinkedPathComponent(unpackedFile);
        if (!isWithinPath(unpackedRoot, unpackedFile) || linkedPath) {
            throw new Error('ASAR unpacked 경로에 심볼릭 링크/정션이 있습니다: ' + (linkedPath ?? entry));
        }
        const unpackedStat = fs.lstatSync(unpackedFile);
        const archiveEntry = entry.split('/').join(path.sep);
        const metadata = asar.statFile(info.archivePath, archiveEntry, false);
        if (!unpackedStat.isFile() || !('size' in metadata) || unpackedStat.size !== Number(metadata.size)) {
            throw new Error('ASAR unpacked 파일이 검사 후 변경되었습니다: ' + entry);
        }
    }
    assertSafeArchiveEntries(info.archive.entries);
}

async function extractAsar(info: ContainerInfo, stagingDir: string): Promise<void> {
    if (info.archive.invalidEntryCount > 0) {
        extractValidAsarEntries(info, stagingDir);
        return;
    }
    asar.extractAll(info.archivePath, stagingDir);
}

async function packAsar(info: ContainerInfo, stagingDir: string, outputPath: string): Promise<void> {
    const unpacked = new Set(info.archive?.unpackedEntries ?? []);
    const streams: asar.AsarStreamType[] = [];
    const visit = (current: string, relative: string): void => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (entry.isSymbolicLink()) throw new Error('ASAR staging의 심볼릭 링크/정션은 지원하지 않습니다: ' + path.join(current, entry.name));
            const child = path.join(current, entry.name);
            const childRelative = normalizeArchiveEntry(relative ? path.join(relative, entry.name) : entry.name);
            if (entry.isDirectory()) {
                const directoryUnpacked = [...unpacked].some((file) => file === childRelative || file.startsWith(childRelative + '/'));
                streams.push({ type: 'directory', path: childRelative, unpacked: directoryUnpacked });
                visit(child, childRelative);
            } else if (entry.isFile()) {
                streams.push({
                    type: 'file',
                    path: childRelative,
                    unpacked: unpacked.has(childRelative),
                    stat: fs.statSync(child),
                    streamGenerator: () => fs.createReadStream(child),
                });
            }
        }
    };
    visit(stagingDir, '');
    const outputStream = await asar.createPackageFromStreams(outputPath, streams);
    if (!outputStream.writableFinished) await finished(outputStream);
}

function copyAsarExternalResources(info: ContainerInfo, outputRoot: string): void {
    assertOutsidePath(info.rootPath, outputRoot, 'external output');
    const sourceResources = path.join(info.rootPath, 'resources');
    if (!isDirectory(sourceResources)) return;
    const targetResources = path.join(path.resolve(outputRoot), 'resources');
    fs.mkdirSync(targetResources, { recursive: true });
    for (const entry of fs.readdirSync(sourceResources)) {
        if (entry === 'app.asar' || entry === 'app.asar.unpacked') continue;
        const source = path.join(sourceResources, entry);
        const target = path.join(targetResources, entry);
        copyTreeWithoutLinks(source, target);
    }
    if (info.unpackedPath && isDirectory(info.unpackedPath)) {
        const target = path.join(targetResources, 'app.asar.unpacked');
        copyTreeWithoutLinks(info.unpackedPath, target);
    }
}

export const asarContainerAdapter: ContainerFormatAdapter = Object.freeze({
    type: 'electron-asar',
    inspect: inspectAsar,
    assertExtractable: assertAsarExtractable,
    extract: extractAsar,
    pack: packAsar,
    copyExternalResources: copyAsarExternalResources,
});
