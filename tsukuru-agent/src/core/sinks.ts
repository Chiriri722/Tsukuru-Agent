/**
 * ProgressSink/Logger의 환경별 구현.
 * - CLI: 로그·진행률은 stderr(stdout은 최종 결과 JSON 전용).
 * - 테스트: 메모리 캡처 구현.
 * GUI(Electron IPC) 구현은 Phase 8 adapter에서 추가한다.
 */
import { ProgressSink, Logger } from './types';

/** 진행률 무시 구현(verify 등 비대화 작업용). */
export class NullProgressSink implements ProgressSink {
    set(_percent: number): void { /* no-op */ }
    done(): void { /* no-op */ }
}

/** CLI 표준 로거: 모든 로그를 stderr로 본낸다. */
export class StderrLogger implements Logger {
    constructor(private readonly verbose: boolean = false) {}
    info(message: string): void {
        process.stderr.write(`[info] ${message}\n`);
    }
    warn(message: string): void {
        process.stderr.write(`[warn] ${message}\n`);
    }
    error(message: string): void {
        process.stderr.write(`[error] ${message}\n`);
    }
    debug(message: string): void {
        if (this.verbose) {
            process.stderr.write(`[debug] ${message}\n`);
        }
    }
}

/** CLI 표준 진행률 싱크: stderr로만 보고한다. */
export class StderrProgressSink implements ProgressSink {
    private lastReported = -1;
    set(percent: number): void {
        const rounded = Math.max(0, Math.min(100, Math.round(percent)));
        if (rounded !== this.lastReported) {
            this.lastReported = rounded;
            process.stderr.write(`[progress] ${rounded}%\n`);
        }
    }
    done(): void {
        process.stderr.write('[progress] done\n');
    }
    setTag(tag: string): void {
        process.stderr.write(`[progress] ${tag}\n`);
    }
}

/** 테스트용 캡처 싱크. */
export class CapturingProgressSink implements ProgressSink {
    readonly events: number[] = [];
    doneCalled = false;
    set(percent: number): void {
        this.events.push(percent);
    }
    done(): void {
        this.doneCalled = true;
    }
}

/** 테스트용 캡처 로거. */
export class CapturingLogger implements Logger {
    readonly messages: { level: string; message: string }[] = [];
    info(message: string): void {
        this.messages.push({ level: 'info', message });
    }
    warn(message: string): void {
        this.messages.push({ level: 'warn', message });
    }
    error(message: string): void {
        this.messages.push({ level: 'error', message });
    }
    debug(message: string): void {
        this.messages.push({ level: 'debug', message });
    }
}
