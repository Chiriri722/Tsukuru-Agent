import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import AdmZip from 'adm-zip';
import { removePathBestEffortSync } from '../../atomic';
import { findLinkedPathComponent } from '../../pathSafety';
import {
    archiveEntryCollisionKey,
    assertSafeArchiveEntries,
    isUnsafeArchiveEntry,
    isWithinPath,
    normalizeArchiveEntry,
} from '../archivePolicy';
import { detectContainerEngine, findNestedEngineRoot } from '../engineDetection';
import { copyTreeWithoutLinks, sha256File } from '../fileSystemPolicy';
import { inspectNwAppendedZip } from '../nwjsAppendedZip';
import {
    ArchiveInspection,
    ContainerFormatAdapter,
    ContainerInfo,
    ContainerLimits,
    effectiveContainerLimits,
} from '../types';

function isZipSymbolicLink(entry: AdmZip.IZipEntry): boolean {
    const unixMode = (entry.attr >>> 16) & 0xffff;
    return (unixMode & 0xf000) === 0xa000;
}

function inspectNwArchive(packagePath: string, limits: ContainerLimits = {}): ArchiveInspection {
    const effectiveLimits = effectiveContainerLimits(limits);
    const archiveBytes = fs.statSync(packagePath).size;
    if (archiveBytes > effectiveLimits.maxBytes) throw new Error('package.nw 물리 크기 제한 초과: ' + packagePath);

    const appendedZip = inspectNwAppendedZip(packagePath) ?? undefined;
    const zip = appendedZip
        ? new AdmZip(fs.readFileSync(packagePath).subarray(appendedZip.prefixBytes))
        : new AdmZip(packagePath);
    const entries: string[] = [];
    const fileEntries: string[] = [];
    const invalidEntries: string[] = [];
    const seen = new Set<string>();
    let fileCount = 0;
    let directoryCount = 0;
    let totalBytes = 0;
    let unsafeLinkCount = 0;
    for (const zipEntry of zip.getEntries()) {
        const rawName = zipEntry.entryName;
        const entry = normalizeArchiveEntry(rawName);
        const collisionKey = archiveEntryCollisionKey(entry);
        if (isUnsafeArchiveEntry(rawName) || !entry || seen.has(collisionKey)) {
            invalidEntries.push(rawName || '<empty>');
            continue;
        }
        seen.add(collisionKey);
        if (isZipSymbolicLink(zipEntry)) {
            unsafeLinkCount++;
            invalidEntries.push(entry);
            continue;
        }
        if (zipEntry.isDirectory) {
            directoryCount++;
            entries.push(entry);
            continue;
        }
        const size = Number(zipEntry.header.size);
        if (!Number.isSafeInteger(size) || size < 0) {
            invalidEntries.push(entry);
            continue;
        }
        if (size > effectiveLimits.maxFileBytes) throw new Error('package.nw 개별 파일 크기 제한 초과: ' + entry);
        fileCount++;
        totalBytes += size;
        if (fileCount > effectiveLimits.maxFiles) throw new Error('package.nw 파일 수 제한 초과: ' + packagePath);
        if (totalBytes > effectiveLimits.maxBytes) throw new Error('package.nw 해제 크기 제한 초과: ' + packagePath);
        fileEntries.push(entry);
        entries.push(entry);
    }
    return {
        path: packagePath,
        entries,
        fileEntries,
        fileCount,
        directoryCount,
        totalBytes,
        sha256: sha256File(packagePath),
        integrity: 'present',
        invalidEntryCount: invalidEntries.length,
        invalidEntries: invalidEntries.slice(0, 20),
        unsafeLinkCount,
        unpackedEntries: [],
        appendedZip,
    };
}

function inspectNwDirectory(packagePath: string, limits: ContainerLimits = {}): ArchiveInspection {
    const effectiveLimits = effectiveContainerLimits(limits);
    const entries: string[] = [];
    const fileEntries: string[] = [];
    const invalidEntries: string[] = [];
    const seen = new Set<string>();
    const digest = crypto.createHash('sha256');
    let fileCount = 0;
    let directoryCount = 0;
    let totalBytes = 0;
    let unsafeLinkCount = 0;

    const visit = (current: string, relative: string): void => {
        const children = fs.readdirSync(current, { withFileTypes: true })
            .sort((left, right) => left.name.localeCompare(right.name));
        for (const childEntry of children) {
            const child = path.join(current, childEntry.name);
            const rawRelative = relative ? path.join(relative, childEntry.name) : childEntry.name;
            const normalized = normalizeArchiveEntry(rawRelative);
            const collisionKey = archiveEntryCollisionKey(normalized);
            const stat = fs.lstatSync(child);
            if (isUnsafeArchiveEntry(rawRelative) || !normalized || seen.has(collisionKey)) {
                invalidEntries.push(rawRelative || '<empty>');
                continue;
            }
            seen.add(collisionKey);
            if (stat.isSymbolicLink()) {
                unsafeLinkCount += 1;
                invalidEntries.push(normalized);
                digest.update(`L\0${normalized}\0`);
                continue;
            }
            if (stat.isDirectory()) {
                directoryCount += 1;
                entries.push(normalized);
                digest.update(`D\0${normalized}\0`);
                visit(child, normalized);
                continue;
            }
            if (!stat.isFile()) {
                invalidEntries.push(normalized);
                continue;
            }
            if (stat.size > effectiveLimits.maxFileBytes) throw new Error('directory package.nw 개별 파일 크기 제한 초과: ' + normalized);
            fileCount += 1;
            totalBytes += stat.size;
            if (fileCount > effectiveLimits.maxFiles) throw new Error('directory package.nw 파일 수 제한 초과: ' + packagePath);
            if (totalBytes > effectiveLimits.maxBytes) throw new Error('directory package.nw 전체 크기 제한 초과: ' + packagePath);
            const fileDigest = sha256File(child);
            digest.update(`F\0${normalized}\0${stat.size}\0${fileDigest}\0`);
            fileEntries.push(normalized);
            entries.push(normalized);
        }
    };
    visit(packagePath, '');
    return {
        path: packagePath,
        entries,
        fileEntries,
        fileCount,
        directoryCount,
        totalBytes,
        sha256: digest.digest('hex'),
        integrity: 'present',
        invalidEntryCount: invalidEntries.length,
        invalidEntries: invalidEntries.slice(0, 20),
        unsafeLinkCount,
        unpackedEntries: [],
    };
}

function inspectNw(packagePath: string, rootPath: string, limits: ContainerLimits = {}): ContainerInfo {
    const directoryForm = fs.lstatSync(packagePath).isDirectory();
    const archive = directoryForm
        ? inspectNwDirectory(packagePath, limits)
        : inspectNwArchive(packagePath, limits);
    const root = findNestedEngineRoot(archive.entries);
    const engine = detectContainerEngine(archive.entries, root);
    engine.wrapper = 'nwjs';
    if (directoryForm) engine.features.push('nwjs-directory-form');
    if (archive.appendedZip) {
        engine.features.push('nwjs-appended-zip');
        engine.features.push('nwjs-appended-zip-launch-unverified');
        engine.features.push(archive.appendedZip.signature === 'absent'
            ? 'nwjs-appended-zip-unsigned'
            : (archive.appendedZip.signature === 'present'
                ? 'nwjs-appended-zip-authenticode-present'
                : 'nwjs-appended-zip-signature-invalid'));
    }
    if (archive.invalidEntryCount > 0) engine.features.push('nwjs-invalid-metadata');
    if (archive.unsafeLinkCount > 0) engine.features.push('nwjs-symbolic-links');
    return {
        type: 'nwjs-package',
        rootPath,
        archivePath: packagePath,
        unpackedPath: null,
        packagePath,
        archive,
        engine,
        entries: archive.entries,
    };
}

function assertNwExtractable(info: ContainerInfo): void {
    if (!info.packagePath || !info.archive) throw new Error('유효한 package.nw 경로가 없습니다');
    const linkedPath = findLinkedPathComponent(info.packagePath);
    if (linkedPath) throw new Error('package.nw 경로에 심볼릭 링크/정션이 있습니다: ' + linkedPath);
    let currentStat: fs.Stats;
    try {
        currentStat = fs.lstatSync(info.packagePath);
    } catch {
        throw new Error('package.nw가 더 이상 존재하지 않습니다: ' + info.packagePath);
    }
    const directoryForm = info.engine.features.includes('nwjs-directory-form');
    if (directoryForm) {
        if (!currentStat.isDirectory()) throw new Error('directory package.nw 경로가 변경되었습니다: ' + info.packagePath);
        if (inspectNwDirectory(info.packagePath).sha256 !== info.archive.sha256) {
            throw new Error('검사 후 directory package.nw가 변경되었습니다: ' + info.packagePath);
        }
    } else {
        if (!currentStat.isFile()) throw new Error('package.nw 경로가 일반 파일이 아닙니다: ' + info.packagePath);
        if (sha256File(info.packagePath) !== info.archive.sha256) {
            throw new Error('검사 후 package.nw가 변경되었습니다: ' + info.packagePath);
        }
    }
    if (info.archive.invalidEntryCount > 0 || info.archive.unsafeLinkCount > 0) {
        throw new Error('안전하지 않은 package.nw 항목이 있어 추출할 수 없습니다');
    }
    if (info.archive.appendedZip && !info.archive.appendedZip.safeToRepack) {
        throw new Error(info.archive.appendedZip.reason ?? 'appended ZIP 실행 파일은 안전하게 재패키징할 수 없습니다');
    }
    assertSafeArchiveEntries(info.archive.entries);
}

async function extractNw(info: ContainerInfo, stagingDir: string): Promise<void> {
    if (info.engine.features.includes('nwjs-directory-form')) {
        const sourceRoot = path.resolve(info.packagePath!);
        for (const entry of info.archive!.fileEntries) {
            const source = path.join(sourceRoot, ...entry.split('/'));
            const target = path.join(stagingDir, ...entry.split('/'));
            if (!isWithinPath(sourceRoot, source) || !isWithinPath(stagingDir, target)) {
                throw new Error('안전하지 않은 directory package.nw 경로입니다: ' + entry);
            }
            const stat = fs.lstatSync(source);
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('directory package.nw 파일이 변경되었습니다: ' + entry);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(source, target);
        }
        if (inspectNwDirectory(sourceRoot).sha256 !== info.archive!.sha256) {
            throw new Error('추출 중 directory package.nw가 변경되었습니다');
        }
        return;
    }
    const zip = info.archive?.appendedZip
        ? new AdmZip(fs.readFileSync(info.packagePath).subarray(info.archive.appendedZip.prefixBytes))
        : new AdmZip(info.packagePath);
    for (const zipEntry of zip.getEntries()) {
        const entry = normalizeArchiveEntry(zipEntry.entryName);
        const target = path.join(stagingDir, ...entry.split('/'));
        if (!isWithinPath(stagingDir, target)) throw new Error('안전하지 않은 package.nw 출력 경로입니다: ' + entry);
        if (zipEntry.isDirectory) {
            fs.mkdirSync(target, { recursive: true });
            continue;
        }
        const bytes = zipEntry.getData();
        if (bytes.length !== Number(zipEntry.header.size)) throw new Error('package.nw 파일 크기 검증 실패: ' + entry);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, bytes);
    }
}

async function packNw(info: ContainerInfo, stagingDir: string, outputPath: string): Promise<void> {
    if (info.engine.features.includes('nwjs-directory-form')) {
        const staged = inspectNwDirectory(stagingDir);
        if (staged.invalidEntryCount > 0 || staged.unsafeLinkCount > 0) {
            throw new Error('안전하지 않은 directory package.nw staging은 적용할 수 없습니다');
        }
        try {
            copyTreeWithoutLinks(stagingDir, outputPath, { errorOnExist: true, force: false });
            const output = inspectNwDirectory(outputPath);
            if (output.sha256 !== staged.sha256) throw new Error('directory package.nw 출력 검증에 실패했습니다');
        } catch (error) {
            removePathBestEffortSync(outputPath, { recursive: true, force: true });
            throw error;
        }
        return;
    }
    const zip = new AdmZip({ noSort: true });
    const stagedEntries: Array<{ source: string; archivePath: string; directory: boolean; mode: number }> = [];
    const visit = (current: string, relative: string): void => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (entry.isSymbolicLink()) throw new Error('package.nw staging의 심볼릭 링크/정션은 지원하지 않습니다: ' + path.join(current, entry.name));
            const child = path.join(current, entry.name);
            const childRelative = normalizeArchiveEntry(relative ? path.join(relative, entry.name) : entry.name);
            if (entry.isDirectory()) {
                stagedEntries.push({ source: child, archivePath: childRelative + '/', directory: true, mode: 0o755 });
                visit(child, childRelative);
            } else if (entry.isFile()) {
                const sourceMode = fs.statSync(child).mode;
                stagedEntries.push({
                    source: child,
                    archivePath: childRelative,
                    directory: false,
                    mode: (sourceMode & 0o111) === 0 ? 0o644 : 0o755,
                });
            }
        }
    };
    visit(stagingDir, '');
    stagedEntries.sort((left, right) => Buffer.compare(
        Buffer.from(left.archivePath, 'utf8'),
        Buffer.from(right.archivePath, 'utf8'),
    ));
    for (const entry of stagedEntries) {
        const added = zip.addFile(
            entry.archivePath,
            entry.directory ? Buffer.alloc(0) : fs.readFileSync(entry.source),
            '',
            entry.mode,
        );
        // DOS ZIP time has no timezone. Local midnight yields the same encoded
        // fields in every timezone and decouples output bytes from source mtimes.
        added.header.time = new Date(2000, 0, 1, 0, 0, 0, 0);
    }
    const appended = info.archive?.appendedZip;
    if (!appended) {
        zip.writeZip(outputPath);
        return;
    }
    if (!appended.safeToRepack || !info.packagePath) {
        throw new Error(appended.reason ?? 'appended ZIP 실행 파일은 안전하게 재패키징할 수 없습니다');
    }
    const zipPart = `${outputPath}.zip-part-${process.pid}-${crypto.randomUUID()}`;
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let sourceFd: number | null = null;
    let zipFd: number | null = null;
    let outputFd: number | null = null;
    const copyRange = (inputFd: number, start: number, length: number): void => {
        let position = 0;
        while (position < length) {
            const requested = Math.min(buffer.length, length - position);
            const read = fs.readSync(inputFd, buffer, 0, requested, start + position);
            if (read === 0) throw new Error('appended ZIP 재패키징 중 예기치 않은 EOF가 발생했습니다');
            let written = 0;
            while (written < read) written += fs.writeSync(outputFd!, buffer, written, read - written);
            position += read;
        }
    };
    try {
        zip.writeZip(zipPart);
        sourceFd = fs.openSync(info.packagePath, 'r');
        zipFd = fs.openSync(zipPart, 'r');
        outputFd = fs.openSync(outputPath, 'wx');
        copyRange(sourceFd, 0, appended.prefixBytes);
        copyRange(zipFd, 0, fs.fstatSync(zipFd).size);
        fs.fsyncSync(outputFd);
        fs.closeSync(outputFd);
        outputFd = null;
        const outputLayout = inspectNwAppendedZip(outputPath);
        if (!outputLayout
            || outputLayout.prefixBytes !== appended.prefixBytes
            || outputLayout.prefixSha256 !== appended.prefixSha256
            || !outputLayout.safeToRepack) {
            throw new Error('appended ZIP 출력의 실행 파일 prefix 검증에 실패했습니다');
        }
    } catch (error) {
        removePathBestEffortSync(outputPath, { force: true });
        throw error;
    } finally {
        if (sourceFd !== null) try { fs.closeSync(sourceFd); } catch { /* 원래 pack 결과를 보존한다. */ }
        if (zipFd !== null) try { fs.closeSync(zipFd); } catch { /* 원래 pack 결과를 보존한다. */ }
        if (outputFd !== null) try { fs.closeSync(outputFd); } catch { /* 원래 pack 오류를 보존한다. */ }
        removePathBestEffortSync(zipPart, { force: true });
    }
}

export const nwjsContainerAdapter: ContainerFormatAdapter = Object.freeze({
    type: 'nwjs-package',
    inspect: inspectNw,
    assertExtractable: assertNwExtractable,
    extract: extractNw,
    pack: packNw,
    copyExternalResources: () => undefined,
});
