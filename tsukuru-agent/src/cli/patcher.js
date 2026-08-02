"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyPatches = applyPatches;
/**
 * patch 작업 구현 (계획서 §CLI 계약 및 §Manifest와 안전성).
 * - id/expectedHash 검증 후 추출 작업본(txt)만 수정한다(원본·Backup 불변).
 * - 해시 불일치·중복 ID·매핑 손상이 하나라도 있으면 아무것도 변경하지 않는다.
 * - 여러 줄 치환 후에는 manifest와 .extracteddata의 줄 매핑을 재생성한다.
 * - 모든 기록은 원자적 쓰기(atomicWriteFileSync).
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const zlib_1 = __importDefault(require("zlib"));
const iconv_lite_1 = __importDefault(require("iconv-lite"));
const msgpack_1 = require("@msgpack/msgpack");
const types_1 = require("../core/types");
const manifest_1 = require("../core/manifest");
const atomic_1 = require("../core/atomic");
/** extractDir(Extract/ 또는 _Extract/) 안의 작업본에 patches를 적용한다. */
function applyPatches(extractDir, format, patches) {
    var _a, _b;
    // 1. manifest 로드
    const manifestPath = path_1.default.join(extractDir, manifest_1.MANIFEST_FILE);
    if (!fs_1.default.existsSync(manifestPath)) {
        throw new types_1.OperationError(types_1.ErrorCodes.MANIFEST_MISSING, 'manifest.json이 없습니다. 먼저 extract를 실행하세요', { manifestPath });
    }
    let manifest;
    try {
        manifest = JSON.parse(fs_1.default.readFileSync(manifestPath, 'utf8'));
    }
    catch (_c) {
        throw new types_1.OperationError(types_1.ErrorCodes.MANIFEST_CORRUPT, 'manifest.json 파싱에 실패했습니다', { manifestPath });
    }
    if (manifest.format !== format) {
        throw new types_1.OperationError(types_1.ErrorCodes.FORMAT_MISMATCH, `manifest 포맷(${manifest.format})과 실제 포맷(${format})이 다릅니다`);
    }
    // 2. ID 검증(중복·존재·주석 여부)
    const seen = new Set();
    for (const p of patches) {
        if (seen.has(p.id)) {
            throw new types_1.OperationError(types_1.ErrorCodes.PATCH_DUPLICATE_ID, `중복 patch id입니다: ${p.id}`);
        }
        seen.add(p.id);
    }
    const byId = new Map();
    for (const e of manifest.entries) {
        if (byId.has(e.id)) {
            throw new types_1.OperationError(types_1.ErrorCodes.MANIFEST_CORRUPT, `manifest에 중복 id가 있습니다: ${e.id}`);
        }
        byId.set(e.id, e);
    }
    for (const p of patches) {
        const e = byId.get(p.id);
        if (!e) {
            throw new types_1.OperationError(types_1.ErrorCodes.PATCH_NOT_FOUND, `patch id를 찾을 수 없습니다: ${p.id}`);
        }
        const conf = (_a = e.mv) === null || _a === void 0 ? void 0 : _a.conf;
        if (conf === null || conf === void 0 ? void 0 : conf.isComment) {
            throw new types_1.OperationError(types_1.ErrorCodes.PATCH_NOT_FOUND, `주석 항목은 patch할 수 없습니다: ${p.id}`);
        }
    }
    // 3. 사전 해시·매핑 검증(어떤 쓰기보다 먼저 전부 검사)
    const fileLines = new Map();
    const readLines = (rel) => {
        if (!fileLines.has(rel)) {
            const fp = path_1.default.join(extractDir, rel);
            if (!fs_1.default.existsSync(fp)) {
                throw new types_1.OperationError(types_1.ErrorCodes.MAPPING_CORRUPT, `추출 텍스트 파일이 없습니다: ${rel}`);
            }
            fileLines.set(rel, fs_1.default.readFileSync(fp, 'utf8').split('\n'));
        }
        return fileLines.get(rel);
    };
    for (const p of patches) {
        const e = byId.get(p.id);
        const lines = readLines(e.extractFile);
        if (e.lineStart < 0 || e.lineEnd > lines.length || e.lineStart >= e.lineEnd) {
            throw new types_1.OperationError(types_1.ErrorCodes.MAPPING_CORRUPT, `줄 매핑이 손상되었습니다: ${p.id} (${e.lineStart}..${e.lineEnd} / ${lines.length}줄)`);
        }
        const current = lines.slice(e.lineStart, e.lineEnd).join('\n');
        if ((0, manifest_1.sha256Text)(current) !== p.expectedHash) {
            throw new types_1.OperationError(types_1.ErrorCodes.PATCH_HASH_MISMATCH, `원문 해시가 일치하지 않습니다: ${p.id}`, { id: p.id });
        }
    }
    const byFile = new Map();
    for (const p of patches) {
        const e = byId.get(p.id);
        const arr = (_b = byFile.get(e.extractFile)) !== null && _b !== void 0 ? _b : [];
        arr.push({ p, e });
        byFile.set(e.extractFile, arr);
    }
    for (const [file, arr] of byFile) {
        const sorted = arr.slice().sort((a, b) => a.e.lineStart - b.e.lineStart);
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i].e.lineStart < sorted[i - 1].e.lineEnd) {
                throw new types_1.OperationError(types_1.ErrorCodes.MAPPING_CORRUPT, `patch 범위가 겹칩니다: ${file}`);
            }
        }
    }
    // 4. 작업본 수정(파일별 lineStart 내림차순 스플라이스로 앞쪽 줄 번호 보존)
    for (const [file, arr] of byFile) {
        const lines = readLines(file);
        for (const { p, e } of arr.slice().sort((a, b) => b.e.lineStart - a.e.lineStart)) {
            lines.splice(e.lineStart, e.lineEnd - e.lineStart, ...p.text.split('\n'));
        }
    }
    // 5. manifest 줄 매핑·해시 재생성(파일별 delta walk)
    for (const [file, arr] of byFile) {
        const fileEntries = manifest.entries.filter((e) => e.extractFile === file).sort((a, b) => a.lineStart - b.lineStart);
        const patchById = new Map(arr.map((x) => [x.e.id, x.p.text.split('\n')]));
        let delta = 0;
        for (const e of fileEntries) {
            const oldStart = e.lineStart;
            const oldLen = e.lineEnd - oldStart;
            e.lineStart = oldStart + delta;
            const newText = patchById.get(e.id);
            if (newText !== undefined) {
                e.lineEnd = e.lineStart + newText.length;
                e.hash = (0, manifest_1.sha256Text)(newText.join('\n'));
                delta += newText.length - oldLen;
            }
            else {
                e.lineEnd = e.lineStart + oldLen;
            }
        }
    }
    // 6. .extracteddata 줄 매핑 재생성 + 모든 산출물 원자적 기록
    regenerateExtractedData(extractDir, format, manifest, byFile);
    for (const [file, lines] of fileLines) {
        if (byFile.has(file)) {
            (0, atomic_1.atomicWriteFileSync)(path_1.default.join(extractDir, file), lines.join('\n'));
        }
    }
    (0, atomic_1.atomicWriteFileSync)(manifestPath, JSON.stringify(manifest, null, 2));
    return { patched: patches.length, files: byFile.size };
}
/** .extracteddata의 줄 매핑을 갱신된 manifest 기준으로 재생성한다. */
function regenerateExtractedData(extractDir, format, manifest, byFile) {
    var _a;
    if (format === 'rpgmv') {
        // RPG: data 폼더의 .extracteddata(gb) — data 키(cid)와 m을 새 줄 번호로 재구성
        const dataDir = path_1.default.dirname(extractDir);
        const edPath = path_1.default.join(dataDir, '.extracteddata');
        const readF = fs_1.default.readFileSync(edPath);
        let ext_data = JSON.parse(iconv_lite_1.default.decode(zlib_1.default.inflateSync(readF), 'utf8'));
        while (ext_data.main === undefined) {
            ext_data = ext_data.dat;
        }
        for (const [file] of byFile) {
            const bucket = file === 'ext_javascript.js' ? 'ext_javascript.json' : `${path_1.default.parse(file).name}.json`;
            const gbEntry = ext_data.main[bucket];
            if (!gbEntry || !gbEntry.data) {
                throw new types_1.OperationError(types_1.ErrorCodes.MAPPING_CORRUPT, `.extracteddata에 버킷이 없습니다: ${bucket}`);
            }
            const fileEntries = manifest.entries.filter((e) => e.extractFile === file);
            const newData = {};
            for (const e of fileEntries) {
                const matchKey = Object.keys(gbEntry.data).find((cid) => {
                    var _a;
                    const d = gbEntry.data[cid];
                    return d.origin === ((_a = e.mv) === null || _a === void 0 ? void 0 : _a.originFile) && String(d.val) === e.dataPath;
                });
                if (matchKey === undefined) {
                    throw new types_1.OperationError(types_1.ErrorCodes.MAPPING_CORRUPT, `.extracteddata 항목을 찾을 수 없습니다: ${e.id}`);
                }
                newData[String(e.lineStart)] = { ...gbEntry.data[matchKey], m: e.lineEnd };
            }
            gbEntry.data = newData;
        }
        (0, atomic_1.atomicWriteFileSync)(edPath, zlib_1.default.deflateSync(iconv_lite_1.default.encode(JSON.stringify({ dat: ext_data }), 'utf8')));
    }
    else {
        // Wolf: _Extract/.extracteddata(msgpack+zlib) — textLineNumber를 새 줄 번호로 재구성
        const edPath = path_1.default.join(extractDir, '.extracteddata');
        const ca = (0, msgpack_1.decode)(zlib_1.default.inflateSync(fs_1.default.readFileSync(edPath)));
        for (const [file] of byFile) {
            const fileEntries = manifest.entries.filter((e) => e.extractFile === file);
            for (const e of fileEntries) {
                const idx = parseInt(e.id.substring(e.id.lastIndexOf('#') + 1), 10);
                const ext = (_a = ca.ext) === null || _a === void 0 ? void 0 : _a[idx];
                if (!ext) {
                    throw new types_1.OperationError(types_1.ErrorCodes.MAPPING_CORRUPT, `.extracteddata 항목을 찾을 수 없습니다: ${e.id}`);
                }
                const len = e.lineEnd - e.lineStart;
                ext.textLineNumber = Array.from({ length: len }, (_, k) => e.lineStart + k);
            }
        }
        (0, atomic_1.atomicWriteFileSync)(edPath, zlib_1.default.deflateSync(Buffer.from((0, msgpack_1.encode)(ca))));
    }
}
