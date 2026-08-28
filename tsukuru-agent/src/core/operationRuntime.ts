import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Logger, ProgressSink, ErrorCodes, OperationError } from './types';

export interface OperationClock {
    now(): number;
}

export interface OperationFilesystem {
    existsSync: typeof fs.existsSync;
    lstatSync: typeof fs.lstatSync;
    readFileSync: typeof fs.readFileSync;
    writeFileSync: typeof fs.writeFileSync;
}

export interface TempDirectoryProvider {
    create(prefix: string): string;
    remove(directory: string): void;
}

export interface OperationRuntime {
    readonly operationId: string;
    readonly progress: ProgressSink;
    readonly logger: Logger;
    readonly signal: AbortSignal;
    readonly filesystem: OperationFilesystem;
    readonly clock: OperationClock;
    readonly tempDirectories: TempDirectoryProvider;
}

export interface OperationRuntimeOptions {
    progress: ProgressSink;
    logger: Logger;
    signal?: AbortSignal;
    timeoutMs?: number;
    filesystem?: OperationFilesystem;
    clock?: OperationClock;
    tempDirectories?: TempDirectoryProvider;
}

interface RuntimeState {
    controller: AbortController;
    startedAt: number;
    stageTimings: Record<string, number>;
    timer?: ReturnType<typeof setTimeout>;
    externalSignal?: AbortSignal;
    externalAbort?: () => void;
    disposeTempDirectories?: () => void;
}

const runtimeStates = new WeakMap<OperationRuntime, RuntimeState>();

function defaultTempDirectories(): { provider: TempDirectoryProvider; dispose: () => void } {
    const owned = new Set<string>();
    const tempRoot = path.resolve(os.tmpdir());
    const provider: TempDirectoryProvider = {
        create(prefix: string): string {
            const safePrefix = prefix.replace(/[^a-z0-9_-]/gi, '-').slice(0, 40) || 'operation';
            const directory = fs.mkdtempSync(path.join(tempRoot, `tsukuru-${safePrefix}-`));
            owned.add(path.resolve(directory));
            return directory;
        },
        remove(directory: string): void {
            const resolved = path.resolve(directory);
            if (!owned.delete(resolved)) {
                throw new OperationError(ErrorCodes.INTERNAL, 'runtime이 소유하지 않은 임시 디렉터리는 제거할 수 없습니다');
            }
            fs.rmSync(resolved, { recursive: true, force: true });
        },
    };
    return {
        provider,
        dispose: () => {
            for (const directory of owned) fs.rmSync(directory, { recursive: true, force: true });
            owned.clear();
        },
    };
}

export function createOperationRuntime(options: OperationRuntimeOptions): OperationRuntime {
    const controller = new AbortController();
    const ownedTemp = options.tempDirectories ? undefined : defaultTempDirectories();
    const runtime: OperationRuntime = {
        operationId: crypto.randomUUID(),
        progress: options.progress,
        logger: options.logger,
        signal: controller.signal,
        filesystem: options.filesystem ?? {
            existsSync: fs.existsSync,
            lstatSync: fs.lstatSync,
            readFileSync: fs.readFileSync,
            writeFileSync: fs.writeFileSync,
        },
        clock: options.clock ?? { now: () => Date.now() },
        tempDirectories: options.tempDirectories ?? ownedTemp!.provider,
    };
    const state: RuntimeState = {
        controller,
        startedAt: runtime.clock.now(),
        stageTimings: {},
        disposeTempDirectories: ownedTemp?.dispose,
    };
    if (options.signal) {
        const externalAbort = () => controller.abort({ kind: 'cancelled', cause: options.signal?.reason });
        state.externalSignal = options.signal;
        state.externalAbort = externalAbort;
        if (options.signal.aborted) externalAbort();
        else options.signal.addEventListener('abort', externalAbort, { once: true });
    }
    if (options.timeoutMs !== undefined) {
        if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) {
            throw new OperationError(ErrorCodes.REQUEST_INVALID, 'operation timeout은 1ms 이상의 정수여야 합니다');
        }
        state.timer = setTimeout(() => controller.abort({ kind: 'timeout', timeoutMs: options.timeoutMs }), options.timeoutMs);
        state.timer.unref?.();
    }
    runtimeStates.set(runtime, state);
    return runtime;
}

export function throwIfSignalAborted(signal: AbortSignal | undefined, stage?: string): void {
    if (!signal?.aborted) return;
    const reason = signal.reason as { kind?: string; timeoutMs?: number; cause?: unknown } | undefined;
    if (reason?.kind === 'timeout') {
        throw new OperationError(ErrorCodes.OPERATION_TIMEOUT, '작업 제한 시간을 초과했습니다', {
            stage,
            timeoutMs: reason.timeoutMs,
        });
    }
    throw new OperationError(ErrorCodes.OPERATION_CANCELLED, '작업이 취소되었습니다', { stage, cause: reason?.cause });
}

export function throwIfOperationAborted(runtime: OperationRuntime, stage?: string): void {
    throwIfSignalAborted(runtime.signal, stage);
}

export interface OperationTelemetry {
    operationId: string;
    elapsedMs: number;
    stageTimings: Record<string, number>;
}

function requireRuntimeState(runtime: OperationRuntime): RuntimeState {
    const state = runtimeStates.get(runtime);
    if (!state) {
        throw new OperationError(ErrorCodes.INTERNAL, '작업 런타임이 이미 종료되었거나 등록되지 않았습니다');
    }
    return state;
}

function reportStage(runtime: OperationRuntime, stage: string, completed: number): void {
    runtime.progress.report?.({
        stage,
        completed,
        total: 1,
        unit: 'stage',
        operationId: runtime.operationId,
    });
}

export async function runOperationStage<T>(
    runtime: OperationRuntime,
    stage: string,
    action: () => Promise<T> | T,
): Promise<T> {
    const state = requireRuntimeState(runtime);
    const startedAt = runtime.clock.now();
    runtime.progress.setTag?.(stage);
    reportStage(runtime, stage, 0);
    try {
        return await action();
    } finally {
        const elapsedMs = Math.max(0, runtime.clock.now() - startedAt);
        state.stageTimings[stage] = (state.stageTimings[stage] ?? 0) + elapsedMs;
        reportStage(runtime, stage, 1);
    }
}

export function getOperationTelemetry(runtime: OperationRuntime): OperationTelemetry {
    const state = requireRuntimeState(runtime);
    return {
        operationId: runtime.operationId,
        elapsedMs: Math.max(0, runtime.clock.now() - state.startedAt),
        stageTimings: { ...state.stageTimings },
    };
}

export function disposeOperationRuntime(runtime: OperationRuntime): void {
    const state = runtimeStates.get(runtime);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    if (state.externalSignal && state.externalAbort) {
        state.externalSignal.removeEventListener('abort', state.externalAbort);
    }
    state.disposeTempDirectories?.();
    runtimeStates.delete(runtime);
}
