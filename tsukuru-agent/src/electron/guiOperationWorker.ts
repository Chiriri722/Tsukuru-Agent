import os from 'os';
import { parentPort, workerData } from 'worker_threads';
import { createOperationContext, createRpgState, createWolfState } from '../core/context';
import { redactSensitivePaths } from '../core/diagnostics';
import { createOperationRuntime, disposeOperationRuntime } from '../core/operationRuntime';
import {
    setTrackedProcessObserver,
    terminateTrackedProcesses,
    terminateTrackedProcessesAndWait,
} from '../core/processRegistry';
import { Logger, ProgressEvent, ProgressSink, toOperationError } from '../core/types';
import { RpgMakerService } from '../js/rpgmv/RpgMakerService';
import { WolfService } from '../js/wolf/WolfService';
import { replaceAllStringsAtomic } from './atomicTextReplace';
import { portVersionTranslationsAtomic } from './versionPort';

export type GuiOperationKind =
    | 'rpg-extract'
    | 'rpg-apply'
    | 'wolf-extract'
    | 'wolf-apply'
    | 'change-all-strings'
    | 'version-port';

export interface GuiOperationRequest {
    operation: GuiOperationKind;
    payload: any;
    settings: { [key: string]: unknown };
    oPath: string;
}

interface GuiWorkerData {
    request: GuiOperationRequest;
    cancelBuffer: SharedArrayBuffer;
}

const data = workerData as GuiWorkerData;
const port = parentPort!;
const cancelFlag = new Int32Array(data.cancelBuffer);
setTrackedProcessObserver((event) => port.postMessage({ type: 'child-process', ...event }));
const cancellationWatcher = setInterval(() => {
    if (Atomics.load(cancelFlag, 0) === 1) terminateTrackedProcesses();
}, 25);
cancellationWatcher.unref();
const sensitivePaths = [
    { path: data.request.payload.dir ?? data.request.payload.folder, label: 'project' },
    { path: data.request.oPath, label: 'runtime' },
    { path: os.tmpdir(), label: 'temp' },
].filter((entry) => typeof entry.path === 'string' && entry.path.length > 0);

const progress: ProgressSink = {
    set: (percent) => port.postMessage({ type: 'progress', percent }),
    done: () => port.postMessage({ type: 'progress', percent: 100 }),
    setTag: (tag) => port.postMessage({ type: 'tag', tag }),
    report: (event: ProgressEvent) => port.postMessage({ type: 'progress-event', event }),
};

const logger: Logger = {
    info: (message) => log('info', message),
    warn: (message) => log('warn', message),
    error: (message) => log('error', message),
    debug: (message) => log('debug', message),
};

function log(level: string, message: string): void {
    port.postMessage({ type: 'log', level, message: redactSensitivePaths(message, sensitivePaths) });
}

function sharedCancellationSignal(): AbortSignal {
    return {
        get aborted() { return Atomics.load(cancelFlag, 0) === 1; },
        get reason() { return { kind: 'cancelled' }; },
        onabort: null,
        throwIfAborted() {
            if (Atomics.load(cancelFlag, 0) === 1) throw new Error('operation cancelled');
        },
        addEventListener() { /* shared memory is polled at operation checkpoints */ },
        removeEventListener() { /* no-op */ },
        dispatchEvent() { return true; },
    } as AbortSignal;
}

async function execute(): Promise<unknown> {
    globalThis.settings = data.request.settings as any;
    globalThis.oPath = data.request.oPath;
    const runtime = createOperationRuntime({ progress, logger });
    Object.defineProperty(runtime, 'signal', { value: sharedCancellationSignal() });
    const context = createOperationContext(progress, logger, {
        rpg: createRpgState(data.request.settings),
        wolf: createWolfState(),
    }, runtime);
    try {
        const operation = data.request.operation;
        if (operation === 'rpg-extract') return new RpgMakerService(context).extract(data.request.payload);
        if (operation === 'rpg-apply') return new RpgMakerService(context).apply(data.request.payload);
        if (operation === 'wolf-extract') return new WolfService(context).extract(data.request.payload);
        if (operation === 'wolf-apply') return new WolfService(context).apply(data.request.payload);
        if (operation === 'change-all-strings') {
            const { dataRoot, search, replacement } = data.request.payload;
            return replaceAllStringsAtomic(dataRoot, search, replacement, {
                signal: runtime.signal,
                onProgress: (percent) => progress.set(percent),
            });
        }
        if (operation === 'version-port') {
            return portVersionTranslationsAtomic({
                ...data.request.payload,
                signal: runtime.signal,
                onProgress: (percent) => progress.set(percent),
            });
        }
        throw new Error(`unsupported GUI worker operation: ${String(operation)}`);
    } finally {
        clearInterval(cancellationWatcher);
        await terminateTrackedProcessesAndWait();
        setTrackedProcessObserver(undefined);
        disposeOperationRuntime(runtime);
    }
}

void execute().then(
    (result) => port.postMessage({ type: 'result', result }),
    (error) => {
        const operationError = toOperationError(error);
        port.postMessage({ type: 'error', error: operationError.toJSON() });
    },
);
