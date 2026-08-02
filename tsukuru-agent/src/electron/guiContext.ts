/**
 * GUI(Electron)용 OperationContext 빌더.
 * 서비스 계층이 Electron 없이 설계되었으므로, GUI는 이 adapter를 통해
 * ProgressSink/Logger를 기존 IPC 채널('loading', 'loadingTag')에 연결한다.
 */
import { createOperationContext, createRpgState, createWolfState, OperationContext } from '../core/context';
import { ProgressSink, Logger } from '../core/types';

class GuiProgressSink implements ProgressSink {
    set(percent: number): void {
        globalThis.mwindow?.webContents.send('loading', percent);
    }
    done(): void {
        // 완료 알림('alert2')은 각 IPC adapter가 기존 흐름(silent 플래그 등)에 맞춰 별도 전송한다.
    }
    setTag(tag: string): void {
        globalThis.mwindow?.webContents.send('loadingTag', tag);
    }
}

class GuiLogger implements Logger {
    info(message: string): void {
        console.log(message);
    }
    warn(message: string): void {
        console.warn(message);
    }
    error(message: string): void {
        console.error(message);
    }
    debug(message: string): void {
        console.log(message);
    }
}

/** 기존 globalThis.settings를 공유하는 GUI 작업 Context를 생성한다. */
export function buildGuiContext(): OperationContext {
    return createOperationContext(new GuiProgressSink(), new GuiLogger(), {
        rpg: createRpgState(globalThis.settings),
        wolf: createWolfState(),
    });
}
