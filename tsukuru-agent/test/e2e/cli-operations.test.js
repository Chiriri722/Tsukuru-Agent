/**
 * tsukuru-agent CLI 스모크 테스트(Phase 6).
 * CLI를 자식 프로세스로 실행해 stdout JSON 계약·exit code·작업별 동작을 검증한다.
 * Phase 2에서 tracked node:test 회귀로 전환했다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const test = require('node:test');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(ROOT, '.build', 'app', 'src', 'cli', 'main.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-cli-smoke-'));

/** CLI 실행. stdout은 반드시 순수 JSON이어야 한다(계약). */
function run(args, input) {
    const res = { code: 0, stdout: '', stderr: '' };
    try {
        res.stdout = execFileSync(process.execPath, [CLI, ...args], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
        res.code = e.status ?? 1;
        res.stdout = e.stdout ?? '';
        res.stderr = e.stderr ?? '';
    }
    res.json = JSON.parse(res.stdout);
    return res;
}

function request(over) {
    return JSON.stringify({ schemaVersion: 1, operation: 'verify', format: 'auto', projectPath: '', profile: 'standard', options: {}, patches: [], ...over });
}

function u4(n) { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; }
function u1(n) { return Buffer.from([n]); }
function lenStr(buf) { return Buffer.concat([u4(buf.length), buf]); }

/** 최소 WOLFMAP v3 바이너리(smoke-wolf.js와 동일한 형식). */
function buildMps(message) {
    const parts = [];
    parts.push(Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 87, 79, 76, 70, 77, 0, 85, 0, 0, 0]));
    parts.push(u4(0)); parts.push(u1(102)); parts.push(lenStr(Buffer.alloc(0)));
    parts.push(u4(1)); parts.push(u4(1)); parts.push(u4(1)); parts.push(u4(1));
    parts.push(u4(0)); parts.push(u4(0)); parts.push(u4(0));
    parts.push(u1(111)); parts.push(u4(12345)); parts.push(u4(1));
    parts.push(lenStr(Buffer.from('EV001', 'utf8')));
    parts.push(u4(0)); parts.push(u4(0)); parts.push(u4(1)); parts.push(u4(0));
    parts.push(u1(121)); parts.push(u4(0)); parts.push(lenStr(Buffer.alloc(0)));
    parts.push(u1(0)); parts.push(u1(0)); parts.push(u1(255)); parts.push(u1(0));
    parts.push(u1(0)); parts.push(Buffer.alloc(4)); parts.push(Buffer.alloc(16)); parts.push(Buffer.alloc(16));
    parts.push(u1(0)); parts.push(u1(0)); parts.push(u1(0)); parts.push(u1(0));
    parts.push(u1(0)); parts.push(u1(0)); parts.push(u4(0));
    parts.push(u4(1));
    parts.push(u1(1)); parts.push(u4(101)); parts.push(u1(0)); parts.push(u1(1));
    parts.push(lenStr(Buffer.concat([Buffer.from(message, 'utf8'), Buffer.from([0])])));
    parts.push(u1(0)); parts.push(u4(0)); parts.push(u1(122)); parts.push(u1(112)); parts.push(u1(102));
    return Buffer.concat(parts);
}

async function main() {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });

    // ===== RPG MV: extract → verify → apply =====
    const rpgGame = path.join(TMP, 'rpg');
    fs.cpSync(path.join(ROOT, '..', 'fixtures', 'rpgmv-basic'), rpgGame, { recursive: true });
    const rpgData = path.join(rpgGame, 'www', 'data');

    let r = run(['run', '--request', '-'], request({ operation: 'extract', projectPath: rpgGame }));
    assert.strictEqual(r.code, 0, `extract 실패: ${r.stdout}`);
    assert.strictEqual(r.json.ok, true);
    assert.strictEqual(r.json.format, 'rpgmv', '게임 루트에서 www/data 자동 판별');
    assert(r.json.stats.entries > 0, 'manifest 항목이 있어야 한다');
    console.log('[rpg] extract ok, entries =', r.json.stats.entries);
    const extractEntries = r.json.stats.entries;

    // 기존 산출물 + force 없음 → E_EXTRACT_EXISTS
    r = run(['run', '--request', '-'], request({ operation: 'extract', projectPath: rpgGame }));
    assert.strictEqual(r.code, 1);
    assert.strictEqual(r.json.error.code, 'E_EXTRACT_EXISTS');
    console.log('[rpg] extract conflict ok');

    // patch: 해시 불일치 시 묵변경(E_PATCH_HASH_MISMATCH)
    const manifestPath = path.join(rpgData, 'Extract', 'manifest.json');
    const readManifest = () => JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const m0 = readManifest();
    const nameE = m0.entries.find((e) => e.id === 'Actors.json#1.name');
    const profileE = m0.entries.find((e) => e.id === 'Actors.json#1.profile');
    const mariaE = m0.entries.find((e) => e.id === 'Actors.json#2.name');
    const actorsTxt = path.join(rpgData, 'Extract', 'Actors.txt');

    r = run(['run', '--request', '-'], request({ operation: 'patch', projectPath: rpgGame, patches: [{ id: 'Actors.json#1.name', expectedHash: '0'.repeat(64), text: '알렉산더' }] }));
    assert.strictEqual(r.code, 1);
    assert.strictEqual(r.json.error.code, 'E_PATCH_HASH_MISMATCH');
    assert(fs.readFileSync(actorsTxt, 'utf8').includes('알렉스'), '해시 불일치 시 작업본은 변경되지 않아야 한다');
    console.log('[rpg] patch hash-mismatch ok');

    // patch: 1줄→1줄 + 1줄→2줄 치환(줄 수 변경 시 manifest/.extracteddata 매핑 재생성 검증)
    r = run(['run', '--request', '-'], request({ operation: 'patch', projectPath: rpgGame, patches: [
        { id: 'Actors.json#1.name', expectedHash: nameE.hash, text: '알렉산더' },
        { id: 'Actors.json#1.profile', expectedHash: profileE.hash, text: '첫째 줄\n둘째 줄' },
    ] }));
    assert.strictEqual(r.code, 0, `patch 실패: ${r.stdout}`);
    assert.strictEqual(r.json.stats.patched, 2);
    const m1 = readManifest();
    const nameE1 = m1.entries.find((e) => e.id === 'Actors.json#1.name');
    const profileE1 = m1.entries.find((e) => e.id === 'Actors.json#1.profile');
    const mariaE1 = m1.entries.find((e) => e.id === 'Actors.json#2.name');
    assert.strictEqual(nameE1.lineEnd - nameE1.lineStart, 1);
    assert.strictEqual(profileE1.lineEnd - profileE1.lineStart, 2, '1줄→2줄 치환이 manifest에 반영되어야 한다');
    assert.strictEqual(mariaE1.lineStart, mariaE.lineStart + 1, '후속 항목 줄 번호가 이동해야 한다');
    const { sha256Text } = require('../../.build/app/src/core/manifest.js');
    assert.strictEqual(nameE1.hash, sha256Text('알렉산더'), 'patch 후 해시가 재생성되어야 한다');
    console.log('[rpg] patch ok, mapping regenerated');

    // verify 통과
    r = run(['run', '--request', '-'], request({ operation: 'verify', projectPath: rpgGame }));
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.json.ok, true);
    assert.strictEqual(r.json.stats.entries, extractEntries);
    console.log('[rpg] verify ok');

    // --request 파일 경로 형식
    const reqFile = path.join(TMP, 'req.json');
    fs.writeFileSync(reqFile, request({ operation: 'verify', projectPath: rpgGame }), 'utf8');
    r = run(['run', '--request', reqFile]);
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.json.ok, true);
    console.log('[rpg] --request file ok');

    // apply: patch 결과가 Completed에 반영
    r = run(['run', '--request', '-'], request({ operation: 'apply', projectPath: rpgGame }));
    assert.strictEqual(r.code, 0, `apply 실패: ${r.stdout}`);
    const appliedActors = JSON.parse(fs.readFileSync(path.join(rpgData, 'Completed', 'data', 'Actors.json'), 'utf8'));
    assert.strictEqual(appliedActors[1].name, '알렉산더');
    assert.strictEqual(appliedActors[1].profile, '첫째 줄\n둘째 줄', '여러 줄 치환이 적용되어야 한다');
    assert.strictEqual(appliedActors[2].name, '마리아', '매핑 이동 후에도 다른 항목이 정확해야 한다');
    console.log('[rpg] patch→verify→apply ok');

    // 오류 계약: 미추출 verify / 포맷 불일치 / 경로 없음 / patch 오류 / 잘못된 명령
    const rpgFresh = path.join(TMP, 'rpg-fresh');
    fs.cpSync(path.join(ROOT, '..', 'fixtures', 'rpgmv-basic'), rpgFresh, { recursive: true });
    r = run(['run', '--request', '-'], request({ operation: 'verify', projectPath: rpgFresh }));
    assert.strictEqual(r.code, 1);
    assert.strictEqual(r.json.error.code, 'E_VERIFY_FAILED');
    r = run(['run', '--request', '-'], request({ operation: 'verify', projectPath: rpgGame, format: 'wolf' }));
    assert.strictEqual(r.json.error.code, 'E_FORMAT_MISMATCH');
    r = run(['run', '--request', '-'], request({ operation: 'verify', projectPath: path.join(TMP, 'no-such-dir') }));
    assert.strictEqual(r.json.error.code, 'E_PATH_NOT_FOUND');
    r = run(['run', '--request', '-'], request({ operation: 'patch', projectPath: rpgGame, patches: [{ id: 'x', expectedHash: '0'.repeat(64), text: 'y' }, { id: 'x', expectedHash: '0'.repeat(64), text: 'z' }] }));
    assert.strictEqual(r.json.error.code, 'E_PATCH_DUPLICATE_ID');
    r = run(['run', '--request', '-'], request({ operation: 'patch', projectPath: rpgGame, patches: [{ id: 'Actors.json#99.name', expectedHash: '0'.repeat(64), text: 'y' }] }));
    assert.strictEqual(r.json.error.code, 'E_PATCH_NOT_FOUND');
    r = run(['badcmd', '--request', '-'], '{}');
    assert.strictEqual(r.json.error.code, 'E_REQUEST_INVALID');
    console.log('[rpg] error contract ok');

    // ===== Wolf: extract → 복사본 apply(원본 무손상 계약) =====
    const wolfData = path.join(TMP, 'wolf', 'Game', 'data');
    fs.mkdirSync(wolfData, { recursive: true });
    const mpsPath = path.join(wolfData, 'Map001.mps');
    fs.writeFileSync(mpsPath, buildMps('こんにちは'));

    r = run(['run', '--request', '-'], request({ operation: 'extract', projectPath: path.join(TMP, 'wolf', 'Game') }));
    assert.strictEqual(r.code, 0, `wolf extract 실패: ${r.stdout}`);
    assert.strictEqual(r.json.format, 'wolf');
    console.log('[wolf] extract ok, entries =', r.json.stats.entries);

    // wolf patch: 정상 치환 후 복사본 apply
    const wolfManifest = JSON.parse(fs.readFileSync(path.join(wolfData, '_Extract', 'manifest.json'), 'utf8'));
    const we = wolfManifest.entries[0];
    r = run(['run', '--request', '-'], request({ operation: 'patch', projectPath: path.join(TMP, 'wolf', 'Game'), patches: [{ id: we.id, expectedHash: we.hash, text: '안녕' }] }));
    assert.strictEqual(r.code, 0, `wolf patch 실패: ${r.stdout}`);
    r = run(['run', '--request', '-'], request({ operation: 'apply', projectPath: path.join(TMP, 'wolf', 'Game') }));
    assert.strictEqual(r.code, 0, `wolf apply 실패: ${r.stdout}`);
    const targetMps = path.join(TMP, 'wolf', 'Game', 'Completed', 'Map001.mps');
    assert(fs.existsSync(targetMps), '게임 복사본에 적용되어야 한다');
    assert(fs.readFileSync(targetMps).includes(Buffer.from('안녕', 'utf8')), '복사본에 번역이 있어야 한다');
    assert(fs.readFileSync(mpsPath).includes(Buffer.from('こんにちは', 'utf8')), '원본 바이너리는 무손상이어야 한다(계획서 §CLI 계약)');
    assert(!fs.existsSync(path.join(TMP, 'wolf', 'Game', 'Completed', '_Extract')), '복사본에 _Extract는 제외되어야 한다');
    console.log('[wolf] apply-to-copy ok, original untouched');

    console.log('SMOKE OK');
}

test('CLI operations preserve stdout, exit-code, and round-trip contracts', async () => {
    try {
        await main();
    } finally {
        fs.rmSync(TMP, { recursive: true, force: true });
    }
});

test('Wolf CLI copy apply rejects an unrelated source junction before publication', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-wolf-cli-link-'));
    const game = path.join(root, 'Game');
    const data = path.join(game, 'data');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(data, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(data, 'Map001.mps'), buildMps('こんにちは'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    let response = run(['run', '--request', '-'], request({ operation: 'extract', projectPath: game }));
    assert.strictEqual(response.code, 0, response.stdout);
    try {
        fs.symlinkSync(outside, path.join(data, 'linked-resource'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        fs.rmSync(root, { recursive: true, force: true });
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }

    try {
        response = run(['run', '--request', '-'], request({ operation: 'apply', projectPath: game }));
        assert.strictEqual(response.code, 1, response.stdout);
        assert.strictEqual(response.json.error.code, 'E_VERIFY_FAILED', JSON.stringify(response.json));
        assert.strictEqual(response.json.error.details?.stack, undefined);
        assert.doesNotMatch(JSON.stringify(response.json.error), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
        assert.strictEqual(fs.existsSync(path.join(game, 'Completed')), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Wolf CLI copy apply supports parent paths whose names contain _Extract', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-wolf-parent-'));
    const game = path.join(root, 'translation_Extract_archive', 'Game');
    const data = path.join(game, 'data');
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(path.join(data, 'Map001.mps'), buildMps('こんにちは'));
    fs.writeFileSync(path.join(data, 'resource.bin'), Buffer.from([1, 2, 3]));

    try {
        let response = run(['run', '--request', '-'], request({ operation: 'extract', projectPath: game }));
        assert.strictEqual(response.code, 0, response.stdout);
        response = run(['run', '--request', '-'], request({ operation: 'apply', projectPath: game }));
        assert.strictEqual(response.code, 0, response.stdout);
        assert.strictEqual(fs.existsSync(path.join(game, 'Completed', 'Map001.mps')), true);
        assert.deepStrictEqual(fs.readFileSync(path.join(game, 'Completed', 'resource.bin')), Buffer.from([1, 2, 3]));
        assert.strictEqual(fs.existsSync(path.join(game, 'Completed', '_Extract')), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
