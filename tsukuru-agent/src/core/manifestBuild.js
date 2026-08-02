"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRpgManifest = buildRpgManifest;
exports.buildWolfManifest = buildWolfManifest;
/**
 * 추출 결과로부터 Extract/manifest.json을 생성하는 빌더 (계획서 §Manifest와 안전성).
 *
 * hash 규칙: 작업용 txt에 기록된 원문(해당 항목의 줄 범위 내용을 '\n'으로 결합한
 * 형태)의 UTF-8 SHA-256. patch의 expectedHash는 이 값과 비교한다.
 * - MV: .extracteddata의 originText(txt 기록 형태와 동일)
 * - Wolf: decodeEncoding + 백슬래시 이스케이프 + 널 종료 제거 후 txt 기록 형태
 */
const path_1 = __importDefault(require("path"));
const manifest_1 = require("./manifest");
const utils_1 = require("../utils");
/** RPG MV/MZ: 추출이 끝난 직후의 ctx().rpg.gb로부터 manifest를 생성한다. */
function buildRpgManifest(gb) {
    var _a, _b, _c, _d, _e;
    const manifest = (0, manifest_1.createManifest)('rpgmv');
    for (const jpath of Object.keys(gb)) {
        const data = (_a = gb[jpath].data) !== null && _a !== void 0 ? _a : {};
        // extractFile은 추출 디렉터리(Extract/ 또는 _Extract/) 기준 상대 경로로 통일한다.
        const extractFile = jpath === 'ext_javascript.json'
            ? 'ext_javascript.js'
            : `${path_1.default.parse(jpath).name}.txt`;
        for (const cid of Object.keys(data)) {
            const e = data[cid];
            const lineStart = parseInt(cid);
            const originText = ((_b = e.originText) !== null && _b !== void 0 ? _b : '');
            manifest.entries.push({
                id: `${e.origin}#${e.val}`,
                sourceFile: `Backup/${e.origin}`,
                dataPath: String(e.val),
                extractFile,
                lineStart,
                lineEnd: (_c = e.m) !== null && _c !== void 0 ? _c : lineStart,
                hash: (0, manifest_1.sha256Text)(originText),
                encoding: 'utf8',
                nullTerminated: false,
                mv: {
                    qpath: (_d = e.qpath) !== null && _d !== void 0 ? _d : '',
                    conf: e.conf,
                    endLine: (_e = e.m) !== null && _e !== void 0 ? _e : lineStart,
                    originFile: e.origin,
                },
            });
        }
    }
    return manifest;
}
/**
 * Wolf: makeText 완료 직후의 ctx().wolf.extData로부터 manifest를 생성한다.
 * (endsWithNull/textLineNumber가 채워진 상태여야 한다)
 */
function buildWolfManifest(extData, sourceDir, encoding) {
    var _a, _b;
    const manifest = (0, manifest_1.createManifest)('wolf');
    for (let i = 0; i < extData.length; i++) {
        const e = extData[i];
        // makeText와 동일한 변환 순서(디코딩 → 이스케이프 → 널 제거)로 txt 표기를 재현한다.
        let decoded = (0, utils_1.decodeEncoding)(e.str.str).replaceAll('\\\\', '\\\\\\\\');
        if (decoded.endsWith('\0')) {
            decoded = decoded.substring(0, decoded.length - 1);
        }
        const rel = sourceDir ? path_1.default.relative(sourceDir, e.sourceFile) : e.sourceFile;
        const lines = ((_a = e.textLineNumber) !== null && _a !== void 0 ? _a : []).slice().sort((a, b) => a - b);
        manifest.entries.push({
            id: `${rel || e.sourceFile}#${i}`,
            sourceFile: rel || e.sourceFile,
            dataPath: e.codeStr,
            extractFile: `Texts/${e.extractFile}.txt`,
            lineStart: lines.length > 0 ? lines[0] : 0,
            lineEnd: lines.length > 0 ? lines[lines.length - 1] + 1 : 0,
            hash: (0, manifest_1.sha256Text)(decoded),
            encoding,
            nullTerminated: (_b = e.endsWithNull) !== null && _b !== void 0 ? _b : false,
            wolf: {
                sourceFile: e.sourceFile,
                pos1: e.str.pos1,
                pos2: e.str.pos2,
                pos3: e.str.pos3,
                len: e.str.len,
            },
        });
    }
    return manifest;
}
