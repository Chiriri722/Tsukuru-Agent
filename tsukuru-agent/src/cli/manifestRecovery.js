"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recoverRpgManifest = recoverRpgManifest;
/**
 * RPG MV/MZ의 오래되거나 손상된 manifest를 .extracteddata와 현재 Extract 텍스트로 복구한다.
 * 기존 manifest 원본은 같은 디렉터리에 보존하고 새 manifest만 원자적으로 교체한다.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const atomic_1 = require("../core/atomic");
const manifest_1 = require("../core/manifest");
const manifestBuild_1 = require("../core/manifestBuild");
const types_1 = require("../core/types");
const patcher_1 = require("./patcher");
function availableBackupPath(extractDir) {
    const base = path_1.default.join(extractDir, 'manifest.pre-recovery.json');
    if (!fs_1.default.existsSync(base))
        return base;
    for (let suffix = 1; suffix < 10000; suffix++) {
        const candidate = path_1.default.join(extractDir, `manifest.pre-recovery.${suffix}.json`);
        if (!fs_1.default.existsSync(candidate))
            return candidate;
    }
    throw new types_1.OperationError(types_1.ErrorCodes.OUTPUT_CONFLICT, 'manifest 복구 백업 파일 이름을 확보할 수 없습니다');
}
function readOldHashes(raw) {
    if (!raw)
        return new Map();
    try {
        const parsed = JSON.parse(raw.toString('utf8'));
        if (!Array.isArray(parsed.entries))
            return new Map();
        return new Map(parsed.entries
            .filter((entry) => typeof (entry === null || entry === void 0 ? void 0 : entry.id) === 'string' && typeof (entry === null || entry === void 0 ? void 0 : entry.hash) === 'string')
            .map((entry) => [entry.id, entry.hash]));
    }
    catch (_a) {
        return new Map();
    }
}
/** dataDir은 Backup/Extract/.extracteddata를 포함하는 RPG 추출 팩 루트이다. */
function recoverRpgManifest(dataDir, extractedMain) {
    if (typeof extractedMain !== 'object' || extractedMain === null || Array.isArray(extractedMain)) {
        throw new types_1.OperationError(types_1.ErrorCodes.MAPPING_CORRUPT, '.extracteddata의 main 매핑이 올바르지 않습니다');
    }
    const extractDir = path_1.default.join(dataDir, 'Extract');
    if (!fs_1.default.existsSync(extractDir) || !fs_1.default.statSync(extractDir).isDirectory()) {
        throw new types_1.OperationError(types_1.ErrorCodes.MAPPING_CORRUPT, 'Extract 디렉터리가 없습니다', { extractDir });
    }
    const manifest = (0, manifestBuild_1.buildRpgManifest)(extractedMain);
    if (manifest.entries.length === 0) {
        throw new types_1.OperationError(types_1.ErrorCodes.MAPPING_CORRUPT, '.extracteddata에 복구할 manifest 항목이 없습니다');
    }
    const manifestPath = path_1.default.join(extractDir, manifest_1.MANIFEST_FILE);
    const oldRaw = fs_1.default.existsSync(manifestPath) ? fs_1.default.readFileSync(manifestPath) : undefined;
    const oldHashes = readOldHashes(oldRaw);
    const fileLines = new Map();
    const ids = new Set();
    let hashesUpdated = 0;
    for (const entry of manifest.entries) {
        if (ids.has(entry.id)) {
            throw new types_1.OperationError(types_1.ErrorCodes.MAPPING_CORRUPT, `.extracteddata에 중복 ID가 있습니다: ${entry.id}`);
        }
        ids.add(entry.id);
        const sourcePath = path_1.default.resolve(dataDir, entry.sourceFile);
        const relativeSource = path_1.default.relative(path_1.default.resolve(dataDir), sourcePath);
        if (!relativeSource || relativeSource.startsWith(`..${path_1.default.sep}`) || path_1.default.isAbsolute(relativeSource) || !fs_1.default.existsSync(sourcePath)) {
            throw new types_1.OperationError(types_1.ErrorCodes.MAPPING_CORRUPT, `Backup 원본 파일을 찾을 수 없습니다: ${entry.sourceFile}`);
        }
        if (!fileLines.has(entry.extractFile)) {
            const extractPath = (0, patcher_1.resolveExtractArtifactPath)(extractDir, entry.extractFile);
            if (!fs_1.default.existsSync(extractPath) || !fs_1.default.statSync(extractPath).isFile()) {
                throw new types_1.OperationError(types_1.ErrorCodes.MAPPING_CORRUPT, `추출 텍스트 파일이 없습니다: ${entry.extractFile}`);
            }
            fileLines.set(entry.extractFile, fs_1.default.readFileSync(extractPath, 'utf8').split('\n'));
        }
        const lines = fileLines.get(entry.extractFile);
        if (!Number.isInteger(entry.lineStart) || !Number.isInteger(entry.lineEnd)
            || entry.lineStart < 0 || entry.lineEnd > lines.length || entry.lineStart >= entry.lineEnd) {
            throw new types_1.OperationError(types_1.ErrorCodes.MAPPING_CORRUPT, `줄 매핑이 손상되었습니다: ${entry.id} (${entry.lineStart}..${entry.lineEnd} / ${lines.length}줄)`);
        }
        const currentHash = (0, manifest_1.sha256Text)(lines.slice(entry.lineStart, entry.lineEnd).join('\n'));
        if (oldHashes.get(entry.id) !== currentHash)
            hashesUpdated++;
        entry.hash = currentHash;
    }
    let backupPath;
    if (oldRaw) {
        backupPath = availableBackupPath(extractDir);
        (0, atomic_1.atomicWriteFileSync)(backupPath, oldRaw);
    }
    (0, atomic_1.atomicWriteFileSync)(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return {
        manifestPath,
        backupPath,
        entries: manifest.entries.length,
        files: fileLines.size,
        hashesUpdated,
    };
}
