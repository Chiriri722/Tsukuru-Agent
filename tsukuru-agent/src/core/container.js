"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DirectoryContainer = exports.AsarContainer = void 0;
exports.inspectContainer = inspectContainer;
exports.extractContainer = extractContainer;
exports.packContainer = packContainer;
exports.copyExternalResources = copyExternalResources;
exports.verifyContainerOutput = verifyContainerOutput;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const promises_1 = require("stream/promises");
const asar = __importStar(require("@electron/asar"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const DEFAULT_CONTAINER_LIMITS = {
    maxFiles: 20000,
    maxBytes: 8 * 1024 * 1024 * 1024,
    maxFileBytes: 2 * 1024 * 1024 * 1024,
};
function isDirectory(value) {
    try {
        return fs_1.default.lstatSync(value).isDirectory();
    }
    catch (_a) {
        return false;
    }
}
function isFile(value) {
    try {
        return fs_1.default.lstatSync(value).isFile();
    }
    catch (_a) {
        return false;
    }
}
function normalizeEntry(value) {
    return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}
function isUnsafeArchiveEntry(value) {
    const normalized = value.replace(/\\/g, '/');
    if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
        return true;
    }
    return normalized.split('/').some((part) => part === '..');
}
function sha256File(filePath) {
    const hash = crypto_1.default.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    const handle = fs_1.default.openSync(filePath, 'r');
    try {
        let bytesRead = 0;
        do {
            bytesRead = fs_1.default.readSync(handle, buffer, 0, buffer.length, null);
            if (bytesRead > 0)
                hash.update(buffer.subarray(0, bytesRead));
        } while (bytesRead > 0);
        return hash.digest('hex');
    }
    finally {
        fs_1.default.closeSync(handle);
    }
}
function walkFiles(root, relative = '', limit = 20000, output = []) {
    const current = relative ? path_1.default.join(root, relative) : root;
    for (const entry of fs_1.default.readdirSync(current, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) {
            throw new Error('심볼릭 링크/정션은 지원하지 않습니다: ' + path_1.default.join(current, entry.name));
        }
        const child = relative ? path_1.default.join(relative, entry.name) : entry.name;
        if (entry.isDirectory()) {
            walkFiles(root, child, limit, output);
        }
        else if (entry.isFile()) {
            if (output.length >= limit)
                throw new Error('파일 수 제한 초과: ' + limit);
            output.push(normalizeEntry(child));
        }
    }
    return output;
}
function hasFile(entries, root, relative) {
    const prefix = root ? root + '/' : '';
    return entries.includes(prefix + relative);
}
function hasUnder(entries, root, predicate) {
    const prefix = root ? root + '/' : '';
    return entries.some((entry) => entry.startsWith(prefix) && predicate(entry.slice(prefix.length)));
}
function findNestedRoot(entries) {
    const candidates = ['', 'project', 'www', 'game', 'app', 'data'];
    let best = '';
    let bestScore = -1;
    for (const candidate of candidates) {
        let score = 0;
        if (hasUnder(entries, candidate, (e) => e.startsWith('data/') && e.endsWith('.json')))
            score += 4;
        if (hasFile(entries, candidate, 'js/rmmz_core.js'))
            score += 6;
        if (hasFile(entries, candidate, 'index.html'))
            score += 1;
        if (hasUnder(entries, candidate, (e) => e.startsWith('scenario/') && e.endsWith('.ks')))
            score += 5;
        if (score > bestScore || (score > 0 && score === bestScore && candidate.length > best.length)) {
            best = candidate;
            bestScore = score;
        }
    }
    return best;
}
function detectEngine(entries, root) {
    const features = [];
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
function inspectArchive(archivePath, limits = {}) {
    var _a;
    const effectiveLimits = { ...DEFAULT_CONTAINER_LIMITS, ...limits };
    const archiveBytes = fs_1.default.statSync(archivePath).size;
    if (archiveBytes > effectiveLimits.maxBytes) {
        throw new Error('archive 물리 크기 제한 초과: ' + archivePath);
    }
    let rawHeader = null;
    let integrity = 'absent';
    try {
        rawHeader = asar.getRawHeader(archivePath);
        const serialized = JSON.stringify(rawHeader.header);
        integrity = serialized.includes('"integrity"') ? 'present' : 'absent';
    }
    catch (_b) {
        integrity = 'unreadable';
    }
    const rawListed = asar.listPackage(archivePath, { isPack: false })
        .filter((entry) => entry.trim() !== '');
    const validEntries = [];
    const invalidEntries = [];
    const fileEntries = [];
    let unsafeLinkCount = 0;
    const unpackedEntries = [];
    let fileCount = 0;
    let directoryCount = 0;
    let totalBytes = 0;
    for (const rawEntryValue of rawListed) {
        const entry = normalizeEntry(rawEntryValue);
        if (!entry)
            continue;
        try {
            const rawEntry = rawEntryValue.replace(/^\\+/, '');
            const stat = asar.statFile(archivePath, rawEntry, false);
            if ('files' in stat) {
                directoryCount++;
                validEntries.push(entry);
            }
            else if ('link' in stat) {
                unsafeLinkCount++;
                invalidEntries.push(entry);
            }
            else if ('size' in stat) {
                const size = Number(stat.size);
                const offset = Number((_a = stat.offset) !== null && _a !== void 0 ? _a : 0);
                const dataStart = rawHeader ? 8 + rawHeader.headerSize : 0;
                const finiteMetadata = Number.isSafeInteger(size) && size >= 0
                    && Number.isSafeInteger(offset) && offset >= 0;
                const fitsArchive = stat.unpacked === true
                    || (rawHeader !== null && finiteMetadata && dataStart + offset + size <= archiveBytes);
                if (!finiteMetadata || !fitsArchive) {
                    invalidEntries.push(entry);
                    continue;
                }
                if (size > effectiveLimits.maxFileBytes)
                    throw new Error('archive 개별 파일 크기 제한 초과: ' + entry);
                fileCount++;
                fileEntries.push(entry);
                totalBytes += size;
                if (stat.unpacked === true)
                    unpackedEntries.push(entry);
                if (fileCount > effectiveLimits.maxFiles)
                    throw new Error('archive 파일 수 제한 초과: ' + archivePath);
                if (totalBytes > effectiveLimits.maxBytes)
                    throw new Error('archive 해제 크기 제한 초과: ' + archivePath);
                validEntries.push(entry);
            }
        }
        catch (err) {
            if (String(err).includes('제한 초과'))
                throw err;
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
function asarInfo(archivePath, rootPath, limits = {}) {
    const archive = inspectArchive(archivePath, limits);
    const root = findNestedRoot(archive.entries);
    const engine = detectEngine(archive.entries, root);
    if (engine.type === 'gdevelop' && engine.wrapper === null)
        engine.wrapper = 'electron';
    if (archive.invalidEntryCount > 0)
        engine.features.push('asar-invalid-metadata');
    if (archive.unsafeLinkCount > 0)
        engine.features.push('asar-symbolic-links');
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
function isZipSymbolicLink(entry) {
    const unixMode = (entry.attr >>> 16) & 0xffff;
    return (unixMode & 0xf000) === 0xa000;
}
function inspectNwArchive(packagePath, limits = {}) {
    const effectiveLimits = { ...DEFAULT_CONTAINER_LIMITS, ...limits };
    const archiveBytes = fs_1.default.statSync(packagePath).size;
    if (archiveBytes > effectiveLimits.maxBytes) {
        throw new Error('package.nw 물리 크기 제한 초과: ' + packagePath);
    }
    const zip = new adm_zip_1.default(packagePath);
    const entries = [];
    const fileEntries = [];
    const invalidEntries = [];
    const seen = new Set();
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
        if (size > effectiveLimits.maxFileBytes)
            throw new Error('package.nw 개별 파일 크기 제한 초과: ' + entry);
        fileCount++;
        totalBytes += size;
        if (fileCount > effectiveLimits.maxFiles)
            throw new Error('package.nw 파일 수 제한 초과: ' + packagePath);
        if (totalBytes > effectiveLimits.maxBytes)
            throw new Error('package.nw 해제 크기 제한 초과: ' + packagePath);
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
function nwInfo(packagePath, rootPath, limits = {}) {
    const archive = inspectNwArchive(packagePath, limits);
    const root = findNestedRoot(archive.entries);
    const engine = detectEngine(archive.entries, root);
    engine.wrapper = 'nwjs';
    if (archive.invalidEntryCount > 0)
        engine.features.push('nwjs-invalid-metadata');
    if (archive.unsafeLinkCount > 0)
        engine.features.push('nwjs-symbolic-links');
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
function inspectContainer(projectPath, limits = {}) {
    var _a, _b, _c;
    const resolved = path_1.default.resolve(projectPath);
    if (isFile(resolved)) {
        if (path_1.default.extname(resolved).toLowerCase() === '.asar' || path_1.default.basename(resolved).toLowerCase() === 'app.asar') {
            const parent = path_1.default.basename(path_1.default.dirname(resolved)).toLowerCase() === 'resources'
                ? path_1.default.dirname(path_1.default.dirname(resolved))
                : path_1.default.dirname(resolved);
            return asarInfo(resolved, parent, limits);
        }
        if (path_1.default.extname(resolved).toLowerCase() === '.nw' || path_1.default.basename(resolved).toLowerCase() === 'package.nw') {
            const parent = path_1.default.basename(path_1.default.dirname(resolved)).toLowerCase() === 'resources'
                ? path_1.default.dirname(path_1.default.dirname(resolved))
                : path_1.default.dirname(resolved);
            return nwInfo(resolved, parent, limits);
        }
        return {
            type: 'unknown',
            rootPath: path_1.default.dirname(resolved),
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
        path_1.default.join(resolved, 'resources', 'app.asar'),
        path_1.default.join(resolved, 'app.asar'),
    ];
    const archivePath = archiveCandidates.find((candidate) => isFile(candidate));
    if (archivePath) {
        return asarInfo(archivePath, resolved, limits);
    }
    const packageCandidates = [
        path_1.default.join(resolved, 'package.nw'),
        path_1.default.join(resolved, 'resources', 'package.nw'),
    ];
    const packagePath = (_a = packageCandidates.find((candidate) => isFile(candidate))) !== null && _a !== void 0 ? _a : null;
    if (packagePath) {
        try {
            return nwInfo(packagePath, resolved, limits);
        }
        catch (_d) {
            const entries = walkFiles(resolved, '', (_b = limits.maxFiles) !== null && _b !== void 0 ? _b : DEFAULT_CONTAINER_LIMITS.maxFiles);
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
    const entries = walkFiles(resolved, '', (_c = limits.maxFiles) !== null && _c !== void 0 ? _c : DEFAULT_CONTAINER_LIMITS.maxFiles);
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
function assertSafeArchiveEntries(entries) {
    for (const entry of entries) {
        if (isUnsafeArchiveEntry(entry)) {
            throw new Error('안전하지 않은 archive 경로가 발견되었습니다: ' + entry);
        }
    }
}
function isWithin(parent, child) {
    const relative = path_1.default.relative(path_1.default.resolve(parent), path_1.default.resolve(child));
    return relative === '' || (!relative.startsWith('..' + path_1.default.sep) && !path_1.default.isAbsolute(relative));
}
function assertOutside(parent, child, label) {
    if (isWithin(parent, child))
        throw new Error(`${label}은 원본/staging 경로 내부일 수 없습니다: ${child}`);
}
function prepareDirectory(target) {
    if (fs_1.default.existsSync(target)) {
        if (!isDirectory(target) || fs_1.default.readdirSync(target).length > 0) {
            throw new Error('staging/output 경로가 비어 있지 않습니다: ' + target);
        }
    }
    else {
        fs_1.default.mkdirSync(target, { recursive: true });
    }
}
function extractValidArchiveEntries(info, stagingDir) {
    if (!info.archivePath || !info.archive)
        throw new Error('ASAR 경로가 없습니다');
    for (const entry of info.archive.entries) {
        const archiveEntry = entry.split('/').join(path_1.default.sep);
        const target = path_1.default.join(stagingDir, ...entry.split('/'));
        if (!isWithin(stagingDir, target))
            throw new Error('안전하지 않은 archive 출력 경로입니다: ' + entry);
        const stat = asar.statFile(info.archivePath, archiveEntry, false);
        if ('files' in stat) {
            fs_1.default.mkdirSync(target, { recursive: true });
            continue;
        }
        if ('link' in stat)
            throw new Error('ASAR 심볼릭 링크는 지원하지 않습니다: ' + entry);
        const bytes = asar.extractFile(info.archivePath, archiveEntry, false);
        fs_1.default.mkdirSync(path_1.default.dirname(target), { recursive: true });
        fs_1.default.writeFileSync(target, bytes);
    }
}
async function extractContainer(info, stagingDir) {
    assertOutside(info.rootPath, stagingDir, 'staging');
    if (info.type === 'nwjs-package') {
        if (!info.packagePath || !info.archive)
            throw new Error('유효한 package.nw 경로가 없습니다');
        if (info.archive.invalidEntryCount > 0 || info.archive.unsafeLinkCount > 0) {
            throw new Error('안전하지 않은 package.nw 항목이 있어 추출할 수 없습니다');
        }
        assertSafeArchiveEntries(info.archive.entries);
    }
    prepareDirectory(stagingDir);
    if (info.type === 'electron-asar') {
        if (!info.archivePath || !info.archive)
            throw new Error('ASAR 경로가 없습니다');
        if (info.archive.unsafeLinkCount > 0)
            throw new Error('ASAR 심볼릭 링크/정션은 추출할 수 없습니다');
        assertSafeArchiveEntries(info.archive.entries);
        if (info.archive.invalidEntryCount > 0) {
            extractValidArchiveEntries(info, stagingDir);
            return;
        }
        asar.extractAll(info.archivePath, stagingDir);
        return;
    }
    if (info.type === 'nwjs-package') {
        const zip = new adm_zip_1.default(info.packagePath);
        for (const zipEntry of zip.getEntries()) {
            const entry = normalizeEntry(zipEntry.entryName);
            const target = path_1.default.join(stagingDir, ...entry.split('/'));
            if (!isWithin(stagingDir, target))
                throw new Error('안전하지 않은 package.nw 출력 경로입니다: ' + entry);
            if (zipEntry.isDirectory) {
                fs_1.default.mkdirSync(target, { recursive: true });
                continue;
            }
            const bytes = zipEntry.getData();
            if (bytes.length !== Number(zipEntry.header.size))
                throw new Error('package.nw 파일 크기 검증 실패: ' + entry);
            fs_1.default.mkdirSync(path_1.default.dirname(target), { recursive: true });
            fs_1.default.writeFileSync(target, bytes);
        }
        return;
    }
    if (info.type === 'directory') {
        fs_1.default.cpSync(info.rootPath, stagingDir, { recursive: true });
        return;
    }
    throw new Error('지원하지 않는 컨테이너입니다: ' + info.type);
}
async function packContainer(info, stagingDir, outputPath) {
    var _a, _b;
    if (!isDirectory(stagingDir))
        throw new Error('staging 디렉터리가 없습니다: ' + stagingDir);
    const output = path_1.default.resolve(outputPath);
    assertOutside(stagingDir, output, 'output');
    assertOutside(info.rootPath, output, 'output');
    if (info.archivePath && output === path_1.default.resolve(info.archivePath)) {
        throw new Error('원본 archive에 직접 pack할 수 없습니다');
    }
    if (fs_1.default.existsSync(output))
        throw new Error('출력 파일/디렉터리가 이미 존재합니다: ' + output);
    fs_1.default.mkdirSync(path_1.default.dirname(output), { recursive: true });
    if (info.type === 'electron-asar') {
        const unpacked = new Set((_b = (_a = info.archive) === null || _a === void 0 ? void 0 : _a.unpackedEntries) !== null && _b !== void 0 ? _b : []);
        const streams = [];
        const visit = (current, relative) => {
            for (const entry of fs_1.default.readdirSync(current, { withFileTypes: true })) {
                if (entry.isSymbolicLink())
                    throw new Error('ASAR staging의 심볼릭 링크/정션은 지원하지 않습니다: ' + path_1.default.join(current, entry.name));
                const child = path_1.default.join(current, entry.name);
                const childRelative = normalizeEntry(relative ? path_1.default.join(relative, entry.name) : entry.name);
                if (entry.isDirectory()) {
                    const directoryUnpacked = [...unpacked].some((file) => file === childRelative || file.startsWith(childRelative + '/'));
                    streams.push({ type: 'directory', path: childRelative, unpacked: directoryUnpacked });
                    visit(child, childRelative);
                }
                else if (entry.isFile()) {
                    streams.push({
                        type: 'file',
                        path: childRelative,
                        unpacked: unpacked.has(childRelative),
                        stat: fs_1.default.statSync(child),
                        streamGenerator: () => fs_1.default.createReadStream(child),
                    });
                }
            }
        };
        visit(stagingDir, '');
        const outputStream = await asar.createPackageFromStreams(output, streams);
        if (!outputStream.writableFinished)
            await (0, promises_1.finished)(outputStream);
        return;
    }
    if (info.type === 'nwjs-package') {
        const zip = new adm_zip_1.default();
        const visit = (current, relative) => {
            for (const entry of fs_1.default.readdirSync(current, { withFileTypes: true })) {
                if (entry.isSymbolicLink())
                    throw new Error('package.nw staging의 심볼릭 링크/정션은 지원하지 않습니다: ' + path_1.default.join(current, entry.name));
                const child = path_1.default.join(current, entry.name);
                const childRelative = normalizeEntry(relative ? path_1.default.join(relative, entry.name) : entry.name);
                if (entry.isDirectory()) {
                    zip.addFile(childRelative + '/', Buffer.alloc(0));
                    visit(child, childRelative);
                }
                else if (entry.isFile()) {
                    zip.addLocalFile(child, relative, entry.name);
                }
            }
        };
        visit(stagingDir, '');
        zip.writeZip(output);
        return;
    }
    if (info.type === 'directory') {
        fs_1.default.cpSync(stagingDir, output, { recursive: true });
        return;
    }
    throw new Error('지원하지 않는 컨테이너입니다: ' + info.type);
}
function assertNoSymbolicLinks(sourcePath) {
    const stat = fs_1.default.lstatSync(sourcePath);
    if (stat.isSymbolicLink())
        throw new Error('외부 리소스 심볼릭 링크/정션은 지원하지 않습니다: ' + sourcePath);
    if (!stat.isDirectory())
        return;
    for (const entry of fs_1.default.readdirSync(sourcePath)) {
        assertNoSymbolicLinks(path_1.default.join(sourcePath, entry));
    }
}
function copyExternalResources(info, outputRoot) {
    if (info.type !== 'electron-asar')
        return;
    assertOutside(info.rootPath, outputRoot, 'external output');
    const sourceResources = path_1.default.join(info.rootPath, 'resources');
    if (!isDirectory(sourceResources))
        return;
    const targetResources = path_1.default.join(path_1.default.resolve(outputRoot), 'resources');
    fs_1.default.mkdirSync(targetResources, { recursive: true });
    for (const entry of fs_1.default.readdirSync(sourceResources)) {
        if (entry === 'app.asar' || entry === 'app.asar.unpacked')
            continue;
        const source = path_1.default.join(sourceResources, entry);
        const target = path_1.default.join(targetResources, entry);
        assertNoSymbolicLinks(source);
        fs_1.default.cpSync(source, target, { recursive: true });
    }
    if (info.unpackedPath && isDirectory(info.unpackedPath)) {
        const target = path_1.default.join(targetResources, 'app.asar.unpacked');
        assertNoSymbolicLinks(info.unpackedPath);
        fs_1.default.cpSync(info.unpackedPath, target, { recursive: true });
    }
}
function verifyContainerOutput(outputPath, requiredEntries = []) {
    var _a, _b;
    const info = inspectContainer(outputPath);
    const entries = (_b = (_a = info.archive) === null || _a === void 0 ? void 0 : _a.entries) !== null && _b !== void 0 ? _b : info.entries;
    const missing = requiredEntries.map(normalizeEntry).filter((entry) => !entries.includes(entry));
    if (missing.length > 0) {
        throw new Error('출력 컨테이너 필수 항목이 없습니다: ' + missing.join(', '));
    }
    return info;
}
class AsarContainer {
    constructor(archivePath) { this.info = inspectContainer(archivePath); }
    inspect() { return this.info; }
    extractTo(stagingDir) { return extractContainer(this.info, stagingDir); }
    packFrom(stagingDir, outputPath) { return packContainer(this.info, stagingDir, outputPath); }
    copyUnpacked(outputRoot) { copyExternalResources(this.info, outputRoot); }
    verifyOutput(outputPath, requiredEntries = []) { return verifyContainerOutput(outputPath, requiredEntries); }
}
exports.AsarContainer = AsarContainer;
class DirectoryContainer {
    constructor(rootPath) { this.info = inspectContainer(rootPath); }
    inspect() { return this.info; }
    extractTo(stagingDir) { return extractContainer(this.info, stagingDir); }
    packFrom(stagingDir, outputPath) { return packContainer(this.info, stagingDir, outputPath); }
    copyUnpacked(outputRoot) { copyExternalResources(this.info, outputRoot); }
    verifyOutput(outputPath, requiredEntries = []) { return verifyContainerOutput(outputPath, requiredEntries); }
}
exports.DirectoryContainer = DirectoryContainer;
