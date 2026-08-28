import crypto from 'crypto';
import { ErrorCodes, OperationError } from '../core/types';

export interface GuiOperationToken {
    readonly id: string;
    readonly signal: AbortSignal;
}

interface ActiveGuiOperation extends GuiOperationToken {
    controller: AbortController;
    cancelHook?: () => void;
}

/** GUI의 legacy worked 플래그와 같은 단일 작업 경계를 AbortSignal로 명시한다. */
export class GuiOperationCancellation {
    private active?: ActiveGuiOperation;

    begin(cancelHook?: () => void): GuiOperationToken {
        if (this.active) {
            throw new OperationError(ErrorCodes.OUTPUT_CONFLICT, '이미 다른 GUI 작업이 실행 중입니다');
        }
        const controller = new AbortController();
        this.active = { id: crypto.randomUUID(), signal: controller.signal, controller, cancelHook };
        return { id: this.active.id, signal: this.active.signal };
    }

    cancel(): boolean {
        if (!this.active) return false;
        this.active.controller.abort();
        this.active.cancelHook?.();
        return true;
    }

    finish(operationId: string): void {
        if (this.active?.id === operationId) this.active = undefined;
    }
}

export const guiOperationCancellation = new GuiOperationCancellation();
