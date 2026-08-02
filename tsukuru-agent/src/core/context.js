"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRpgState = createRpgState;
exports.createWolfState = createWolfState;
exports.createOperationContext = createOperationContext;
exports.setActiveContext = setActiveContext;
exports.hasActiveContext = hasActiveContext;
exports.ctx = ctx;
function createRpgState(settings) {
    return {
        settings: settings !== null && settings !== void 0 ? settings : {},
        gb: {},
        externMsg: {},
        useExternMsg: false,
        externMsgKeys: [],
    };
}
function createWolfState(sourceDir = '') {
    return {
        sourceDir,
        metadata: { ver: -1 },
        extData: [],
        cache: {},
    };
}
function createOperationContext(progress, logger, init) {
    var _a, _b;
    return {
        progress,
        logger,
        rpg: (_a = init === null || init === void 0 ? void 0 : init.rpg) !== null && _a !== void 0 ? _a : createRpgState(),
        wolf: (_b = init === null || init === void 0 ? void 0 : init.wolf) !== null && _b !== void 0 ? _b : createWolfState(),
    };
}
let activeContext = null;
/** 작업 시작 전에 호출. null이면 해제. */
function setActiveContext(context) {
    activeContext = context;
}
function hasActiveContext() {
    return activeContext !== null;
}
/** 현재 작업 Context. 미설정 상태에서 로직이 실행되면 즉시 실패시킨다. */
function ctx() {
    if (activeContext === null) {
        throw new Error('Operation context is not set. GUI adapter 또는 CLI가 작업 시작 전에 setActiveContext()를 호출해야 합니다.');
    }
    return activeContext;
}
