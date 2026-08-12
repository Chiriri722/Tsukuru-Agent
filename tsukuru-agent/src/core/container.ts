import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { finished } from 'stream/promises';
import * as asar from '@electron/asar';
import AdmZip from 'adm-zip';

export type ContainerType = 'directory' | 'electron-asar' | 'nwjs-package' | 'unknown';
export type EngineType = 'rpgmv' | 'rpgmz' | 'wolf' | 'tyrano' | 'gdevelop' | 'unknown';

export interface ContainerLimits {
    maxFiles?: number;
    maxBytes?: number;
    maxFileBytes?: number;
}

const DEFAULT_CONTAINER_LIMITS: Required<ContainerLimits> = {
    maxFiles: 20000,
    maxBytes: 8 * 1024 * 1024 * 1024,
    maxFileBytes: 2 * 1024 * 1024 * 1024,
};

export interface ArchiveInspection {
    path: string;
    entries: string[];
    fileEntries: string[];
    fileCount: number;
    directoryCount: number;
    totalBytes: number;
    sha256: string;
    integrity: 'present' | 'absent' | 'unreadable';
    invalidEntryCount: number;
    invalidEntries: string[];
    unsafeLinkCount: number;
    unpackedEntries: string[];
}

export interface EngineDetection {
    type: EngineType;
    root: string;
    wrapper: string | null;
    features: string[];
    confidence: number;
}

export interface ContainerInfo {
    type: ContainerType;
    rootPath: string;
    archivePath: string | null;
    unpackedPath: string | null;
    packagePath: string | null;
    archive: ArchiveInspection | null;
    engine: EngineDetection;
    entries: string[];
}

function isDirectory(value: string): boolean {
    try {
        return fs.lstatSync(value).isDirectory();
    } catch {
        return false;
    }
}

function isFile(value: string): boolean {
    try {
        return fs.lstatSync(value).isFile();
    } catch {
        return false;
    }
}

function normalizeEntry(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function isUnsafeArchiveEntry(value: string): boolean {
    const normalized = value.replace(/\\/g, '/');
    if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
        return true;
    }
    return normalized.split('/').some((part) => part === '..');
}

function sha256File(filePath: string): string {
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    const handle = fs.openSync(filePath, 'r');
    try {
        let bytesRead = 0;
        do {
            bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
            if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
        } while (bytesRead > 0);
        return hash.digest('hex');
    } finally {
        fs.closeSync(handle);
    }
}

function walkFiles(root: string, relative = '', limit = 20000, output: string[] = []): string[] {
    const current = relative ? path.join(root, relative) : root;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) {
            throw new Error('심볼릭 링크/정션은 지원하지 않습니다: ' + path.join(current, entry.name));
        }
        const child = relative ? path.join(relative, entry.name) : entry.name;
        if (entry.isDirectory()) {
            walkFiles(root, child, limit, output);
        } else if (entry.isFile()) {
            if (output.length >= limit) throw new Error('파일 수 제한 초과: ' + limit);
            output.push(normalizeEntry(child));
        }
    }
    return output;
}

function hasFile(entries: string[], root: string, relative: string): boolean {
    const prefix = root ? root + '/' : '';
    return entries.includes(prefix + relative);
}

function hasUnder(entries: string[], root: string, predicate: (entry: string) => boolean): boolean {
    const prefix = root ? root + '/' : '';
    return entries.some((entry) => entry.startsWith(prefix) && predicate(entry.slice(prefix.length)));
}

function findNestedRoot(entries: string[]): string {
    const candidates = ['', 'project', 'www', 'game', 'app', 'data'];
    let best = '';
    let bestScore = -1;
    for (const candidate of candidates) {
        let score = 0;
        if (hasUnder(entries, candidate, (e) => e.startsWith('data/') && e.endsWith('.json'))) score += 4;
        if (hasFile(entries, candidate, 'js/rmmz_core.js')) score += 6;
        if (hasFile(entries, candidate, 'index.html')) score += 1;
        if (hasUnder(entries, candidate, (e) => e.startsWith('scenario/') && e.endsWith('.ks'))) score += 5;
        if (score > bestScore || (score > 0 && score === bestScore && candidate.length > best.length)) {
            best = candidate;
            bestScore = score;
        }
    }
    return best;
}

function detectEngine(entries: string[], root: string): EngineDetection {
    const features: string[] = [];
    const hasRpgCore = hasFile(entries, root, 'js/rmmz_core.js');
    const hasRpgData = hasUnder(entries, root, (e) => e.startsWith('data/') && e.endsWith('.json'));
    const hasMvData = hasUnder(entries, root, (e) => e.startsWith('data/') && e.endsWith('.json'));
    const hasWolf = hasFile(entries, root, 'Data.wolf') || hasUnder(entries, root, (e) => e.endsWith('.mps'));
    const hasTyrano = hasUnder(entries, root, (e) => (e.startsWith('scenario/') || e.startsWith('data/scenario/')) && e.endsWith('.ks'));
    const hasGdevelop = hasUnder(entries, root, (e) => /(^|\/)gdjs(\/|$)|(^|\/)libs\/gdjs(\/|$)|(^|\/)code\d*\.js$/.test(e));
    const electronForMz = entries.some((e) => /(^|\/)ElectronForMz\.js$/i.test(e));

    if (hasRpgCore && hasRpgData) {
        if (electronForMz) {
            features.push('electron-for-mz');
        }
        if (entries.some((e) => /(^|\/)plugins\//i.test(e))) {
            features.push('plugins');
        }
        if (entries.some((e) => /live2d|cubism/i.test(e))) {
            features.push('live2d');
        }
        if (entries.some((e) => /effekseer/i.test(e))) {
            features.push('effekseer');
        }
        return {
            type: 'rpgmz',
            root,
            wrapper: electronForMz ? 'ElectronForMZ' : null,
            features,
            confidence: electronForMz ? 0.99 : 0.95,
        };
    }
    if (hasWolf) {
        return { type: 'wolf', root, wrapper: null, features, confidence: 0.9 };
    }
    if (hasTyrano) {
        return { type: 'tyrano', root, wrapper: null, features, confidence: 0.9 };
    }
    if (hasGdevelop) {
        return { type: 'gdevelop', root, wrapper: null, features, confidence: 0.7 };
    }
    if (hasMvData) {
        return { type: 'rpgmv', root, wrapper: null, features, confidence: 0.65 };
    }
    return { type: 'unknown', root, wrapper: null, features, confidence: 0 };
}

function inspectArchive(archivePath: string, limits: ContainerLimits = {}): ArchiveInspection {
    const effectiveLimits = { ...DEFAULT_CONTAINER_LIMITS, ...limits };
    const archiveBytes = fs.statSync(archivePath).size;
    if (archiveBytes > effectiveLimits.maxBytes) {
        throw new Error('archive 물리 크기 제한 초과: ' + archivePath);
    }
    let rawHeader: ReturnType<typeof asar.getRawHeader> | null = null;
    let integrity: ArchiveInspection['integrity'] = 'absent';
    try {
        rawHeader = asar.getRawHeader(archivePath);
        const serialized = JSON.stringify(rawHeader.header);
        integrity = serialized.includes('"integrity"') ? 'present' : 'absent';
    } catch {
        integrity = 'unreadable';
    }
    const rawListed = asar.listPackage(archivePath, { isPack: false })
        .filter((entry) => entry.trim() !== '');
    const validEntries: string[] = [];
    const invalidEntries: string[] = [];
    const fileEntries: string[] = [];
    let unsafeLinkCount = 0;
    const unpackedEntries: string[] = [];
    let fileCount = 0;
    let directoryCount = 0;
    let totalBytes = 0;
    for (const rawEntryValue of rawListed) {
        const entry = normalizeEntry(rawEntryValue);
        if (!entry) continue;
        try {
            const rawEntry = rawEntryValue.replace(/^\\+/, '');
            const stat = asar.statFile(archivePath, rawEntry, false);
            if ('files' in stat) {
                directoryCount++;
                validEntries.push(entry);
            } else if ('link' in stat) {
                unsafeLinkCount++;
                invalidEntries.push(entry);
            } else if ('size' in stat) {
                const size = Number(stat.size);
                const offset = Number(stat.offset ?? 0);
                const dataStart = rawHeader ? 8 + rawHeader.headerSize : 0;
                const finiteMetadata = Number.isSafeInteger(size) && size >= 0
                    && Number.isSafeInteger(offset) && offset >= 0;
                const fitsArchive = stat.unpacked === true
                    || (rawHeader !== null && finiteMetadata && dataStart + offset + size <= archiveBytes);
                if (!finiteMetadata || !fitsArchive) {
                    invalidEntries.push(entry);
                    continue;
                }
                if (size > effectiveLimits.maxFileBytes) throw new Error('archive 개별 파일 크기 제한 초과: ' + entry);
                fileCount++;
                fileEntries.push(entry);
                totalBytes += size;
                if (stat.unpacked === true) unpackedEntries.push(entry);
                if (fileCount > effectiveLimits.maxFiles) throw new Error('archive 파일 수 제한 초과: ' + archivePath);
                if (totalBytes > effectiveLimits.maxBytes) throw new Error('archive 해제 크기 제한 초과: ' + archivePath);
                validEntries.push(entry);
            }
        } catch (err) {
            if (String(err).includes('제한 초과')) throw err;
            invalidEntries.push(entry);
        }
    }
    return {
        path: archivePath,
        entries: validEntries,
        fileEntries,
        fileCount,
        directoryCount,
        totalBytes,
        sha256: sha256File(archivePath),
        integrity,
        invalidEntryCount: invalidEntries.length,
        invalidEntries: invalidEntries.slice(0, 20),
        unsafeLinkCount,
        unpackedEntries,
    };
}

function asarInfo(archivePath: string, rootPath: string, limits: ContainerLimits = {}): ContainerInfo {
    const archive = inspectArchive(archivePath, limits);
    const root = findNestedRoot(archive.entries);
    const engine = detectEngine(archive.entries, root);
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

function isZipSymbolicLink(entry: AdmZip.IZipEntry): boolean {
    const unixMode = (entry.attr >>> 16) & 0xffff;
    return (unixMode & 0xf000) === 0xa000;
}

function inspectNwArchive(packagePath: string, limits: ContainerLimits = {}): ArchiveInspection {
    const effectiveLimits = { ...DEFAULT_CONTAINER_LIMITS, ...limits };
    const archiveBytes = fs.statSync(packagePath).size;
    if (archiveBytes > effectiveLimits.maxBytes) {
        throw new Error('package.nw 물리 크기 제한 초과: ' + packagePath);
    }
    const zip = new AdmZip(packagePath);
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
        const entry = normalizeEntry(rawName);
        if (isUnsafeArchiveEntry(rawName) || !entry || seen.has(entry)) {
            invalidEntries.push(rawName || '<empty>');
            continue;
        }
        seen.add(entry);
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
    };
}

function nwInfo(packagePath: string, rootPath: string, limits: ContainerLimits = {}): ContainerInfo {
    const archive = inspectNwArchive(packagePath, limits);
    const root = findNestedRoot(archive.entries);
    const engine = detectEngine(archive.entries, root);
    engine.wrapper = 'nwjs';
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

export function inspectContainer(projectPath: string, limits: ContainerLimits = {}): ContainerInfo {
    const resolved = path.resolve(projectPath);
    if (isFile(resolved)) {
        if (path.extname(resolved).toLowerCase() === '.asar' || path.basename(resolved).toLowerCase() === 'app.asar') {
            const parent = path.basename(path.dirname(resolved)).toLowerCase() === 'resources'
                ? path.dirname(path.dirname(resolved))
                : path.dirname(resolved);
            return asarInfo(resolved, parent, limits);
        }
        if (path.extname(resolved).toLowerCase() === '.nw' || path.basename(resolved).toLowerCase() === 'package.nw') {
            const parent = path.basename(path.dirname(resolved)).toLowerCase() === 'resources'
                ? path.dirname(path.dirname(resolved))
                : path.dirname(resolved);
            return nwInfo(resolved, parent, limits);
        }
        return {
            type: 'unknown',
            rootPath: path.dirname(resolved),
            archivePath: null,
            unpackedPath: null,
            packagePath: null,
            archive: null,
            engine: { type: 'unknown', root: '', wrapper: null, features: [], confidence: 0 },
            entries: [],
        };
    }
    if (!isDirectory(resolved)) {
        throw new Error('경로가 없습니다: ' + resolved);
    }

    const archiveCandidates = [
        path.join(resolved, 'resources', 'app.asar'),
        path.join(resolved, 'app.asar'),
    ];
    const archivePath = archiveCandidates.find((candidate) => isFile(candidate));
    if (archivePath) {
        return asarInfo(archivePath, resolved, limits);
    }

    const packageCandidates = [
        path.join(resolved, 'package.nw'),
        path.join(resolved, 'resources', 'package.nw'),
    ];
    const packagePath = packageCandidates.find((candidate) => isFile(candidate)) ?? null;
    if (packagePath) {
        try {
            return nwInfo(packagePath, resolved, limits);
        } catch {
            const entries = walkFiles(resolved, '', limits.maxFiles ?? DEFAULT_CONTAINER_LIMITS.maxFiles);
            const engine = detectEngine(entries, findNestedRoot(entries));
            engine.wrapper = 'nwjs';
            engine.features.push('nwjs-package-unreadable');
            return {
                type: 'nwjs-package',
                rootPath: resolved,
                archivePath: packagePath,
                unpackedPath: null,
                packagePath,
                archive: null,
                engine,
                entries,
            };
        }
    }
    const entries = walkFiles(resolved, '', limits.maxFiles ?? DEFAULT_CONTAINER_LIMITS.maxFiles);
    const root = findNestedRoot(entries);
    return {
        type: 'directory',
        rootPath: resolved,
        archivePath: null,
        unpackedPath: null,
        packagePath,
        archive: null,
        engine: detectEngine(entries, root),
        entries,
    };
}

export interface ContainerAdapter {
    inspect(): ContainerInfo;
    extractTo(stagingDir: string): Promise<void>;
    packFrom(stagingDir: string, outputPath: string): Promise<void>;
    copyUnpacked(outputRoot: string): void;
    verifyOutput(outputPath: string, requiredEntries?: string[]): ContainerInfo;
}

function assertSafeArchiveEntries(entries: string[]): void {
    for (const entry of entries) {
        if (isUnsafeArchiveEntry(entry)) {
            throw new Error('안전하지 않은 archive 경로가 발견되었습니다: ' + entry);
        }
    }
}

function isWithin(parent: string, child: string): boolean {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return relative === '' || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

function assertOutside(parent: string, child: string, label: string): void {
    if (isWithin(parent, child)) throw new Error(`${label}은 원본/staging 경로 내부일 수 없습니다: ${child}`);
}

function prepareDirectory(target: string): void {
    if (fs.existsSync(target)) {
        if (!isDirectory(target) || fs.readdirSync(target).length > 0) {
            throw new Error('staging/output 경로가 비어 있지 않습니다: ' + target);
        }
    } else {
        fs.mkdirSync(target, { recursive: true });
    }
}

function extractValidArchiveEntries(info: ContainerInfo, stagingDir: string): void {
    if (!info.archivePath || !info.archive) throw new Error('ASAR 경로가 없습니다');
    for (const entry of info.archive.entries) {
        const archiveEntry = entry.split('/').join(path.sep);
        const target = path.join(stagingDir, ...entry.split('/'));
        if (!isWithin(stagingDir, target)) throw new Error('안전하지 않은 archive 출력 경로입니다: ' + entry);
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

export async function extractContainer(info: ContainerInfo, stagingDir: string): Promise<void> {
    assertOutside(info.rootPath, stagingDir, 'staging');
    if (info.type === 'nwjs-package') {
        if (!info.packagePath || !info.archive) throw new Error('유효한 package.nw 경로가 없습니다');
        if (info.archive.invalidEntryCount > 0 || info.archive.unsafeLinkCount > 0) {
            throw new Error('안전하지 않은 package.nw 항목이 있어 추출할 수 없습니다');
        }
        assertSafeArchiveEntries(info.archive.entries);
    }
    prepareDirectory(stagingDir);
    if (info.type === 'electron-asar') {
        if (!info.archivePath || !info.archive) throw new Error('ASAR 경로가 없습니다');
        if (info.archive.unsafeLinkCount > 0) throw new Error('ASAR 심볼릭 링크/정션은 추출할 수 없습니다');
        assertSafeArchiveEntries(info.archive.entries);
        if (info.archive.invalidEntryCount > 0) {
            extractValidArchiveEntries(info, stagingDir);
            return;
        }
        asar.extractAll(info.archivePath, stagingDir);
        return;
    }
    if (info.type === 'nwjs-package') {
        const zip = new AdmZip(info.packagePath);
        for (const zipEntry of zip.getEntries()) {
            const entry = normalizeEntry(zipEntry.entryName);
            const target = path.join(stagingDir, ...entry.split('/'));
            if (!isWithin(stagingDir, target)) throw new Error('안전하지 않은 package.nw 출력 경로입니다: ' + entry);
            if (zipEntry.isDirectory) {
                fs.mkdirSync(target, { recursive: true });
                continue;
            }
            const bytes = zipEntry.getData();
            if (bytes.length !== Number(zipEntry.header.size)) throw new Error('package.nw 파일 크기 검증 실패: ' + entry);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, bytes);
        }
        return;
    }
    if (info.type === 'directory') {
        fs.cpSync(info.rootPath, stagingDir, { recursive: true });
        return;
    }
    throw new Error('지원하지 않는 컨테이너입니다: ' + info.type);
}

export async function packContainer(info: ContainerInfo, stagingDir: string, outputPath: string): Promise<void> {
    if (!isDirectory(stagingDir)) throw new Error('staging 디렉터리가 없습니다: ' + stagingDir);
    const output = path.resolve(outputPath);
    assertOutside(stagingDir, output, 'output');
    assertOutside(info.rootPath, output, 'output');
    if (info.archivePath && output === path.resolve(info.archivePath)) {
        throw new Error('원본 archive에 직접 pack할 수 없습니다');
    }
    if (fs.existsSync(output)) throw new Error('출력 파일/디렉터리가 이미 존재합니다: ' + output);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    if (info.type === 'electron-asar') {
        const unpacked = new Set(info.archive?.unpackedEntries ?? []);
        const streams: asar.AsarStreamType[] = [];
        const visit = (current: string, relative: string): void => {
            for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
                if (entry.isSymbolicLink()) throw new Error('ASAR staging의 심볼릭 링크/정션은 지원하지 않습니다: ' + path.join(current, entry.name));
                const child = path.join(current, entry.name);
                const childRelative = normalizeEntry(relative ? path.join(relative, entry.name) : entry.name);
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
        const outputStream = await asar.createPackageFromStreams(output, streams);
        if (!outputStream.writableFinished) await finished(outputStream);
        return;
    }
    if (info.type === 'nwjs-package') {
        const zip = new AdmZip();
        const visit = (current: string, relative: string): void => {
            for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
                if (entry.isSymbolicLink()) throw new Error('package.nw staging의 심볼릭 링크/정션은 지원하지 않습니다: ' + path.join(current, entry.name));
                const child = path.join(current, entry.name);
                const childRelative = normalizeEntry(relative ? path.join(relative, entry.name) : entry.name);
                if (entry.isDirectory()) {
                    zip.addFile(childRelative + '/', Buffer.alloc(0));
                    visit(child, childRelative);
                } else if (entry.isFile()) {
                    zip.addLocalFile(child, relative, entry.name);
                }
            }
        };
        visit(stagingDir, '');
        zip.writeZip(output);
        return;
    }
    if (info.type === 'directory') {
        fs.cpSync(stagingDir, output, { recursive: true });
        return;
    }
    throw new Error('지원하지 않는 컨테이너입니다: ' + info.type);
}

function assertNoSymbolicLinks(sourcePath: string): void {
    const stat = fs.lstatSync(sourcePath);
    if (stat.isSymbolicLink()) throw new Error('외부 리소스 심볼릭 링크/정션은 지원하지 않습니다: ' + sourcePath);
    if (!stat.isDirectory()) return;
    for (const entry of fs.readdirSync(sourcePath)) {
        assertNoSymbolicLinks(path.join(sourcePath, entry));
    }
}

export function copyExternalResources(info: ContainerInfo, outputRoot: string): void {
    if (info.type !== 'electron-asar') return;
    assertOutside(info.rootPath, outputRoot, 'external output');
    const sourceResources = path.join(info.rootPath, 'resources');
    if (!isDirectory(sourceResources)) return;
    const targetResources = path.join(path.resolve(outputRoot), 'resources');
    fs.mkdirSync(targetResources, { recursive: true });
    for (const entry of fs.readdirSync(sourceResources)) {
        if (entry === 'app.asar' || entry === 'app.asar.unpacked') continue;
        const source = path.join(sourceResources, entry);
        const target = path.join(targetResources, entry);
        assertNoSymbolicLinks(source);
        fs.cpSync(source, target, { recursive: true });
    }
    if (info.unpackedPath && isDirectory(info.unpackedPath)) {
        const target = path.join(targetResources, 'app.asar.unpacked');
        assertNoSymbolicLinks(info.unpackedPath);
        fs.cpSync(info.unpackedPath, target, { recursive: true });
    }
}

export function verifyContainerOutput(outputPath: string, requiredEntries: string[] = []): ContainerInfo {
    const info = inspectContainer(outputPath);
    const entries = info.archive?.entries ?? info.entries;
    const missing = requiredEntries.map(normalizeEntry).filter((entry) => !entries.includes(entry));
    if (missing.length > 0) {
        throw new Error('출력 컨테이너 필수 항목이 없습니다: ' + missing.join(', '));
    }
    return info;
}

export class AsarContainer implements ContainerAdapter {
    private readonly info: ContainerInfo;
    constructor(archivePath: string) { this.info = inspectContainer(archivePath); }
    inspect(): ContainerInfo { return this.info; }
    extractTo(stagingDir: string): Promise<void> { return extractContainer(this.info, stagingDir); }
    packFrom(stagingDir: string, outputPath: string): Promise<void> { return packContainer(this.info, stagingDir, outputPath); }
    copyUnpacked(outputRoot: string): void { copyExternalResources(this.info, outputRoot); }
    verifyOutput(outputPath: string, requiredEntries: string[] = []): ContainerInfo { return verifyContainerOutput(outputPath, requiredEntries); }
}

export class DirectoryContainer implements ContainerAdapter {
    private readonly info: ContainerInfo;
    constructor(rootPath: string) { this.info = inspectContainer(rootPath); }
    inspect(): ContainerInfo { return this.info; }
    extractTo(stagingDir: string): Promise<void> { return extractContainer(this.info, stagingDir); }
    packFrom(stagingDir: string, outputPath: string): Promise<void> { return packContainer(this.info, stagingDir, outputPath); }
    copyUnpacked(outputRoot: string): void { copyExternalResources(this.info, outputRoot); }
    verifyOutput(outputPath: string, requiredEntries: string[] = []): ContainerInfo { return verifyContainerOutput(outputPath, requiredEntries); }
}
