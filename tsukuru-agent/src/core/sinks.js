"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CapturingLogger = exports.CapturingProgressSink = exports.StderrProgressSink = exports.StderrLogger = exports.NullProgressSink = void 0;
/** 진행률 무시 구현(verify 등 비대화 작업용). */
class NullProgressSink {
    set(_percent) { }
    done() { }
}
exports.NullProgressSink = NullProgressSink;
/** CLI 표준 로거: 모든 로그를 stderr로 본낸다. */
class StderrLogger {
    constructor(verbose = false) {
        this.verbose = verbose;
    }
    info(message) {
        process.stderr.write(`[info] ${message}\n`);
    }
    warn(message) {
        process.stderr.write(`[warn] ${message}\n`);
    }
    error(message) {
        process.stderr.write(`[error] ${message}\n`);
    }
    debug(message) {
        if (this.verbose) {
            process.stderr.write(`[debug] ${message}\n`);
        }
    }
}
exports.StderrLogger = StderrLogger;
/** CLI 표준 진행률 싱크: stderr로만 보고한다. */
class StderrProgressSink {
    constructor() {
        this.lastReported = -1;
    }
    set(percent) {
        const rounded = Math.max(0, Math.min(100, Math.round(percent)));
        if (rounded !== this.lastReported) {
            this.lastReported = rounded;
            process.stderr.write(`[progress] ${rounded}%\n`);
        }
    }
    done() {
        process.stderr.write('[progress] done\n');
    }
    setTag(tag) {
        process.stderr.write(`[progress] ${tag}\n`);
    }
}
exports.StderrProgressSink = StderrProgressSink;
/** 테스트용 캡처 싱크. */
class CapturingProgressSink {
    constructor() {
        this.events = [];
        this.doneCalled = false;
    }
    set(percent) {
        this.events.push(percent);
    }
    done() {
        this.doneCalled = true;
    }
}
exports.CapturingProgressSink = CapturingProgressSink;
/** 테스트용 캡처 로거. */
class CapturingLogger {
    constructor() {
        this.messages = [];
    }
    info(message) {
        this.messages.push({ level: 'info', message });
    }
    warn(message) {
        this.messages.push({ level: 'warn', message });
    }
    error(message) {
        this.messages.push({ level: 'error', message });
    }
    debug(message) {
        this.messages.push({ level: 'debug', message });
    }
}
exports.CapturingLogger = CapturingLogger;
