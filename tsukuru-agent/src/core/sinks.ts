/**
 * ProgressSink/Logger의 환경별 구현.
 * - CLI: 로그·진행률은 stderr(stdout은 최종 결과 JSON 전용).
 * - 테스트: 메모리 캡처 구현.
 * GUI(Electron IPC) 구현은 Phase 8 adapter에서 추가한다.
 */
import { ProgressEvent, ProgressSink, Logger } from './types';
import { ProtectedPath, redactSensitivePaths } from './diagnostics';

/** 진행률 무시 구현(verify 등 비대화 작업용). */
export class NullProgressSink implements ProgressSink {
    set(_percent: number): void { /* no-op */ }
    done(): void { /* no-op */ }
}

/** CLI 표준 로거: 모든 로그를 stderr로 본낸다. */
export class StderrLogger implements Logger {
    constructor(
        private readonly verbose: boolean = false,
        private readonly protectedPaths: ProtectedPath[] = [],
    ) {}
    private write(level: string, message: string): void {
        process.stderr.write(`[${level}] ${redactSensitivePaths(message, this.protectedPaths)}\n`);
    }
    info(message: string): void {
        this.write('info', message);
    }
    warn(message: string): void {
        this.write('warn', message);
    }
    error(message: string): void {
        this.write('error', message);
    }
    debug(message: string): void {
        if (this.verbose) {
            this.write('debug', message);
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
    report(event: ProgressEvent): void {
        process.stderr.write(`[progress-event] ${JSON.stringify(event)}\n`);
    }
}

/** 테스트용 캡처 싱크. */
export class CapturingProgressSink implements ProgressSink {
    readonly events: number[] = [];
    readonly structuredEvents: ProgressEvent[] = [];
    readonly tags: string[] = [];
    doneCalled = false;
    set(percent: number): void {
        this.events.push(percent);
    }
    done(): void {
        this.doneCalled = true;
    }
    setTag(tag: string): void {
        this.tags.push(tag);
    }
    report(event: ProgressEvent): void {
        this.structuredEvents.push(event);
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
