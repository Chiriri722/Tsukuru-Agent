import path from 'path';
import type { GuiOperationRequest } from './guiOperationWorker';
import { GuiWorkerExecutor } from './guiWorkerExecutor';

const executor = new GuiWorkerExecutor(path.join(__dirname, 'guiOperationWorker.js'));

export function runGuiOperation(request: GuiOperationRequest): Promise<unknown> {
    return executor.run(request, {
        onProgress: (percent) => globalThis.mwindow?.webContents.send('loading', percent),
        onTag: (tag) => globalThis.mwindow?.webContents.send('loadingTag', tag),
        onProgressEvent: (event) => {
            const percent = event.total > 0 ? event.completed / event.total * 100 : 0;
            globalThis.mwindow?.webContents.send('loading', percent);
            globalThis.mwindow?.webContents.send('loadingTag', event.stage);
        },
        onLog: (level, message) => {
            if (level === 'error') console.error(message);
            else if (level === 'warn') console.warn(message);
            else console.log(message);
        },
    });
}

export function cancelGuiOperation(): boolean {
    return executor.cancel();
}

export function terminateGuiOperation(): Promise<void> {
    return executor.terminate();
}

export function activeGuiWorkerCount(): number {
    return executor.activeCount();
}
