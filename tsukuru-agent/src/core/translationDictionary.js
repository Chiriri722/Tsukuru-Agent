"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadRpgTranslationDictionary = loadRpgTranslationDictionary;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const manifest_1 = require("./manifest");
const types_1 = require("./types");
const MAX_DICTIONARY_FILE_BYTES = 64 * 1024 * 1024;
function resolveDictionaryExtractPath(extractDir, relativePath) {
    if (typeof relativePath !== 'string' || relativePath.trim() === '' || path_1.default.isAbsolute(relativePath)) {
        throw new types_1.OperationError(types_1.ErrorCodes.MAPPING_CORRUPT, `안전하지 않은 추출 파일 경로입니다: ${String(relativePath)}`);
    }
    const root = path_1.default.resolve(extractDir);
    const target = path_1.default.resolve(root, relativePath);
    const relative = path_1.default.relative(root, target);
    if (!relative || relative.startsWith(`..${path_1.default.sep}`) || path_1.default.isAbsolute(relative)) {
        throw new types_1.OperationError(types_1.ErrorCodes.MAPPING_CORRUPT, `Extract 폴더 밖을 가리키는 경로입니다: ${relativePath}`);
    }
    return target;
}
/** RPG manifest ID를 키로 사용하는 최상위 *_trans.json 사전을 안전한 patch 목록으로 변환한다. */
function loadRpgTranslationDictionary(extractDir, translationDirectory) {
    var _a;
    const stat = fs_1.default.existsSync(translationDirectory) ? fs_1.default.lstatSync(translationDirectory) : null;
    if (!(stat === null || stat === void 0 ? void 0 : stat.isDirectory()) || stat.isSymbolicLink()) {
        throw new types_1.OperationError(types_1.ErrorCodes.PATH_NOT_FOUND, 'translationDirectory가 유효한 디렉터리가 아닙니다', { translationDirectory });
    }
    const manifestPath = path_1.default.join(extractDir, manifest_1.MANIFEST_FILE);
    if (!fs_1.default.existsSync(manifestPath)) {
        throw new types_1.OperationError(types_1.ErrorCodes.MANIFEST_MISSING, 'manifest.json이 없습니다', { manifestPath });
    }
    let manifest;
    try {
        manifest = JSON.parse(fs_1.default.readFileSync(manifestPath, 'utf8'));
    }
    catch (_b) {
        throw new types_1.OperationError(types_1.ErrorCodes.MANIFEST_CORRUPT, 'manifest.json 파싱에 실패했습니다', { manifestPath });
    }
    if (manifest.format !== 'rpgmv' || !Array.isArray(manifest.entries)) {
        throw new types_1.OperationError(types_1.ErrorCodes.FORMAT_MISMATCH, 'RPG MV/MZ manifest만 번역 사전 자동 조립을 지원합니다');
    }
    const byId = new Map();
    for (const entry of manifest.entries) {
        if (byId.has(entry.id)) {
            throw new types_1.OperationError(types_1.ErrorCodes.MANIFEST_CORRUPT, `manifest에 중복 id가 있습니다: ${entry.id}`);
        }
        byId.set(entry.id, entry);
    }
    const files = fs_1.default.readdirSync(translationDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && !entry.name.startsWith('._') && entry.name.endsWith('_trans.json'))
        .map((entry) => entry.name)
        .sort();
    if (files.length === 0) {
        throw new types_1.OperationError(types_1.ErrorCodes.PATCH_EMPTY, 'translationDirectory에 *_trans.json 파일이 없습니다', { translationDirectory });
    }
    const stats = {
        files: files.length,
        entries: 0,
        selected: 0,
        skippedUnknown: 0,
        skippedBlank: 0,
        skippedUnchanged: 0,
        skippedComment: 0,
    };
    const seen = new Set();
    const patches = [];
    const fileLines = new Map();
    for (const file of files) {
        const filePath = path_1.default.join(translationDirectory, file);
        if (fs_1.default.statSync(filePath).size > MAX_DICTIONARY_FILE_BYTES) {
            throw new types_1.OperationError(types_1.ErrorCodes.REQUEST_INVALID, `번역 사전 파일이 너무 큽니다: ${file}`);
        }
        let dictionary;
        try {
            dictionary = JSON.parse(fs_1.default.readFileSync(filePath, 'utf8'));
        }
        catch (_c) {
            throw new types_1.OperationError(types_1.ErrorCodes.REQUEST_INVALID, `번역 사전 JSON 파싱에 실패했습니다: ${file}`);
        }
        if (typeof dictionary !== 'object' || dictionary === null || Array.isArray(dictionary)) {
            throw new types_1.OperationError(types_1.ErrorCodes.REQUEST_INVALID, `번역 사전은 JSON 객체여야 합니다: ${file}`);
        }
        for (const [id, text] of Object.entries(dictionary)) {
            stats.entries += 1;
            if (seen.has(id)) {
                throw new types_1.OperationError(types_1.ErrorCodes.PATCH_DUPLICATE_ID, `번역 사전에 중복 id가 있습니다: ${id}`);
            }
            seen.add(id);
            if (typeof text !== 'string') {
                throw new types_1.OperationError(types_1.ErrorCodes.REQUEST_INVALID, `번역 사전 값은 문자열이어야 합니다: ${file} / ${id}`);
            }
            const entry = byId.get(id);
            if (!entry) {
                stats.skippedUnknown += 1;
                continue;
            }
            const conf = (_a = entry.mv) === null || _a === void 0 ? void 0 : _a.conf;
            if (conf === null || conf === void 0 ? void 0 : conf.isComment) {
                stats.skippedComment += 1;
                continue;
            }
            if (text.length === 0) {
                stats.skippedBlank += 1;
                continue;
            }
            if (!fileLines.has(entry.extractFile)) {
                const extractPath = resolveDictionaryExtractPath(extractDir, entry.extractFile);
                if (!fs_1.default.existsSync(extractPath)) {
                    throw new types_1.OperationError(types_1.ErrorCodes.MAPPING_CORRUPT, `추출 텍스트 파일이 없습니다: ${entry.extractFile}`);
                }
                fileLines.set(entry.extractFile, fs_1.default.readFileSync(extractPath, 'utf8').split('\n'));
            }
            const lines = fileLines.get(entry.extractFile);
            if (entry.lineStart < 0 || entry.lineEnd > lines.length || entry.lineStart >= entry.lineEnd) {
                throw new types_1.OperationError(types_1.ErrorCodes.MAPPING_CORRUPT, `줄 매핑이 손상되었습니다: ${id}`);
            }
            const current = lines.slice(entry.lineStart, entry.lineEnd).join('\n');
            if (text === current) {
                stats.skippedUnchanged += 1;
                continue;
            }
            patches.push({ id, expectedHash: entry.hash, text });
            stats.selected += 1;
        }
    }
    const warnings = [];
    if (stats.skippedUnknown > 0)
        warnings.push(`manifest에 없는 번역 사전 항목 ${stats.skippedUnknown}개를 건너뛰었습니다`);
    if (stats.skippedBlank > 0)
        warnings.push(`빈 번역 사전 항목 ${stats.skippedBlank}개를 건너뛰었습니다`);
    if (stats.skippedComment > 0)
        warnings.push(`주석 번역 사전 항목 ${stats.skippedComment}개를 건너뛰었습니다`);
    return { patches, stats, warnings };
}
