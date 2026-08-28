/**
 * WolfService 스모크 테스트: 합성 .mps 바이너리로 extract→수정→apply 검증.
 * Phase 2에서 tracked node:test 회귀로 전환했다.
 *
 * .mps 형식은 src/js/wolf/parser/io.ts의 reader 순서를 따른다(WOLFMAP v3).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const test = require('node:test');
const zlib = require('node:zlib');
const { encode } = require('@msgpack/msgpack');
const { WolfService } = require('../../.build/app/src/js/wolf/WolfService.js');
const ctxmod = require('../../.build/app/src/core/context.js');
const sinks = require('../../.build/app/src/core/sinks.js');

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-wolf-smoke-'));
const GAME = path.join(WORK, 'Game');
const DATA = path.join(GAME, 'data');
const MPS = path.join(DATA, 'Map001.mps');

function u4(n) { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; }
function u1(n) { return Buffer.from([n]); }
function lenStr(buf) { return Buffer.concat([u4(buf.length), buf]); }

/** 메시지 커맨드(101) 1개와 문자열 1개를 가진 최소 WOLFMAP v3 바이너리를 만든다. */
function buildMps(message) {
    const parts = [];
    parts.push(Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 87, 79, 76, 70, 77, 0, 85, 0, 0, 0])); // magic v3
    parts.push(u4(0));                    // len (파서가 검증하지 않음)
    parts.push(u1(102));                  // check (v3 = 102)
    parts.push(lenStr(Buffer.alloc(0)));  // unk lenStr
    parts.push(u4(1));                    // tilesetId
    parts.push(u4(1));                    // width
    parts.push(u4(1));                    // height
    parts.push(u4(1));                    // eventSize
    parts.push(u4(0)); parts.push(u4(0)); parts.push(u4(0)); // map data (1*1*3)
    // event
    parts.push(u1(111));                  // event check1
    parts.push(u4(12345));                // event check2
    parts.push(u4(1));                    // eventId
    parts.push(lenStr(Buffer.from('EV001', 'utf8'))); // name
    parts.push(u4(0)); parts.push(u4(0)); // x, y
    parts.push(u4(1));                    // pageLen
    parts.push(u4(0));                    // unkLen
    // page
    parts.push(u1(121));                  // page check
    parts.push(u4(0));                    // graphic.unk
    parts.push(lenStr(Buffer.alloc(0)));  // graphic.name
    parts.push(u1(0)); parts.push(u1(0)); parts.push(u1(255)); parts.push(u1(0)); // direction/frame/opacity/renderMode
    parts.push(u1(0));                    // cond.type
    parts.push(Buffer.alloc(4));          // cond flags 4×u1
    parts.push(Buffer.alloc(16));         // cond lets 4×u4
    parts.push(Buffer.alloc(16));         // cond values 4×u4
    parts.push(u1(0)); parts.push(u1(0)); parts.push(u1(0)); parts.push(u1(0)); // moveRoute head
    parts.push(u1(0)); parts.push(u1(0)); // route options 2×u1
    parts.push(u4(0));                    // routeLen
    parts.push(u4(1));                    // cmdLen
    // cmd: type 101 메시지
    parts.push(u1(1));                    // numArgLen
    parts.push(u4(101));                  // numArg[0] = 101
    parts.push(u1(0));                    // indent
    parts.push(u1(1));                    // strArgLen
    parts.push(lenStr(Buffer.concat([Buffer.from(message, 'utf8'), Buffer.from([0])]))); // 널 종료 문자열
    parts.push(u1(0));                    // hasMoveRoute
    parts.push(u4(0));                    // page unkLen
    parts.push(u1(122));                  // page check2
    parts.push(u1(112));                  // event check3
    parts.push(u1(102));                  // map check3
    return Buffer.concat(parts);
}

async function main() {
    fs.rmSync(WORK, { recursive: true, force: true });
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(MPS, buildMps('こんにちは'));
    const originalSize = fs.statSync(MPS).size;

    const progress = new sinks.CapturingProgressSink();
    const logger = new sinks.CapturingLogger();
    const context = ctxmod.createOperationContext(progress, logger);
    const svc = new WolfService(context);

    // 1) extract: _Extract/Texts/map.txt + .extracteddata 생성 확인
    const rep1 = await svc.extract({ folder: DATA, config: {} });
    assert.strictEqual(rep1.extractedEntries, 1, '추출 항목은 1개여야 한다');
    const mapTxt = path.join(DATA, '_Extract', 'Texts', 'map.txt');
    assert(fs.existsSync(mapTxt), 'map.txt가 생성되어야 한다');
    assert(fs.existsSync(path.join(DATA, '_Extract', '.extracteddata')), '.extracteddata가 생성되어야 한다');
    const txt = fs.readFileSync(mapTxt, 'utf8');
    assert(txt.includes('こんにちは'), 'map.txt에 원문이 있어야 한다');
    console.log('extract ok:', rep1.extractedEntries, 'entries ->', mapTxt);

    // 1.5) manifest 확인(Phase 5)
    const manifestPath = path.join(DATA, '_Extract', 'manifest.json');
    assert(fs.existsSync(manifestPath), '_Extract/manifest.json이 생성되어야 한다');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(manifest.format, 'wolf');
    assert.strictEqual(manifest.entries.length, 1);
    const we = manifest.entries[0];
    const { sha256Text } = require('../../.build/app/src/core/manifest.js');
    assert.strictEqual(we.hash, sha256Text('こんにちは'), '원문 해시가 일치해야 한다');
    assert.strictEqual(we.nullTerminated, true, '널 종료 여부가 기록되어야 한다');
    assert.strictEqual(we.encoding, 'utf8');
    assert(we.wolf && we.wolf.len === 16, 'wolf 오프셋 메타가 있어야 한다');
    assert.strictEqual(we.id, 'Map001.mps#0');
    console.log('manifest ok:', we.id, 'hash', we.hash.substring(0, 12) + '...');

    // 2) 번역 시뮬레이션: 16바이트(5자+널) → 7바이트(2자+널)로 줄여 오프셋 조정도 검증한다
    fs.writeFileSync(mapTxt, txt.replace('こんにちは', '안녕'), 'utf8');

    // 3) apply: 바이너리에 번역 반영 + 길이 필드·파일 크기 조정 확인
    const rep2 = await svc.apply({ folder: DATA, config: {} });
    assert.strictEqual(rep2.appliedEntries, 1, '적용 항목은 1개여야 한다');
    const applied = fs.readFileSync(MPS);
    assert(applied.includes(Buffer.from('안녕', 'utf8')), '바이너리에 번역이 포함되어야 한다');
    assert(!applied.includes(Buffer.from('こんにちは', 'utf8')), '원문은 사라져야 한다');
    assert.strictEqual(applied.length, originalSize - 9, 'UTF-8 16바이트→7바이트로 9바이트 감소해야 한다');
    const textIdx = applied.indexOf(Buffer.from('안녕', 'utf8'));
    assert.strictEqual(applied.readInt32LE(textIdx - 4), 7, 'lenStr 길이 필드가 7로 갱신되어야 한다');
    assert.strictEqual(applied[textIdx + 6], 0, '널 종료가 유지되어야 한다');
    console.log('apply ok:', rep2.appliedEntries, 'entries, size', originalSize, '->', applied.length);
    console.log('SMOKE OK');
}

test('Wolf service binary extract and apply smoke', async () => {
    try {
        await main();
    } finally {
        fs.rmSync(WORK, { recursive: true, force: true });
    }
});

test('Wolf service keeps structured CLI stdout free of direct console diagnostics', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-wolf-stdout-'));
    const data = path.join(root, 'data');
    const directOutput = [];
    const originalLog = console.log;
    try {
        fs.mkdirSync(data);
        fs.writeFileSync(path.join(data, 'Map001.mps'), buildMps('quiet'));
        const context = ctxmod.createOperationContext(new sinks.CapturingProgressSink(), new sinks.CapturingLogger());
        const service = new WolfService(context);
        console.log = (...args) => directOutput.push(args);
        await service.extract({ folder: data, config: {} });
        await service.apply({ folder: data, config: {} });
    } finally {
        console.log = originalLog;
        fs.rmSync(root, { recursive: true, force: true });
    }
    assert.deepEqual(directOutput, []);
});

test('Wolf extract requires force for an existing workspace', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-wolf-existing-extract-'));
    const data = path.join(root, 'data');
    fs.mkdirSync(data);
    fs.writeFileSync(path.join(data, 'Map001.mps'), buildMps('old'));
    const context = ctxmod.createOperationContext(new sinks.CapturingProgressSink(), new sinks.CapturingLogger());
    const service = new WolfService(context);
    await service.extract({ folder: data, config: {} });
    const sentinel = path.join(data, '_Extract', 'keep.txt');
    fs.writeFileSync(sentinel, 'old workspace');

    await assert.rejects(
        service.extract({ folder: data, config: {} }),
        (error) => error?.code === 'E_EXTRACT_EXISTS',
    );
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'old workspace');
    fs.rmSync(root, { recursive: true, force: true });
});

test('Wolf force extract restores the previous workspace when commit fails', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-wolf-extract-rollback-'));
    const data = path.join(root, 'data');
    fs.mkdirSync(data);
    fs.writeFileSync(path.join(data, 'Map001.mps'), buildMps('old'));
    const context = ctxmod.createOperationContext(new sinks.CapturingProgressSink(), new sinks.CapturingLogger());
    const service = new WolfService(context);
    const first = await service.extract({ folder: data, config: {} });
    const sentinel = path.join(first.extractDir, 'keep.txt');
    fs.writeFileSync(sentinel, 'old workspace');
    const oldManifest = fs.readFileSync(first.manifestPath);
    fs.writeFileSync(path.join(data, 'Map001.mps'), buildMps('new'));
    const originalRename = fs.renameSync;
    fs.renameSync = (source, destination) => {
        if (path.resolve(destination) === path.resolve(first.extractDir)
            && path.basename(source).includes('.tsukuru-stage-')) {
            throw new Error('simulated Wolf extract commit failure');
        }
        return originalRename(source, destination);
    };
    try {
        await assert.rejects(
            service.extract({ folder: data, config: { force: true } }),
            /simulated Wolf extract commit failure/,
        );
    } finally {
        fs.renameSync = originalRename;
    }
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'old workspace');
    assert.deepEqual(fs.readFileSync(first.manifestPath), oldManifest);
    assert.deepEqual(
        fs.readdirSync(data).filter((name) => /\.tsukuru-(stage|backup)-/.test(name)),
        [],
    );
    fs.rmSync(root, { recursive: true, force: true });
});

function wolfApplyFixture({ sourceFile, extractFile = 'map', linkedExtract = false } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-wolf-apply-safety-'));
    const data = path.join(root, 'data');
    const target = path.join(root, 'target');
    const outsideExtract = path.join(root, 'outside-extract');
    const source = sourceFile ?? path.join(data, 'Map001.mps');
    const originalText = Buffer.from('hello', 'utf8');
    const binary = Buffer.concat([u4(originalText.length), originalText]);
    fs.mkdirSync(data, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, sourceFile ? 'outside sentinel' : binary);
    if (!sourceFile) fs.writeFileSync(path.join(target, 'Map001.mps'), binary);
    const extractRoot = linkedExtract ? outsideExtract : path.join(data, '_Extract');
    fs.mkdirSync(path.join(extractRoot, 'Texts'), { recursive: true });
    fs.writeFileSync(path.join(extractRoot, 'Texts', 'map.txt'), 'translated');
    const payload = {
        ext: [{
            str: { pos1: 0, pos2: 4, pos3: 9, str: originalText, len: originalText.length },
            sourceFile: source,
            extractFile,
            endsWithNull: false,
            textLineNumber: [0],
            codeStr: 'message',
        }],
        cache: { [source]: binary },
        meta: { ver: 3 },
    };
    fs.writeFileSync(path.join(extractRoot, '.extracteddata'), zlib.deflateSync(Buffer.from(encode(payload))));
    if (linkedExtract) {
        fs.symlinkSync(outsideExtract, path.join(data, '_Extract'), process.platform === 'win32' ? 'junction' : 'dir');
    }
    const context = ctxmod.createOperationContext(new sinks.CapturingProgressSink(), new sinks.CapturingLogger());
    return { root, data, target, source, service: new WolfService(context) };
}

test('Wolf direct apply restores every binary when a later file install fails', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-wolf-apply-batch-'));
    const data = path.join(root, 'data');
    const extractRoot = path.join(data, '_Extract');
    fs.mkdirSync(path.join(extractRoot, 'Texts'), { recursive: true });
    const sources = [path.join(data, 'Map001.mps'), path.join(data, 'Map002.mps')];
    const originals = sources.map((source, index) => {
        const text = Buffer.from(`hello-${index + 1}`, 'utf8');
        const binary = Buffer.concat([u4(text.length), text]);
        fs.writeFileSync(source, binary);
        fs.writeFileSync(path.join(extractRoot, 'Texts', `map${index + 1}.txt`), `translated-${index + 1}`);
        return { source, text, binary, extractFile: `map${index + 1}` };
    });
    const payload = {
        ext: originals.map((entry) => ({
            str: { pos1: 0, pos2: 4, pos3: entry.binary.length, str: entry.text, len: entry.text.length },
            sourceFile: entry.source,
            extractFile: entry.extractFile,
            endsWithNull: false,
            textLineNumber: [0],
            codeStr: 'message',
        })),
        cache: Object.fromEntries(originals.map((entry) => [entry.source, entry.binary])),
        meta: { ver: 3 },
    };
    fs.writeFileSync(path.join(extractRoot, '.extracteddata'), zlib.deflateSync(Buffer.from(encode(payload))));
    const context = ctxmod.createOperationContext(new sinks.CapturingProgressSink(), new sinks.CapturingLogger());
    const service = new WolfService(context);
    const originalRename = fs.renameSync;
    fs.renameSync = (source, destination) => {
        if (path.resolve(destination) === path.resolve(sources[1]) && path.basename(source).includes('.tmp-')) {
            throw new Error('simulated second Wolf binary install failure');
        }
        return originalRename(source, destination);
    };
    try {
        await assert.rejects(
            service.apply({ folder: data, config: {} }),
            /simulated second Wolf binary install failure/,
        );
    } finally {
        fs.renameSync = originalRename;
    }
    for (let index = 0; index < sources.length; index++) {
        assert.deepEqual(fs.readFileSync(sources[index]), originals[index].binary);
    }
    fs.rmSync(root, { recursive: true, force: true });
});

test('Wolf copy apply rejects an extracteddata source path outside the data root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-wolf-outside-source-'));
    const outside = path.join(root, 'outside.bin');
    const fixture = wolfApplyFixture({ sourceFile: outside });
    try {
        await assert.rejects(
            fixture.service.applyToCopy({ dataDir: fixture.data, targetDir: fixture.target }),
            (error) => error?.code === 'E_MAPPING_CORRUPT',
        );
        assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'outside sentinel');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('Wolf copy apply rejects an _Extract workspace reached through a junction', async (t) => {
    let fixture;
    try {
        fixture = wolfApplyFixture({ linkedExtract: true });
    } catch (error) {
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }
    const targetFile = path.join(fixture.target, 'Map001.mps');
    const before = fs.readFileSync(targetFile);
    try {
        await assert.rejects(
            fixture.service.applyToCopy({ dataDir: fixture.data, targetDir: fixture.target }),
            (error) => error?.code === 'E_MAPPING_CORRUPT' && /link|junction|심볼릭|정션/i.test(error.message),
        );
        assert.ok(fs.readFileSync(targetFile).equals(before));
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('Wolf copy apply rejects an extracted text traversal in extracteddata', async () => {
    const fixture = wolfApplyFixture({ extractFile: '../../outside-text' });
    const targetFile = path.join(fixture.target, 'Map001.mps');
    const before = fs.readFileSync(targetFile);
    fs.writeFileSync(path.join(fixture.data, 'outside-text.txt'), 'translated');
    try {
        await assert.rejects(
            fixture.service.applyToCopy({ dataDir: fixture.data, targetDir: fixture.target }),
            (error) => error?.code === 'E_MAPPING_CORRUPT',
        );
        assert.ok(fs.readFileSync(targetFile).equals(before));
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('Wolf extract rejects map files reached through a junction', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-wolf-extract-link-'));
    const data = path.join(root, 'game', 'data');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(data, { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'Map001.mps'), buildMps('outside'));
    try {
        fs.symlinkSync(outside, path.join(data, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }
    const context = ctxmod.createOperationContext(new sinks.CapturingProgressSink(), new sinks.CapturingLogger());
    const service = new WolfService(context);
    try {
        await assert.rejects(
            service.extract({ folder: data, config: {} }),
            (error) => error?.code === 'E_MAPPING_CORRUPT' && /link|junction|심볼릭|정션/i.test(error.message),
        );
        assert.strictEqual(fs.existsSync(path.join(data, '_Extract')), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
