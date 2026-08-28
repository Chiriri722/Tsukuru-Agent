import { AgentRequest, AgentResult, Operation } from '../core/schema';
import { ErrorCodes, OperationError } from '../core/types';
import { DetectedProject } from './formatDetect';
import { OperationRuntime, throwIfOperationAborted } from '../core/operationRuntime';

export type OperationHandler = (
    request: AgentRequest,
    detected: DetectedProject,
    result: AgentResult,
    runtime: OperationRuntime,
) => Promise<void> | void;

export type OperationHandlers = Readonly<Record<Operation, OperationHandler>>;

export async function dispatchOperation(
    request: AgentRequest,
    detected: DetectedProject,
    result: AgentResult,
    handlers: OperationHandlers,
    runtime: OperationRuntime,
): Promise<void> {
    const handler = handlers[request.operation];
    if (typeof handler !== 'function') {
        throw new OperationError(
            ErrorCodes.REQUEST_INVALID,
            `등록되지 않은 작업입니다: ${String(request.operation)}`,
        );
    }
    throwIfOperationAborted(runtime, 'before-dispatch');
    await handler(request, detected, result, runtime);
    throwIfOperationAborted(runtime, 'after-dispatch');
}
