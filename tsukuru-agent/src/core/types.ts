/**
 * Tsukuru agent 코어 추상화.
 * src/core/* 모듈은 Electron에 의존하지 않는다(GUI/CLI 양쪽에서 사용).
 */

/** 진행률 보고 인터페이스. GUI는 IPC 'loading', CLI는 stderr로 구현한다. */
export interface ProgressSink {
    /** 진행률 갱신(0~100). */
    set(percent: number): void;
    /** 작업 완료 알림(기존 GUI의 'alert2'에 해당). */
    done(): void;
    /** 작업 레이블 갱신(기존 GUI의 'loadingTag'에 해당). 선택 구현. */
    setTag?(tag: string): void;
}

/** 로그 인터페이스. CLI는 stderr, GUI는 console/IPC로 구현한다. */
export interface Logger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug(message: string): void;
}

/** 작업 실패를 나타내는 구조화 오류. code는 결과 JSON의 error.code로 그대로 노출된다. */
export class OperationError extends Error {
    readonly code: string;
    readonly details?: unknown;

    constructor(code: string, message: string, details?: unknown) {
        super(message);
        this.name = 'OperationError';
        this.code = code;
        this.details = details;
    }

    toJSON(): { code: string; message: string; details?: unknown } {
        return { code: this.code, message: this.message, details: this.details };
    }
}

/** 구조화 오류 코드. 결과 JSON 계약의 error.code 값들. */
export const ErrorCodes = {
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
} as const;

/** unknown 값을 OperationError로 정규화한다. */
export function toOperationError(err: unknown): OperationError {
    if (err instanceof OperationError) {
        return err;
    }
    if (err instanceof Error) {
        return new OperationError(ErrorCodes.INTERNAL, err.message, { stack: err.stack });
    }
    return new OperationError(ErrorCodes.INTERNAL, String(err));
}
