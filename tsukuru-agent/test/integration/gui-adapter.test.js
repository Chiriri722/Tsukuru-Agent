/**
 * GUI legacy adapter 회귀 테스트(Phase 8).
 * Electron 없이 mock mwindow로 apply.ts 어댑터의 기존 IPC 흐름
 * (alert/alert2/loading/worked)이 보존되는지 검증한다.
 * 참고: wolf/main.ts·main.ts의 adapter는 electron ipcMain 의존이라 Node에서 로드 불가 —
 * 컴파일 타임 검증과 구조적 동일성(동일 서비스 호출)으로 커버한다.
 * Phase 2에서 tracked node:test 회귀로 전환했다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const test = require('node:test');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-gui-adapter-'));

// mock mwindow: 전송된 IPC를 기록한다(require 전에 설정)
const sent = [];
globalThis.mwindow = {
    webContents: {
        send: (channel, payload) => sent.push({ channel, payload }),
    },
};
globalThis.settings = require('../../.build/app/src/js/rpgmv/datas.js').settings;

const { apply } = require('../../.build/app/src/js/rpgmv/apply.js');

async function main() {
    const SRC = path.join(__dirname, '..', '..', '..', 'fixtures', 'rpgmv-basic');
    fs.rmSync(WORK, { recursive: true, force: true });
    fs.mkdirSync(WORK, { recursive: true });
    fs.cpSync(SRC, WORK, { recursive: true });
    const dir = path.join(WORK, 'www', 'data');
    const dirB64 = () => Buffer.from(dir, 'utf8').toString('base64');

    // 1) Extract 없음 → 기존과 동일: alert(평문 안남문) + worked(0), alert2 없음
    await apply(null, { dir: dirB64() });
    const alertMsg = sent.find((m) => m.channel === 'alert');
    assert(alertMsg, 'alert가 전송되어야 한다');
    assert.strictEqual(alertMsg.payload.icon, 'error');
    assert.strictEqual(alertMsg.payload.message, 'Extract 폼더가 존재하지 않습니다', '기존 안남문과 동일해야 한다');
    assert(sent.some((m) => m.channel === 'worked' && m.payload === 0), 'worked 0이 전송되어야 한다');
    assert(!sent.some((m) => m.channel === 'alert2'), '실패 시 alert2는 오면 안 된다');
    console.log('[adapter] missing-Extract alert ok (legacy message preserved)');

    // 2) 정상 extract → apply → alert2 + loading(0) + worked(0) + Completed 생성
    const { RpgMakerService } = require('../../.build/app/src/js/rpgmv/RpgMakerService.js');
    const ctxmod = require('../../.build/app/src/core/context.js');
    const sinks = require('../../.build/app/src/core/sinks.js');
    const context = ctxmod.createOperationContext(new sinks.CapturingProgressSink(), new sinks.CapturingLogger(), {
        rpg: ctxmod.createRpgState({ ...globalThis.settings }),
    });
    await new RpgMakerService(context).extract({ dir });

    sent.length = 0;
    await apply(null, { dir: dirB64() });
    assert(sent.some((m) => m.channel === 'alert2'), 'alert2가 전송되어야 한다(기존 완료 알림)');
    assert(sent.some((m) => m.channel === 'loading' && m.payload === 0), 'loading 0이 전송되어야 한다');
    assert(sent.some((m) => m.channel === 'worked' && m.payload === 0), 'worked 0이 전송되어야 한다');
    assert(sent.some((m) => m.channel === 'loading' && typeof m.payload === 'number' && m.payload > 0), '진행률 loading이 GUI IPC로 전달되어야 한다');
    assert(fs.existsSync(path.join(dir, 'Completed', 'data', 'Actors.json')), 'Completed/data/Actors.json이 생성되어야 한다');
    console.log('[adapter] apply success flow ok (alert2/loading/worked preserved)');
    console.log('SMOKE OK');
}

test('GUI adapter preserves legacy apply IPC behavior', async () => {
    try {
        await main();
    } finally {
        fs.rmSync(WORK, { recursive: true, force: true });
    }
});
