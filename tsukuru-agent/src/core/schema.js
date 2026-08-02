"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUEST_SCHEMA_VERSION = void 0;
exports.emptyResult = emptyResult;
exports.validateRequest = validateRequest;
/**
 * tsukuru-agent CLI 요청/결과 스키마 (schemaVersion 1).
 * 계획서 §CLI 계약 구현.
 */
const types_1 = require("./types");
exports.REQUEST_SCHEMA_VERSION = 1;
function emptyResult() {
    return { ok: false, format: null, artifacts: [], stats: {}, warnings: [], error: null };
}
const OPERATIONS = ['verify', 'extract', 'patch', 'apply'];
const FORMATS = ['auto', 'rpgmv', 'wolf'];
const PROFILES = ['standard', 'full', 'advanced'];
function invalid(message, details) {
    return new types_1.OperationError(types_1.ErrorCodes.REQUEST_INVALID, message, details);
}
/** unknown 입력을 AgentRequest로 검증·기본값 보정한다. 실패 시 OperationError(E_REQUEST_INVALID). */
function validateRequest(raw) {
    var _a, _b, _c;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw invalid('요청은 JSON 객체여야 합니다');
    }
    const r = raw;
    if (r.schemaVersion !== exports.REQUEST_SCHEMA_VERSION) {
        throw invalid(`지원하지 않는 schemaVersion입니다: ${String(r.schemaVersion)}`, { expected: exports.REQUEST_SCHEMA_VERSION });
    }
    if (typeof r.operation !== 'string' || !OPERATIONS.includes(r.operation)) {
        throw invalid(`operation은 ${OPERATIONS.join('|')} 중 하나여야 합니다`, { got: r.operation });
    }
    if (r.format !== undefined && (typeof r.format !== 'string' || !FORMATS.includes(r.format))) {
        throw invalid(`format은 ${FORMATS.join('|')} 중 하나여야 합니다`, { got: r.format });
    }
    if (typeof r.projectPath !== 'string' || r.projectPath.trim() === '') {
        throw invalid('projectPath는 비어있지 않은 문자열이어야 합니다');
    }
    if (r.outputPath !== undefined && typeof r.outputPath !== 'string') {
        throw invalid('outputPath는 문자열이어야 합니다');
    }
    if (r.profile !== undefined && (typeof r.profile !== 'string' || !PROFILES.includes(r.profile))) {
        throw invalid(`profile은 ${PROFILES.join('|')} 중 하나여야 합니다`, { got: r.profile });
    }
    if (r.options !== undefined && (typeof r.options !== 'object' || r.options === null || Array.isArray(r.options))) {
        throw invalid('options는 객체여야 합니다');
    }
    const patches = [];
    if (r.patches !== undefined) {
        if (!Array.isArray(r.patches)) {
            throw invalid('patches는 배열이어야 합니다');
        }
        for (let i = 0; i < r.patches.length; i++) {
            const p = r.patches[i];
            if (typeof p !== 'object' || p === null) {
                throw invalid(`patches[${i}]는 객체여야 합니다`);
            }
            if (typeof p.id !== 'string' || p.id === '') {
                throw invalid(`patches[${i}].id는 비어있지 않은 문자열이어야 합니다`);
            }
            if (typeof p.expectedHash !== 'string' || !/^[0-9a-f]{64}$/i.test(p.expectedHash)) {
                throw invalid(`patches[${i}].expectedHash는 SHA-256 hex(64자)여야 합니다`);
            }
            if (typeof p.text !== 'string') {
                throw invalid(`patches[${i}].text는 문자열이어야 합니다`);
            }
            patches.push({ id: p.id, expectedHash: p.expectedHash.toLowerCase(), text: p.text });
        }
    }
    if (r.operation === 'patch' && patches.length === 0) {
        throw new types_1.OperationError(types_1.ErrorCodes.PATCH_EMPTY, 'patch 작업에는 최소 1개의 patches 항목이 필요합니다');
    }
    return {
        schemaVersion: exports.REQUEST_SCHEMA_VERSION,
        operation: r.operation,
        format: (_a = r.format) !== null && _a !== void 0 ? _a : 'auto',
        projectPath: r.projectPath,
        outputPath: r.outputPath,
        profile: (_b = r.profile) !== null && _b !== void 0 ? _b : 'standard',
        options: (_c = r.options) !== null && _c !== void 0 ? _c : {},
        patches,
    };
}
