"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGuiContext = buildGuiContext;
/**
 * GUI(Electron)용 OperationContext 빌더.
 * 서비스 계층이 Electron 없이 설계되었으므로, GUI는 이 adapter를 통해
 * ProgressSink/Logger를 기존 IPC 채널('loading', 'loadingTag')에 연결한다.
 */
const context_1 = require("../core/context");
class GuiProgressSink {
    set(percent) {
        var _a;
        (_a = globalThis.mwindow) === null || _a === void 0 ? void 0 : _a.webContents.send('loading', percent);
    }
    done() {
        // 완료 알림('alert2')은 각 IPC adapter가 기존 흐름(silent 플래그 등)에 맞춰 별도 전송한다.
    }
    setTag(tag) {
        var _a;
        (_a = globalThis.mwindow) === null || _a === void 0 ? void 0 : _a.webContents.send('loadingTag', tag);
    }
}
class GuiLogger {
    info(message) {
        console.log(message);
    }
    warn(message) {
        console.warn(message);
    }
    error(message) {
        console.error(message);
    }
    debug(message) {
        console.log(message);
    }
}
/** 기존 globalThis.settings를 공유하는 GUI 작업 Context를 생성한다. */
function buildGuiContext() {
    return (0, context_1.createOperationContext)(new GuiProgressSink(), new GuiLogger(), {
        rpg: (0, context_1.createRpgState)(globalThis.settings),
        wolf: (0, context_1.createWolfState)(),
    });
}
