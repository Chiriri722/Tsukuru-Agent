"use strict";
/**
 * Tsukuru agent 코어 추상화.
 * src/core/* 모듈은 Electron에 의존하지 않는다(GUI/CLI 양쪽에서 사용).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorCodes = exports.OperationError = void 0;
exports.toOperationError = toOperationError;
/** 작업 실패를 나타내는 구조화 오류. code는 결과 JSON의 error.code로 그대로 노출된다. */
class OperationError extends Error {
    constructor(code, message, details) {
        super(message);
        this.name = 'OperationError';
        this.code = code;
        this.details = details;
    }
    toJSON() {
        return { code: this.code, message: this.message, details: this.details };
    }
}
exports.OperationError = OperationError;
/** 구조화 오류 코드. 결과 JSON 계약의 error.code 값들. */
exports.ErrorCodes = {
    REQUEST_INVALID: 'E_REQUEST_INVALID',
    PATH_NOT_FOUND: 'E_PATH_NOT_FOUND',
    FORMAT_UNKNOWN: 'E_FORMAT_UNKNOWN',
    FORMAT_MISMATCH: 'E_FORMAT_MISMATCH',
    OUTPUT_CONFLICT: 'E_OUTPUT_CONFLICT',
    EXTRACT_EXISTS: 'E_EXTRACT_EXISTS',
    MANIFEST_MISSING: 'E_MANIFEST_MISSING',
    MANIFEST_CORRUPT: 'E_MANIFEST_CORRUPT',
    PATCH_EMPTY: 'E_PATCH_EMPTY',
    PATCH_NOT_FOUND: 'E_PATCH_NOT_FOUND',
    PATCH_DUPLICATE_ID: 'E_PATCH_DUPLICATE_ID',
    PATCH_HASH_MISMATCH: 'E_PATCH_HASH_MISMATCH',
    MAPPING_CORRUPT: 'E_MAPPING_CORRUPT',
    WOLF_BYTES_MISMATCH: 'E_WOLF_BYTES_MISMATCH',
    VERIFY_FAILED: 'E_VERIFY_FAILED',
    NOT_IMPLEMENTED: 'E_NOT_IMPLEMENTED',
    INTERNAL: 'E_INTERNAL',
};
/** unknown 값을 OperationError로 정규화한다. */
function toOperationError(err) {
    if (err instanceof OperationError) {
        return err;
    }
    if (err instanceof Error) {
        return new OperationError(exports.ErrorCodes.INTERNAL, err.message, { stack: err.stack });
    }
    return new OperationError(exports.ErrorCodes.INTERNAL, String(err));
}
