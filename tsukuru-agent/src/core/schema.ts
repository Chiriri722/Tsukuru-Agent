/**
 * tsukuru-agent CLI 요청/결과 스키마 (schemaVersion 1).
 * 계획서 §CLI 계약 구현.
 */
import { OperationError, ErrorCodes } from './types';

export const REQUEST_SCHEMA_VERSION = 1;

export type Operation = 'verify' | 'extract' | 'patch' | 'apply';
export type RequestFormat = 'auto' | 'rpgmv' | 'wolf';
export type Profile = 'standard' | 'full' | 'advanced';
export type DetectedFormat = 'rpgmv' | 'wolf';

export interface PatchEntry {
    id: string;
    expectedHash: string;
    text: string;
}

export interface AgentRequest {
    schemaVersion: number;
    operation: Operation;
    format: RequestFormat;
    projectPath: string;
    outputPath?: string;
    profile: Profile;
    options: { [key: string]: unknown };
    patches: PatchEntry[];
}

export interface ResultError {
    code: string;
    message: string;
    details?: unknown;
}

/** stdout에 출력되는 최종 결과 JSON 계약. */
export interface AgentResult {
    ok: boolean;
    format: DetectedFormat | null;
    artifacts: string[];
    stats: { [key: string]: number };
    warnings: string[];
    error: ResultError | null;
}

export function emptyResult(): AgentResult {
    return { ok: false, format: null, artifacts: [], stats: {}, warnings: [], error: null };
}

const OPERATIONS: Operation[] = ['verify', 'extract', 'patch', 'apply'];
const FORMATS: RequestFormat[] = ['auto', 'rpgmv', 'wolf'];
const PROFILES: Profile[] = ['standard', 'full', 'advanced'];

function invalid(message: string, details?: unknown): OperationError {
    return new OperationError(ErrorCodes.REQUEST_INVALID, message, details);
}

/** unknown 입력을 AgentRequest로 검증·기본값 보정한다. 실패 시 OperationError(E_REQUEST_INVALID). */
export function validateRequest(raw: unknown): AgentRequest {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw invalid('요청은 JSON 객체여야 합니다');
    }
    const r = raw as { [key: string]: unknown };

    if (r.schemaVersion !== REQUEST_SCHEMA_VERSION) {
        throw invalid(`지원하지 않는 schemaVersion입니다: ${String(r.schemaVersion)}`, { expected: REQUEST_SCHEMA_VERSION });
    }
    if (typeof r.operation !== 'string' || !OPERATIONS.includes(r.operation as Operation)) {
        throw invalid(`operation은 ${OPERATIONS.join('|')} 중 하나여야 합니다`, { got: r.operation });
    }
    if (r.format !== undefined && (typeof r.format !== 'string' || !FORMATS.includes(r.format as RequestFormat))) {
        throw invalid(`format은 ${FORMATS.join('|')} 중 하나여야 합니다`, { got: r.format });
    }
    if (typeof r.projectPath !== 'string' || r.projectPath.trim() === '') {
        throw invalid('projectPath는 비어있지 않은 문자열이어야 합니다');
    }
    if (r.outputPath !== undefined && typeof r.outputPath !== 'string') {
        throw invalid('outputPath는 문자열이어야 합니다');
    }
    if (r.profile !== undefined && (typeof r.profile !== 'string' || !PROFILES.includes(r.profile as Profile))) {
        throw invalid(`profile은 ${PROFILES.join('|')} 중 하나여야 합니다`, { got: r.profile });
    }
    if (r.options !== undefined && (typeof r.options !== 'object' || r.options === null || Array.isArray(r.options))) {
        throw invalid('options는 객체여야 합니다');
    }

    const patches: PatchEntry[] = [];
    if (r.patches !== undefined) {
        if (!Array.isArray(r.patches)) {
            throw invalid('patches는 배열이어야 합니다');
        }
        for (let i = 0; i < r.patches.length; i++) {
            const p = r.patches[i] as { [key: string]: unknown };
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
        throw new OperationError(ErrorCodes.PATCH_EMPTY, 'patch 작업에는 최소 1개의 patches 항목이 필요합니다');
    }

    return {
        schemaVersion: REQUEST_SCHEMA_VERSION,
        operation: r.operation as Operation,
        format: (r.format as RequestFormat) ?? 'auto',
        projectPath: r.projectPath,
        outputPath: r.outputPath as string | undefined,
        profile: (r.profile as Profile) ?? 'standard',
        options: (r.options as { [key: string]: unknown }) ?? {},
        patches,
    };
}
