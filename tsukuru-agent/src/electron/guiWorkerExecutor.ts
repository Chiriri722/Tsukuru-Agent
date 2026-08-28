import { Worker } from 'worker_threads';
import { terminateProcessTreeByPid } from '../core/processRegistry';
import { ErrorCodes, OperationError, ProgressEvent } from '../core/types';

interface WorkerErrorPayload {
    code?: string;
    message?: string;
    details?: unknown;
}

type WorkerMessage =
    | { type: 'progress'; percent: number }
    | { type: 'tag'; tag: string }
    | { type: 'progress-event'; event: ProgressEvent }
    | { type: 'log'; level: string; message: string }
    | { type: 'child-process'; state: 'spawn' | 'close'; pid: number }
    | { type: 'result'; result: unknown }
    | { type: 'error'; error: WorkerErrorPayload };

export interface GuiWorkerCallbacks {
    onProgress?(percent: number): void;
    onTag?(tag: string): void;
    onProgressEvent?(event: ProgressEvent): void;
    onLog?(level: string, message: string): void;
}

interface ActiveWorker {
    worker: Worker;
    cancelFlag: Int32Array;
    reject: (reason: unknown) => void;
    childPids: Set<number>;
    settled: Promise<void>;
    markSettled: () => void;
}

export class GuiWorkerExecutor {
    private active?: ActiveWorker;

    constructor(private readonly workerPath: string) {}

    run(request: unknown, callbacks: GuiWorkerCallbacks = {}): Promise<unknown> {
        if (this.active) {
            return Promise.reject(new OperationError(ErrorCodes.OUTPUT_CONFLICT, '이미 다른 GUI worker 작업이 실행 중입니다'));
        }
        const cancelBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
        const cancelFlag = new Int32Array(cancelBuffer);
        const worker = new Worker(this.workerPath, { workerData: { request, cancelBuffer } });
        return new Promise((resolve, reject) => {
            let markSettled!: () => void;
            const settled = new Promise<void>((done) => { markSettled = done; });
            this.active = { worker, cancelFlag, reject, childPids: new Set(), settled, markSettled };
            const settle = (action: () => void) => {
                if (this.active?.worker !== worker) return;
                this.active.markSettled();
                this.active = undefined;
                action();
            };
            worker.on('message', (message: WorkerMessage) => {
                if (message.type === 'progress') callbacks.onProgress?.(message.percent);
                else if (message.type === 'tag') callbacks.onTag?.(message.tag);
                else if (message.type === 'progress-event') callbacks.onProgressEvent?.(message.event);
                else if (message.type === 'log') callbacks.onLog?.(message.level, message.message);
                else if (message.type === 'child-process') {
                    if (message.state === 'spawn') this.active?.childPids.add(message.pid);
                    else this.active?.childPids.delete(message.pid);
                }
                else if (message.type === 'result') settle(() => resolve(message.result));
                else if (message.type === 'error') settle(() => reject(new OperationError(
                    message.error.code ?? ErrorCodes.INTERNAL,
                    message.error.message ?? 'GUI worker 작업에 실패했습니다',
                    message.error.details,
                )));
            });
            worker.once('error', (error) => settle(() => reject(new OperationError(
                ErrorCodes.INTERNAL,
                'GUI worker를 실행하지 못했습니다',
                { message: error.message },
            ))));
            worker.once('exit', (code) => settle(() => reject(new OperationError(
                code === 0 ? ErrorCodes.INTERNAL : ErrorCodes.OPERATION_CANCELLED,
                code === 0 ? 'GUI worker가 결과 없이 종료되었습니다' : 'GUI worker가 종료되었습니다',
                { exitCode: code },
            ))));
        });
    }

    cancel(): boolean {
        if (!this.active) return false;
        Atomics.store(this.active.cancelFlag, 0, 1);
        Atomics.notify(this.active.cancelFlag, 0);
        return true;
    }

    async terminate(): Promise<void> {
        const active = this.active;
        if (!active) return;
        this.cancel();
        const graceful = await Promise.race([
            active.settled.then(() => true),
            new Promise<false>((resolve) => {
                const timer = setTimeout(() => resolve(false), 5000);
                timer.unref?.();
            }),
        ]);
        if (graceful) return;
        for (const pid of active.childPids) terminateProcessTreeByPid(pid);
        if (this.active?.worker === active.worker) {
            this.active = undefined;
            active.markSettled();
            active.reject(new OperationError(ErrorCodes.OPERATION_CANCELLED, 'GUI worker가 강제 종료되었습니다'));
        }
        await active.worker.terminate();
    }

    activeCount(): number {
        return this.active ? 1 : 0;
    }
}
