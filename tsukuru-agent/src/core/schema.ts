/**
 * tsukuru-agent CLI 요청/결과 스키마 (schemaVersion 2, v1 호환).
 * 계획서 §CLI 계약 구현.
 */
import { OperationError, ErrorCodes } from './types';
import type { ElectronRuntimeInspection } from './runtimeDiagnostics';
import type { StructuralValidationReport } from './validator';

export const REQUEST_SCHEMA_VERSION = 2;
export const SUPPORTED_REQUEST_SCHEMA_VERSIONS = [1, 2] as const;

export type Operation = 'verify' | 'extract' | 'patch' | 'apply' | 'recover';
export type RequestFormat = 'auto' | 'rpgmv' | 'rpgmz' | 'rpgmz-electron' | 'wolf' | 'gdevelop-electron' | 'tyrano' | 'nwjs-webgame';
export type Profile = 'standard' | 'full' | 'advanced';
export type DetectedFormat = 'rpgmv' | 'rpgmz' | 'wolf' | 'gdevelop' | 'tyrano' | 'nwjs' | 'unknown';

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

export interface ResultContainer {
    type: string;
    path: string | null;
    root: string;
    confidence: number;
    integrity?: string;
    invalidEntryCount: number;
}

export interface ResultEngine {
    type: string;
    wrapper: string | null;
    features: string[];
    confidence: number;
}

export interface ResultScores {
    total: number;
    extractionCoverage: number;
    mappingIntegrity: number;
    reinsertionValidity: number;
    protectedScriptIntegrity: number;
    containerIntegrity: number;
    risk: 'low' | 'medium' | 'high' | 'critical';
}

export interface ResultChange {
    filesChanged: number;
    bytesChanged: number;
    textBytesChanged: number;
    protectedFilesChanged: number;
    protectedScriptDamage: number;
}

/** stdout에 출력되는 최종 결과 JSON 계약. */
export interface AgentResult {
    ok: boolean;
    format: DetectedFormat | null;
    artifacts: string[];
    stats: { [key: string]: unknown };
    warnings: string[];
    error: ResultError | null;
    container?: ResultContainer;
    engine?: ResultEngine;
    scores?: ResultScores;
    change?: ResultChange;
    runtime?: ElectronRuntimeInspection;
    validation?: StructuralValidationReport;
}

export function emptyResult(): AgentResult {
    return { ok: false, format: null, artifacts: [], stats: {}, warnings: [], error: null };
}

const OPERATIONS: Operation[] = ['verify', 'extract', 'patch', 'apply', 'recover'];
const FORMATS: RequestFormat[] = ['auto', 'rpgmv', 'rpgmz', 'rpgmz-electron', 'wolf', 'gdevelop-electron', 'tyrano', 'nwjs-webgame'];
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

    if (typeof r.schemaVersion !== 'number' || !SUPPORTED_REQUEST_SCHEMA_VERSIONS.includes(r.schemaVersion as 1 | 2)) {
        throw invalid(`지원하지 않는 schemaVersion입니다: ${String(r.schemaVersion)}`, { expected: SUPPORTED_REQUEST_SCHEMA_VERSIONS });
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
    const options = (r.options as { [key: string]: unknown } | undefined) ?? {};
    if (options.translationDirectory !== undefined
        && (typeof options.translationDirectory !== 'string' || options.translationDirectory.trim() === '')) {
        throw invalid('options.translationDirectory는 비어있지 않은 문자열이어야 합니다');
    }
    if (options.launchProbe !== undefined && typeof options.launchProbe !== 'boolean') {
        throw invalid('options.launchProbe는 boolean이어야 합니다');
    }
    if (options.launchProbe === true && r.operation !== 'apply') {
        throw invalid('options.launchProbe는 apply 작업에서만 사용할 수 있습니다');
    }
    if (options.launchTimeoutMs !== undefined
        && (typeof options.launchTimeoutMs !== 'number'
            || !Number.isInteger(options.launchTimeoutMs)
            || options.launchTimeoutMs < 250
            || options.launchTimeoutMs > 15_000)) {
        throw invalid('options.launchTimeoutMs는 250~15000 범위의 정수여야 합니다');
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
    if (patches.length > 0 && options.translationDirectory !== undefined) {
        throw invalid('patches와 options.translationDirectory는 동시에 사용할 수 없습니다');
    }
    if (r.operation === 'patch' && patches.length === 0 && options.translationDirectory === undefined) {
        throw new OperationError(ErrorCodes.PATCH_EMPTY, 'patch 작업에는 최소 1개의 patches 항목이 필요합니다');
    }

    return {
        schemaVersion: r.schemaVersion as number,
        operation: r.operation as Operation,
        format: (r.format as RequestFormat) ?? 'auto',
        projectPath: r.projectPath,
        outputPath: r.outputPath as string | undefined,
        profile: (r.profile as Profile) ?? 'standard',
        options,
        patches,
    };
}
