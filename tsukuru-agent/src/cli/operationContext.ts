import { createOperationContext, createRpgState, createWolfState, OperationContext } from '../core/context';
import { StderrLogger, StderrProgressSink } from '../core/sinks';
import * as dataBaseO from '../js/rpgmv/datas.js';
import { createOperationRuntime, OperationRuntime } from '../core/operationRuntime';
import { ProtectedPath } from '../core/diagnostics';

export function buildCliOperationRuntime(options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
    protectedPaths?: ProtectedPath[];
}): OperationRuntime {
    return createOperationRuntime({
        progress: new StderrProgressSink(),
        logger: new StderrLogger(false, options?.protectedPaths),
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
    });
}

export function buildOperationContext(runtime?: OperationRuntime): OperationContext {
    const selected = runtime ?? buildCliOperationRuntime();
    return createOperationContext(selected.progress, selected.logger, {
        rpg: createRpgState({ ...dataBaseO.settings }),
        wolf: createWolfState(),
    }, selected);
}
