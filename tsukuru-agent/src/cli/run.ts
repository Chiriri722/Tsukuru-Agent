#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { AgentRequest, AgentResult, emptyResult, validateRequest, validateResolvedRequest } from '../core/schema';
import { ErrorCodes, OperationError, toOperationError } from '../core/types';
import { isFormatCompatible } from './compatibilityPolicy';
import { dispatchOperation, OperationHandlers } from './dispatcher';
import { selectEngineAdapter } from './engineRegistry';
import { runCli } from './entrypoint';
import { detectProject, DetectedProject } from './formatDetect';
import { handleApply } from './operations/apply';
import { handleExtract, rpgPackFlags } from './operations/extract';
import { handlePatch } from './operations/patch';
import { handleRecover } from './operations/recover';
import { handleVerify } from './operations/verify';
import { finalizeAgentResult } from '../core/contracts/resultContract';
import {
    disposeOperationRuntime,
    getOperationTelemetry,
    OperationRuntime,
    runOperationStage,
    throwIfOperationAborted,
} from '../core/operationRuntime';
import { buildCliOperationRuntime } from './operationContext';
import os from 'os';
import { assertDiagnosticReportTarget, writeDiagnosticReport } from '../core/diagnostics';
import { inspectResourcePreflight } from '../core/resourcePolicy';
import { publicErrorMessage } from '../core/publicError';
import { assertReviewTarget } from './operations/verify/manifest';
import { inspectContainer } from '../core/container';
import { rpgPackEstimatedTempBytes } from '../core/rpgTranslationPack';

function normalizeDetectionError(error: unknown): OperationError {
    if (error instanceof OperationError) return error;
    const code = error instanceof Error && error.message.includes('제한 초과')
        ? ErrorCodes.RESOURCE_LIMIT_EXCEEDED
        : ErrorCodes.VERIFY_FAILED;
    return new OperationError(
        code,
        publicErrorMessage(error, '프로젝트/컨테이너 안전성 검사에 실패했습니다'),
    );
}

function resolveProject(request: AgentRequest): DetectedProject {
    if (!fs.existsSync(request.projectPath)) {
        throw new OperationError(
            ErrorCodes.PATH_NOT_FOUND,
            '프로젝트 경로가 존재하지 않습니다',
            { projectPath: request.projectPath },
        );
    }
    const limits = request.options.resourceLimits;
    const containerLimits = limits ? {
        ...(limits.maxFiles !== undefined ? { maxFiles: limits.maxFiles } : {}),
        ...(limits.maxInputBytes !== undefined ? { maxBytes: limits.maxInputBytes } : {}),
        ...(limits.maxFileBytes !== undefined ? { maxFileBytes: limits.maxFileBytes } : {}),
    } : {};
    let detected: DetectedProject | null;
    try {
        detected = detectProject(request.projectPath, containerLimits);
    } catch (error) {
        throw normalizeDetectionError(error);
    }
    if (!detected) {
        throw new OperationError(
            ErrorCodes.FORMAT_UNKNOWN,
            '프로젝트 포맷을 판별할 수 없습니다(data 폼더의 .json/.mps 또는 Data.wolf를 찾지 못했습니다)',
            { projectPath: request.projectPath },
        );
    }
    if (!isFormatCompatible(request.format, detected)) {
        throw new OperationError(
            ErrorCodes.FORMAT_MISMATCH,
            `요청 포맷(${request.format})과 실제 포맷(${detected.format})이 다릅니다`,
            { detected },
        );
    }
    selectEngineAdapter(detected);
    return detected;
}

function attachDiagnostics(detected: DetectedProject, result: AgentResult): void {
    const container = detected.container;
    if (!container) return;
    result.container = {
        type: container.type,
        path: container.archivePath
            ? path.relative(container.rootPath, container.archivePath).replace(/\\/g, '/')
            : null,
        root: container.engine.root,
        confidence: container.engine.confidence,
        integrity: container.archive?.integrity,
        invalidEntryCount: container.archive?.invalidEntryCount ?? 0,
    };
    result.engine = {
        type: container.engine.type === 'unknown' ? detected.format : container.engine.type,
        wrapper: container.engine.wrapper,
        features: container.engine.features,
        confidence: container.engine.confidence,
    };
}

const operationHandlers: OperationHandlers = {
    verify: handleVerify,
    extract: handleExtract,
    patch: handlePatch,
    apply: handleApply,
    recover: handleRecover,
};

export interface ExecuteAgentRequestOptions {
    signal?: AbortSignal;
}

export async function executeAgentRequest(
    rawRequest: unknown,
    executionOptions: ExecuteAgentRequestOptions = {},
): Promise<AgentResult> {
    const resultSchemaVersion = typeof rawRequest === 'object' && rawRequest !== null
        && !Array.isArray(rawRequest) && (rawRequest as Record<string, unknown>).schemaVersion === 2 ? 2 : 1;
    const result = emptyResult(resultSchemaVersion);
    let runtime: OperationRuntime | undefined;
    let request: AgentRequest | undefined;
    let resourceReport: ReturnType<typeof inspectResourcePreflight> | undefined;
    try {
        request = validateRequest(rawRequest);
        const diagnosticReportPath = request.options.diagnosticReportPath;
        runtime = buildCliOperationRuntime({
            signal: executionOptions.signal,
            timeoutMs: request.options.operationTimeoutMs,
            protectedPaths: [
                { path: request.projectPath, label: 'project' },
                ...(request.outputPath ? [{ path: request.outputPath, label: 'output' }] : []),
                ...(diagnosticReportPath ? [{ path: diagnosticReportPath, label: 'diagnostics' }] : []),
                { path: os.tmpdir(), label: 'temp' },
            ],
        });
        const detected = await runOperationStage(runtime, 'detection', () => {
            throwIfOperationAborted(runtime!, 'before-detection');
            if (diagnosticReportPath) assertDiagnosticReportTarget(diagnosticReportPath, request!.projectPath);
            const resolved = resolveProject(request);
            validateResolvedRequest(request, resolved.format);
            if (resolved.translationPack && request.operation === 'recover') {
                throw new OperationError(ErrorCodes.NOT_IMPLEMENTED, '번역 작업팩의 원문/매핑 복구는 원본 게임에서 다시 추출하세요');
            }
            assertReviewTarget(request, resolved.dataDir);
            result.format = resolved.format;
            attachDiagnostics(resolved, result);
            return resolved;
        });
        resourceReport = await runOperationStage(runtime, 'preflight', () => (
            inspectResourcePreflight(request!.projectPath, request!.operation, request!.options.resourceLimits, {
                signal: runtime!.signal,
                ...(detected.translationPack && request!.operation === 'apply' && request!.options.containerSourcePath ? {
                    additionalInputPaths: [inspectContainer(request!.options.containerSourcePath).rootPath],
                } : {}),
                ...(request!.operation === 'extract' && request!.options.translationPack === true && detected.container ? {
                    estimatedTempBytes: rpgPackEstimatedTempBytes(detected.container, rpgPackFlags(request!)),
                } : {}),
            })
        ));
        await runOperationStage(runtime, request.operation, () => (
            dispatchOperation(request, detected, result, operationHandlers, runtime!)
        ));
    } catch (error) {
        const reviewPath = request?.schemaVersion === 2 && request.options.review?.reportPath;
        if (reviewPath && result.artifacts.includes(path.resolve(reviewPath))) {
            fs.rmSync(path.resolve(reviewPath), { force: true });
            result.artifacts = result.artifacts.filter(artifact => artifact !== path.resolve(reviewPath));
            delete result.stats.review;
        }
        const operationError = toOperationError(error);
        result.ok = false;
        result.error = operationError.toJSON();
    } finally {
        if (runtime) {
            if (resourceReport) result.stats.resources = resourceReport;
            if (resultSchemaVersion === 2) result.stats.performance = getOperationTelemetry(runtime);
            disposeOperationRuntime(runtime);
        }
    }
    const diagnosticReportPath = request?.options.diagnosticReportPath;
    const reviewReportPath = request?.schemaVersion === 2 ? request.options.review?.reportPath : undefined;
    const reportCollision = diagnosticReportPath && reviewReportPath
        && path.relative(path.resolve(diagnosticReportPath), path.resolve(reviewReportPath)) === '';
    if (request && diagnosticReportPath && !reportCollision) {
        const resolvedReportPath = path.resolve(diagnosticReportPath);
        result.artifacts.push(resolvedReportPath);
        try {
            writeDiagnosticReport(resolvedReportPath, {
                schemaVersion: 1,
                createdAt: new Date().toISOString(),
                request: { ...request, options: { ...request.options,
                    ...(request.options.review !== undefined ? { review: '<omitted-private-review-configuration>' } : {}),
                } },
                result,
            }, {
                forbiddenRoot: request.projectPath,
                protectedRoots: [
                    { path: request.projectPath, label: 'project' },
                    ...(request.outputPath ? [{ path: request.outputPath, label: 'output' }] : []),
                    ...(reviewReportPath ? [{ path: reviewReportPath, label: 'review' }] : []),
                    { path: resolvedReportPath, label: 'diagnostics' },
                    { path: os.tmpdir(), label: 'temp' },
                ],
            });
        } catch (error) {
            result.artifacts = result.artifacts.filter((artifact) => artifact !== resolvedReportPath);
            const reportError = toOperationError(error);
            result.warnings.push(`진단 보고서를 작성하지 못했습니다: ${reportError.message}`);
        }
    }
    return finalizeAgentResult(result, resultSchemaVersion);
}

/** Node/Electron 공용 실행기. argv는 `run` 서브커맨드부터 시작한다. */
export async function runAgent(argv: string[]): Promise<number> {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once('SIGINT', cancel);
    process.once('SIGTERM', cancel);
    try {
        return await runCli(argv, (request) => executeAgentRequest(request, { signal: controller.signal }));
    } finally {
        process.removeListener('SIGINT', cancel);
        process.removeListener('SIGTERM', cancel);
    }
}
