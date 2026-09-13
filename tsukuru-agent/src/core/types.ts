/**
 * Tsukuru agent 코어 추상화.
 * src/core/* 모듈은 Electron에 의존하지 않는다(GUI/CLI 양쪽에서 사용).
 */

/** 에이전트와 GUI가 함께 소비할 수 있는 구조화 진행 이벤트. */
export interface ProgressEvent {
    stage: string;
    completed: number;
    total: number;
    unit: string;
    operationId: string;
}

/** 진행률 보고 인터페이스. GUI는 IPC 'loading', CLI는 stderr로 구현한다. */
export interface ProgressSink {
    /** 진행률 갱신(0~100). */
    set(percent: number): void;
    /** 작업 완료 알림(기존 GUI의 'alert2'에 해당). */
    done(): void;
    /** 작업 레이블 갱신(기존 GUI의 'loadingTag'에 해당). 선택 구현. */
    setTag?(tag: string): void;
    /** 기계 판독 가능한 단계별 진행 이벤트. 선택 구현. */
    report?(event: ProgressEvent): void;
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
    TRANSLATION_LINT: 'E_TRANSLATION_LINT',
    MAPPING_CORRUPT: 'E_MAPPING_CORRUPT',
    WOLF_BYTES_MISMATCH: 'E_WOLF_BYTES_MISMATCH',
    VERIFY_FAILED: 'E_VERIFY_FAILED',
    CONTAINER_PROVENANCE_INVALID: 'E_CONTAINER_PROVENANCE_INVALID',
    RUNTIME_INTEGRITY: 'E_RUNTIME_INTEGRITY',
    LAUNCH_PROBE_FAILED: 'E_LAUNCH_PROBE_FAILED',
    SOURCE_CHANGED: 'E_SOURCE_CHANGED',
    OPERATION_CANCELLED: 'E_OPERATION_CANCELLED',
    OPERATION_TIMEOUT: 'E_OPERATION_TIMEOUT',
    RESOURCE_LIMIT_EXCEEDED: 'E_RESOURCE_LIMIT_EXCEEDED',
    RESOURCE_PREFLIGHT_UNAVAILABLE: 'E_RESOURCE_PREFLIGHT_UNAVAILABLE',
    TEMP_SPACE_INSUFFICIENT: 'E_TEMP_SPACE_INSUFFICIENT',
    EXPERIMENTAL_FEATURE_DISABLED: 'E_EXPERIMENTAL_FEATURE_DISABLED',
    EXPERIMENTAL_FEATURE_UNSAFE: 'E_EXPERIMENTAL_FEATURE_UNSAFE',
    EXTERNAL_BINARY_INTEGRITY: 'E_EXTERNAL_BINARY_INTEGRITY',
    ENCODING_UNREPRESENTABLE: 'E_ENCODING_UNREPRESENTABLE',
    IPC_PAYLOAD_INVALID: 'E_IPC_PAYLOAD_INVALID',
    IPC_CHANNEL_UNKNOWN: 'E_IPC_CHANNEL_UNKNOWN',
    IPC_SENDER_INVALID: 'E_IPC_SENDER_INVALID',
    IPC_ROUTE_INVALID: 'E_IPC_ROUTE_INVALID',
    EXTERNAL_URL_INVALID: 'E_EXTERNAL_URL_INVALID',
    LOCAL_PATH_INVALID: 'E_LOCAL_PATH_INVALID',
    IPC_INTERNAL: 'E_IPC_INTERNAL',
    NOT_IMPLEMENTED: 'E_NOT_IMPLEMENTED',
    INTERNAL: 'E_INTERNAL',
} as const;

/** 구조화 warning code. v2 result의 warningDetails.code 값들. */
export const WarningCodes = {
    LEGACY_MESSAGE: 'W_LEGACY_MESSAGE',
    STRUCTURAL_VALIDATION: 'W_STRUCTURAL_VALIDATION',
    TRANSLATION_ENTRY_SKIPPED: 'W_TRANSLATION_ENTRY_SKIPPED',
    TRANSLATION_REVIEW: 'W_TRANSLATION_REVIEW',
    EXTRACTION_INCOMPLETE: 'W_EXTRACTION_INCOMPLETE',
    CONTAINER_DIAGNOSTIC: 'W_CONTAINER_DIAGNOSTIC',
    RUNTIME_DIAGNOSTIC: 'W_RUNTIME_DIAGNOSTIC',
} as const;

export type WarningCode = typeof WarningCodes[keyof typeof WarningCodes];

/** unknown 값을 OperationError로 정규화한다. */
export function toOperationError(err: unknown): OperationError {
    if (err instanceof OperationError) {
        return err;
    }
    return new OperationError(ErrorCodes.INTERNAL, '내부 오류가 발생했습니다');
}
