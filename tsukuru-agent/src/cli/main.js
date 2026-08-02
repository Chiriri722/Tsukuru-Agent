#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Node.js용 CLI 진입점. 로직은 run.ts의 runAgent에 있다.
 * (Electron headless exe는 electronMain.ts를 통해 동일 실행기를 호출한다)
 */
const run_1 = require("./run");
(0, run_1.runAgent)(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
});
