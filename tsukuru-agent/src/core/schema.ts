/**
 * tsukuru-agent CLI 요청/결과 스키마 (schemaVersion 2, v1 호환).
 * 계획서 §CLI 계약 구현.
 */
import { OperationError, ErrorCodes, WarningCode } from './types';
import type { ElectronRuntimeInspection } from './runtimeDiagnostics';
import type { StructuralValidationReport } from './validator';
import { validateContract } from './contracts/schemaRegistry';
import type { ResourceLimits } from './resourcePolicy';
import type { TranslationQualityReport } from './translationLint';

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

export interface CommonRequestOptions {
    operationTimeoutMs?: number;
    diagnosticReportPath?: string;
    resourceLimits?: ResourceLimits;
    experimentalNwDirectory?: boolean;
    experimentalNwAppendedZip?: boolean;
    experimentalMalformedAsarRepack?: boolean;
    experimentalGdevelopCodeStrings?: boolean;
}

export interface VerifyOptions extends CommonRequestOptions {
    verifyDepth?: 'shallow' | 'deep';
    humanSummary?: boolean;
}

export interface RpgExtractRequestOptions extends CommonRequestOptions {
    force?: boolean;
    ext_plugin?: boolean;
    ext_src?: boolean;
    ext_javascript?: boolean;
    ext_note?: boolean;
    exJson?: boolean;
    autoline?: boolean;
    decryptImg?: boolean;
    decryptAudio?: boolean;
}

export interface WolfExtractRequestOptions extends CommonRequestOptions {
    force?: boolean;
    extPattern?: boolean;
    extBuran?: boolean;
    extAll?: boolean;
}

export interface PatchOptions extends CommonRequestOptions {
    translationDirectory?: string;
}

export interface ApplyOptions extends CommonRequestOptions {
    force?: boolean;
    translationDirectory?: string;
    containerSourcePath?: string;
    launchProbe?: boolean;
    launchTimeoutMs?: number;
    autoline?: boolean;
    isComment?: boolean;
    useYaml?: boolean;
}

export interface RecoverOptions extends CommonRequestOptions {
    dryRun?: boolean;
    conflictPolicy?: 'backup-and-replace' | 'fail-if-present';
}

export type RequestOptions = CommonRequestOptions & VerifyOptions & RpgExtractRequestOptions & WolfExtractRequestOptions & PatchOptions & ApplyOptions & RecoverOptions;
export interface LegacyRequestOptions extends RequestOptions { [key: string]: unknown }

interface AgentRequestV2Base<T extends Operation, O extends object> {
    schemaVersion: 2;
    operation: T;
    format: RequestFormat;
    projectPath: string;
    outputPath?: string;
    profile: Profile;
    options: O;
    patches: PatchEntry[];
}

/** v2의 operation discriminant를 보존하는 정적 요청 타입. */
export type AgentRequestV2 =
    | AgentRequestV2Base<'verify', VerifyOptions>
    | AgentRequestV2Base<'extract', RpgExtractRequestOptions | WolfExtractRequestOptions>
    | AgentRequestV2Base<'patch', PatchOptions>
    | AgentRequestV2Base<'apply', ApplyOptions>
    | AgentRequestV2Base<'recover', RecoverOptions>;

export interface AgentRequest {
    schemaVersion: 1 | 2;
    operation: Operation;
    format: RequestFormat;
    projectPath: string;
    outputPath?: string;
    profile: Profile;
    options: RequestOptions | LegacyRequestOptions;
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

export interface ResultWarning {
    code: WarningCode;
    message: string;
    details?: unknown;
}

/** stdout에 출력되는 최종 결과 JSON 계약. */
export interface AgentResult {
    schemaVersion?: 2;
    ok: boolean;
    format: DetectedFormat | null;
    artifacts: string[];
    stats: { [key: string]: unknown };
    warnings: string[];
    warningDetails?: ResultWarning[];
    error: ResultError | null;
    container?: ResultContainer;
    engine?: ResultEngine;
    scores?: ResultScores;
    change?: ResultChange;
    runtime?: ElectronRuntimeInspection;
    validation?: StructuralValidationReport;
    translationQuality?: TranslationQualityReport;
}

export function emptyResult(schemaVersion: 1 | 2 = 1): AgentResult {
    return {
        ...(schemaVersion === 2 ? { schemaVersion: 2 as const, warningDetails: [] } : {}),
        ok: false,
        format: null,
        artifacts: [],
        stats: {},
        warnings: [],
        error: null,
    };
}

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
    const schemaVersion = r.schemaVersion as 1 | 2;
    const candidate: Record<string, unknown> = {
        ...r,
        format: r.format ?? 'auto',
        profile: r.profile ?? 'standard',
        options: r.options ?? {},
        patches: r.patches ?? [],
    };
    const validation = validateContract('request', schemaVersion, candidate);
    if (!validation.ok) {
        const patchMissing = candidate.operation === 'patch'
            && Array.isArray(candidate.patches) && candidate.patches.length === 0
            && (typeof candidate.options !== 'object' || candidate.options === null
                || !('translationDirectory' in candidate.options));
        if (patchMissing) {
            throw new OperationError(ErrorCodes.PATCH_EMPTY, 'patch 작업에는 최소 1개의 patches 항목이 필요합니다');
        }
        throw invalid('요청 스키마 검증에 실패했습니다', { violations: validation.errors });
    }
    const normalizedPatches = (candidate.patches as PatchEntry[]).map((patch) => ({
        id: patch.id,
        expectedHash: patch.expectedHash.toLowerCase(),
        text: patch.text,
    }));
    return {
        schemaVersion,
        operation: candidate.operation as Operation,
        format: candidate.format as RequestFormat,
        projectPath: candidate.projectPath as string,
        ...(candidate.outputPath !== undefined ? { outputPath: candidate.outputPath as string } : {}),
        profile: candidate.profile as Profile,
        options: candidate.options as RequestOptions | LegacyRequestOptions,
        patches: normalizedPatches,
    };
}

/** auto format 탐지 뒤 실제 엔진과 옵션 조합을 작업 시작 전에 재검증한다. */
export function validateResolvedRequest(request: AgentRequest, format: DetectedFormat): AgentRequest {
    if (request.schemaVersion === 1) return request;
    const validation = validateContract('engine-options', 2, {
        operation: request.operation,
        format,
        options: request.options,
    });
    const unsupportedOperation = (request.operation === 'recover' && format !== 'rpgmv' && format !== 'rpgmz')
        || (format === 'nwjs' && request.operation !== 'verify')
        || format === 'unknown';
    if (!validation.ok || unsupportedOperation) {
        throw invalid('탐지된 엔진과 요청 옵션 조합이 호환되지 않습니다', {
            operation: request.operation,
            format,
            violations: validation.errors,
        });
    }
    return request;
}
