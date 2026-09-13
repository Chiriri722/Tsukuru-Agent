/**
 * RpgMakerService 합성 fixture 스모크 테스트.
 * Phase 2에서 tracked node:test 회귀로 전환했다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const assert = require('assert');
const test = require('node:test');
const { RpgMakerService } = require('../../.build/app/src/js/rpgmv/RpgMakerService.js');
const { DecryptDir, EncryptDir } = require('../../.build/app/src/js/rpgmv/fileCrypto.js');
const rpgEncrypt = require('../../.build/app/src/js/libs/rpgencrypt.js');
const edTool = require('../../.build/app/src/js/rpgmv/edtool.js');
const { applyPatches } = require('../../.build/app/src/cli/patcher.js');
const { sha256Text } = require('../../.build/app/src/core/manifest.js');
const ctxmod = require('../../.build/app/src/core/context.js');
const { createOperationRuntime } = require('../../.build/app/src/core/operationRuntime.js');
const sinks = require('../../.build/app/src/core/sinks.js');
const datas = require('../../.build/app/src/js/rpgmv/datas.js');

const SRC = path.join(__dirname, '..', '..', '..', 'fixtures', 'rpgmv-basic');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-smoke-'));

async function main() {
    // fixture를 작업 디렉터리에 복사해 원본을 보존한다.
    fs.rmSync(WORK, { recursive: true, force: true });
    fs.mkdirSync(WORK, { recursive: true });
    fs.cpSync(SRC, WORK, { recursive: true });
    const dir = path.join(WORK, 'www', 'data');

    const progress = new sinks.CapturingProgressSink();
    const logger = new sinks.CapturingLogger();
    const context = ctxmod.createOperationContext(progress, logger, {
        rpg: ctxmod.createRpgState({ ...datas.settings }),
    });
    const svc = new RpgMakerService(context);

    // 1) extract: Extract/Backup/.extracteddata 생성 확인
    const rep1 = await svc.extract({ dir, ext_note: true });
    assert(fs.existsSync(path.join(dir, 'Extract')), 'Extract 폼더가 생성되어야 한다');
    assert(fs.existsSync(path.join(dir, 'Backup', 'Actors.json')), 'Backup/Actors.json이 있어야 한다');
    assert(fs.existsSync(path.join(dir, '.extracteddata')), '.extracteddata가 있어야 한다');
    assert(rep1.extractedFiles.length > 0, '추출 텍스트 산출물이 있어야 한다');
    console.log('extracted files:', rep1.extractedFiles.join(', '));

    // 1.5) manifest 확인(Phase 5)
    const manifestPath = path.join(dir, 'Extract', 'manifest.json');
    assert(fs.existsSync(manifestPath), 'Extract/manifest.json이 생성되어야 한다');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(manifest.format, 'rpgmv');
    assert.strictEqual(manifest.schemaVersion, 1);
    const nameEntry = manifest.entries.find((e) => e.id === 'Actors.json#1.name');
    assert(nameEntry, 'Actors.json#1.name 항목이 있어야 한다');
    assert.strictEqual(nameEntry.hash, sha256Text('알렉스'), '원문 해시가 일치해야 한다');
    assert.strictEqual(nameEntry.extractFile, 'Actors.txt');
    assert(nameEntry.lineEnd > nameEntry.lineStart, '줄 범위가 유효해야 한다');
    assert.strictEqual(rep1.manifestEntries, manifest.entries.length, 'report의 항목 수와 일치해야 한다');
    console.log('manifest entries:', manifest.entries.length);

    // 2) 번역 시뮬레이션: Actors.txt의 '알렉스' → '알렉산더'
    const actorsTxt = path.join(dir, 'Extract', 'Actors.txt');
    assert(fs.existsSync(actorsTxt), 'Actors.txt가 있어야 한다');
    let txt = fs.readFileSync(actorsTxt, 'utf8');
    assert(txt.includes('알렉스'), 'Actors.txt에 원문 이름이 있어야 한다');
    txt = txt.replace('알렉스', '알렉산더');
    fs.writeFileSync(actorsTxt, txt, 'utf8');

    // 3) apply: Completed/data 출력 및 번역 반영 확인
    const rep2 = await svc.apply({ dir });
    const completedActors = path.join(dir, 'Completed', 'data', 'Actors.json');
    assert(fs.existsSync(completedActors), 'Completed/data/Actors.json이 있어야 한다');
    const applied = JSON.parse(fs.readFileSync(completedActors, 'utf8'));
    assert.strictEqual(applied[1].name, '알렉산더', '번역이 적용되어야 한다');
    assert.strictEqual(applied[1].nickname, '용사', '수정하지 않은 항목은 유지되어야 한다');
    assert.strictEqual(applied[2].name, '마리아', '다른 배우 데이터는 유지되어야 한다');
    console.log('applied files:', rep2.appliedFiles.length);
    console.log('progress events:', progress.events.length, 'done:', progress.doneCalled);
    console.log('SMOKE OK');
}

test('RPG Maker service extract and apply smoke', async () => {
    try {
        await main();
    } finally {
        fs.rmSync(WORK, { recursive: true, force: true });
    }
});

test('RPG service keeps structured CLI stdout free of direct console diagnostics', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-stdout-'));
    const directOutput = [];
    const originalLog = console.log;
    try {
        fs.cpSync(SRC, work, { recursive: true });
        const dir = path.join(work, 'www', 'data');
        const context = ctxmod.createOperationContext(
            new sinks.CapturingProgressSink(),
            new sinks.CapturingLogger(),
            { rpg: ctxmod.createRpgState({ ...datas.settings }) },
        );
        const svc = new RpgMakerService(context);
        console.log = (...args) => directOutput.push(args);
        await svc.extract({ dir, ext_note: true });
    } finally {
        console.log = originalLog;
        fs.rmSync(work, { recursive: true, force: true });
    }
    assert.deepEqual(directOutput, []);
});

test('RPG apply commits a custom output atomically and preserves conflicts', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-transaction-'));
    try {
        fs.cpSync(SRC, work, { recursive: true });
        const dir = path.join(work, 'www', 'data');
        const target = path.join(work, 'translated-game');
        fs.mkdirSync(target);
        fs.writeFileSync(path.join(target, 'sentinel.txt'), 'keep', 'utf8');
        const context = ctxmod.createOperationContext(
            new sinks.CapturingProgressSink(),
            new sinks.CapturingLogger(),
            { rpg: ctxmod.createRpgState({ ...datas.settings }) },
        );
        const svc = new RpgMakerService(context);
        await svc.extract({ dir, ext_note: true });

        await assert.rejects(
            svc.apply({ dir, outputDir: target, force: false }),
            /출력 경로가 이미 존재합니다/,
        );
        assert.strictEqual(fs.readFileSync(path.join(target, 'sentinel.txt'), 'utf8'), 'keep');
        assert.strictEqual(fs.existsSync(path.join(dir, 'Completed')), false);

        await svc.apply({ dir, outputDir: target, force: true });
        assert.strictEqual(fs.existsSync(path.join(target, 'sentinel.txt')), false);
        assert.strictEqual(fs.existsSync(path.join(target, 'data', 'Actors.json')), true);
        assert.strictEqual(fs.existsSync(path.join(dir, 'Completed')), false);
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('RPG copy apply preserves source bytes for semantically unchanged JSON and plugins', async (t) => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-byte-preservation-'));
    try {
        fs.cpSync(SRC, work, { recursive: true });
        const dir = path.join(work, 'www', 'data');
        const output = path.join(work, 'translated-game');
        const systemPath = path.join(dir, 'System.json');
        const system = JSON.parse(fs.readFileSync(systemPath, 'utf8'));
        const systemBytes = Buffer.from(`\uFEFF${JSON.stringify(system, null, 2).replace(/\n/g, '\r\n')}\r\n`, 'utf8');
        fs.writeFileSync(systemPath, systemBytes);

        const jsDir = path.join(work, 'www', 'js');
        fs.mkdirSync(jsDir);
        const pluginBytes = Buffer.from([
            '// Generated by RPG Maker.',
            '// Keep this formatting byte-for-byte when no plugin text changed.',
            'var $plugins =',
            '[',
            '  {"name":"Sample","status":true,"description":"설명","parameters":{"message":"안녕"}}',
            '];',
            '',
        ].join('\r\n'), 'utf8');
        fs.writeFileSync(path.join(jsDir, 'plugins.js'), pluginBytes);

        const context = ctxmod.createOperationContext(
            new sinks.CapturingProgressSink(),
            new sinks.CapturingLogger(),
            { rpg: ctxmod.createRpgState({ ...datas.settings }) },
        );
        const svc = new RpgMakerService(context);
        await svc.extract({ dir, ext_plugin: true, exJson: true, ext_note: true });
        const actorsTextPath = path.join(dir, 'Extract', 'Actors.txt');
        const actorsText = fs.readFileSync(actorsTextPath, 'utf8');
        assert(actorsText.includes('알렉스'));
        fs.writeFileSync(actorsTextPath, actorsText.replace('알렉스', '알렉산더'), 'utf8');

        await svc.apply({ dir, outputDir: output, force: false });

        await t.test('untouched JSON retains its BOM and formatting', () => {
            assert.deepStrictEqual(fs.readFileSync(path.join(output, 'data', 'System.json')), systemBytes);
        });
        await t.test('untouched plugins.js retains comments and formatting', () => {
            assert.deepStrictEqual(fs.readFileSync(path.join(output, 'js', 'plugins.js')), pluginBytes);
        });
        const actors = JSON.parse(fs.readFileSync(path.join(output, 'data', 'Actors.json'), 'utf8'));
        assert.strictEqual(actors[1].name, '알렉산더');
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('RPG apply rejects output paths that would replace the source data or Backup tree', async (t) => {
    for (const [label, outputFor] of [
        ['data root', (dir) => dir],
        ['Backup', (dir) => path.join(dir, 'Backup')],
        ['Extract child', (dir) => path.join(dir, 'Extract', 'nested')],
    ]) {
        await t.test(label, async () => {
            const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-output-overlap-'));
            try {
                fs.cpSync(SRC, work, { recursive: true });
                const dir = path.join(work, 'www', 'data');
                const context = ctxmod.createOperationContext(
                    new sinks.CapturingProgressSink(),
                    new sinks.CapturingLogger(),
                    { rpg: ctxmod.createRpgState({ ...datas.settings }) },
                );
                const svc = new RpgMakerService(context);
                await svc.extract({ dir, ext_note: true });
                const sourceActors = fs.readFileSync(path.join(dir, 'Actors.json'));
                const backupActors = fs.readFileSync(path.join(dir, 'Backup', 'Actors.json'));
                const outputDir = outputFor(dir);
                await assert.rejects(
                    svc.apply({ dir, outputDir, force: true }),
                    (error) => error?.code === 'E_OUTPUT_CONFLICT' && /출력|원본|Backup|Extract|겹/i.test(error.message),
                );
                assert.deepEqual(fs.readFileSync(path.join(dir, 'Actors.json')), sourceActors);
                assert.deepEqual(fs.readFileSync(path.join(dir, 'Backup', 'Actors.json')), backupActors);
            } finally {
                fs.rmSync(work, { recursive: true, force: true });
            }
        });
    }
});

test('RPG patch keeps text, manifest and .extracteddata apply-ready as one set', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-patch-set-'));
    try {
        fs.cpSync(SRC, work, { recursive: true });
        const dir = path.join(work, 'www', 'data');
        const context = ctxmod.createOperationContext(
            new sinks.CapturingProgressSink(),
            new sinks.CapturingLogger(),
            { rpg: ctxmod.createRpgState({ ...datas.settings }) },
        );
        const svc = new RpgMakerService(context);
        await svc.extract({ dir, ext_note: true });
        const extractDir = path.join(dir, 'Extract');
        const manifestPath = path.join(extractDir, 'manifest.json');
        const before = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const entry = before.entries.find((candidate) => candidate.id === 'Actors.json#1.name');
        const translated = '알렉\n산더';

        const outcome = applyPatches(extractDir, 'rpgmv', [{
            id: entry.id,
            expectedHash: entry.hash,
            text: translated,
        }]);
        assert.equal(outcome.patched, 1);
        assert.equal(outcome.files, 1);
        assert.equal(outcome.translationQuality.mechanical, 'pass');
        assert.equal(outcome.translationQuality.semantics, 'not-run');
        const after = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const patchedEntry = after.entries.find((candidate) => candidate.id === entry.id);
        assert.strictEqual(patchedEntry.lineEnd - patchedEntry.lineStart, 2);
        assert.strictEqual(patchedEntry.hash, sha256Text(translated));
        const mapping = edTool.read(dir);
        const [mappingLine, mappingEntry] = Object.entries(mapping.main['Actors.json'].data)
            .find(([, candidate]) => candidate.val === '1.name');
        assert.strictEqual(mappingEntry.m - Number(mappingLine), 2);

        await svc.apply({ dir });
        const actors = JSON.parse(fs.readFileSync(path.join(dir, 'Completed', 'data', 'Actors.json'), 'utf8'));
        assert.strictEqual(actors[1].name, translated);
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('RPG patch rolls back text, manifest and .extracteddata when batch commit fails', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-patch-rollback-'));
    const originalRename = fs.renameSync;
    try {
        fs.cpSync(SRC, work, { recursive: true });
        const dir = path.join(work, 'www', 'data');
        const context = ctxmod.createOperationContext(
            new sinks.CapturingProgressSink(),
            new sinks.CapturingLogger(),
            { rpg: ctxmod.createRpgState({ ...datas.settings }) },
        );
        const svc = new RpgMakerService(context);
        await svc.extract({ dir, ext_note: true });
        const extractDir = path.join(dir, 'Extract');
        const manifestPath = path.join(extractDir, 'manifest.json');
        const actorsPath = path.join(extractDir, 'Actors.txt');
        const mappingPath = path.join(dir, '.extracteddata');
        const originals = new Map([
            [manifestPath, fs.readFileSync(manifestPath)],
            [actorsPath, fs.readFileSync(actorsPath)],
            [mappingPath, fs.readFileSync(mappingPath)],
        ]);
        const manifest = JSON.parse(originals.get(manifestPath).toString('utf8'));
        const entry = manifest.entries.find((candidate) => candidate.id === 'Actors.json#1.name');
        fs.renameSync = (source, destination) => {
            if (path.resolve(destination) === path.resolve(manifestPath) && path.basename(source).includes('.tmp-')) {
                throw new Error('simulated RPG patch manifest install failure');
            }
            return originalRename(source, destination);
        };

        assert.throws(
            () => applyPatches(extractDir, 'rpgmv', [{
                id: entry.id,
                expectedHash: entry.hash,
                text: '롤백 대상\n번역',
            }]),
            /simulated RPG patch manifest install failure/,
        );
        fs.renameSync = originalRename;
        for (const [file, original] of originals) assert.deepEqual(fs.readFileSync(file), original);
        assert.deepEqual(
            fs.readdirSync(extractDir).filter((name) => /\.(tmp|old)-/.test(name)),
            [],
        );
        assert.deepEqual(
            fs.readdirSync(dir).filter((name) => /\.(tmp|old)-/.test(name)),
            [],
        );
    } finally {
        fs.renameSync = originalRename;
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('RPG patch rejects malformed .extracteddata before changing text or manifest', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-patch-corrupt-'));
    try {
        fs.cpSync(SRC, work, { recursive: true });
        const dir = path.join(work, 'www', 'data');
        const context = ctxmod.createOperationContext(
            new sinks.CapturingProgressSink(),
            new sinks.CapturingLogger(),
            { rpg: ctxmod.createRpgState({ ...datas.settings }) },
        );
        const svc = new RpgMakerService(context);
        await svc.extract({ dir, ext_note: true });
        const extractDir = path.join(dir, 'Extract');
        const manifestPath = path.join(extractDir, 'manifest.json');
        const actorsPath = path.join(extractDir, 'Actors.txt');
        const manifestBefore = fs.readFileSync(manifestPath);
        const actorsBefore = fs.readFileSync(actorsPath);
        const manifest = JSON.parse(manifestBefore.toString('utf8'));
        const entry = manifest.entries.find((candidate) => candidate.id === 'Actors.json#1.name');
        fs.writeFileSync(
            path.join(dir, '.extracteddata'),
            zlib.deflateSync(Buffer.from(JSON.stringify({ dat: {} }), 'utf8')),
        );

        assert.throws(
            () => applyPatches(extractDir, 'rpgmv', [{
                id: entry.id,
                expectedHash: entry.hash,
                text: '변경되면 안 됨',
            }]),
            (error) => error?.code === 'E_MAPPING_CORRUPT' && /wrapper|main|구조|매핑/i.test(error.message),
        );
        assert.deepEqual(fs.readFileSync(manifestPath), manifestBefore);
        assert.deepEqual(fs.readFileSync(actorsPath), actorsBefore);
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('RPG apply rejects a traversing .extracteddata bucket name', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-mapping-key-'));
    try {
        fs.cpSync(SRC, work, { recursive: true });
        const dir = path.join(work, 'www', 'data');
        const context = ctxmod.createOperationContext(
            new sinks.CapturingProgressSink(),
            new sinks.CapturingLogger(),
            { rpg: ctxmod.createRpgState({ ...datas.settings }) },
        );
        const svc = new RpgMakerService(context);
        await svc.extract({ dir, ext_note: true });

        const mapping = edTool.read(dir);
        mapping.main['../Actors.json'] = mapping.main['Actors.json'];
        delete mapping.main['Actors.json'];
        edTool.write(dir, mapping);

        await assert.rejects(
            svc.apply({ dir }),
            (error) => error?.code === 'E_MAPPING_CORRUPT' && /extracteddata|mapping|path|경로/i.test(error.message),
        );
        assert.strictEqual(fs.existsSync(path.join(dir, 'Completed')), false);
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('RPG apply rejects a traversing .extracteddata origin file', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-mapping-origin-'));
    try {
        fs.cpSync(SRC, work, { recursive: true });
        const dir = path.join(work, 'www', 'data');
        const context = ctxmod.createOperationContext(
            new sinks.CapturingProgressSink(),
            new sinks.CapturingLogger(),
            { rpg: ctxmod.createRpgState({ ...datas.settings }) },
        );
        const svc = new RpgMakerService(context);
        await svc.extract({ dir, ext_note: true });

        const mapping = edTool.read(dir);
        const firstLine = Object.keys(mapping.main['Actors.json'].data)[0];
        mapping.main['Actors.json'].data[firstLine].origin = '../../../../outside.json';
        edTool.write(dir, mapping);

        await assert.rejects(
            svc.apply({ dir }),
            (error) => error?.code === 'E_MAPPING_CORRUPT' && /extracteddata|mapping|path|경로/i.test(error.message),
        );
        assert.strictEqual(fs.existsSync(path.join(dir, 'Completed')), false);
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('RPG apply rejects .extracteddata data paths that diverge from the manifest', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-mapping-value-'));
    try {
        fs.cpSync(SRC, work, { recursive: true });
        const dir = path.join(work, 'www', 'data');
        const context = ctxmod.createOperationContext(
            new sinks.CapturingProgressSink(),
            new sinks.CapturingLogger(),
            { rpg: ctxmod.createRpgState({ ...datas.settings }) },
        );
        const svc = new RpgMakerService(context);
        await svc.extract({ dir, ext_note: true });

        const mapping = edTool.read(dir);
        const entry = Object.values(mapping.main['Actors.json'].data)
            .find((candidate) => candidate.conf?.isComment !== true);
        entry.val = '1.nicknameTampered';
        edTool.write(dir, mapping);

        await assert.rejects(
            svc.apply({ dir }),
            (error) => error?.code === 'E_MAPPING_CORRUPT' && /manifest|mapping|매핑/i.test(error.message),
        );
        assert.strictEqual(fs.existsSync(path.join(dir, 'Completed')), false);
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('RPG apply rejects prototype-bearing .extracteddata data paths', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-mapping-prototype-'));
    try {
        fs.cpSync(SRC, work, { recursive: true });
        const dir = path.join(work, 'www', 'data');
        const context = ctxmod.createOperationContext(
            new sinks.CapturingProgressSink(),
            new sinks.CapturingLogger(),
            { rpg: ctxmod.createRpgState({ ...datas.settings }) },
        );
        const svc = new RpgMakerService(context);
        await svc.extract({ dir, ext_note: true });

        const mapping = edTool.read(dir);
        const entry = Object.values(mapping.main['Actors.json'].data)
            .find((candidate) => candidate.conf?.isComment !== true);
        entry.val = '__proto__.tsukuruPolluted';
        edTool.write(dir, mapping);

        await assert.rejects(
            svc.apply({ dir }),
            (error) => error?.code === 'E_MAPPING_CORRUPT' && /prototype|data path|경로|매핑/i.test(error.message),
        );
        assert.strictEqual(Array.prototype.tsukuruPolluted, undefined);
        assert.strictEqual(fs.existsSync(path.join(dir, 'Completed')), false);
    } finally {
        delete Array.prototype.tsukuruPolluted;
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('RPG .extracteddata reader rejects an invalid wrapper chain deterministically', () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-mapping-wrapper-'));
    try {
        let payload = {};
        for (let index = 0; index < 20; index++) payload = { dat: payload };
        fs.writeFileSync(
            path.join(work, '.extracteddata'),
            zlib.deflateSync(Buffer.from(JSON.stringify(payload), 'utf8')),
        );
        assert.throws(
            () => edTool.read(work),
            (error) => error?.code === 'E_MAPPING_CORRUPT' && /wrapper|main|구조|매핑/i.test(error.message),
        );
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('RPG apply rejects linked Extract and Backup workspaces', async (t) => {
    for (const protectedDir of ['Extract', 'Backup']) {
        await t.test(protectedDir, async (subtest) => {
            const work = fs.mkdtempSync(path.join(os.tmpdir(), `tsukuru-rpg-${protectedDir.toLowerCase()}-link-`));
            try {
                fs.cpSync(SRC, work, { recursive: true });
                const dir = path.join(work, 'www', 'data');
                const context = ctxmod.createOperationContext(
                    new sinks.CapturingProgressSink(),
                    new sinks.CapturingLogger(),
                    { rpg: ctxmod.createRpgState({ ...datas.settings }) },
                );
                const svc = new RpgMakerService(context);
                await svc.extract({ dir, ext_note: true });

                const realDir = path.join(work, `${protectedDir}-outside`);
                fs.renameSync(path.join(dir, protectedDir), realDir);
                try {
                    fs.symlinkSync(realDir, path.join(dir, protectedDir), process.platform === 'win32' ? 'junction' : 'dir');
                } catch (error) {
                    subtest.skip(`symlink/junction creation unavailable: ${error.code}`);
                    return;
                }

                await assert.rejects(
                    svc.apply({ dir }),
                    (error) => error?.code === 'E_MAPPING_CORRUPT' && /link|junction|심볼릭|정션|경로/i.test(error.message),
                );
                assert.strictEqual(fs.existsSync(path.join(dir, 'Completed')), false);
            } finally {
                fs.rmSync(work, { recursive: true, force: true });
            }
        });
    }
});

test('RPG apply preserves legacy packs without manifest.json', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-legacy-mapping-'));
    try {
        fs.cpSync(SRC, work, { recursive: true });
        const dir = path.join(work, 'www', 'data');
        const context = ctxmod.createOperationContext(
            new sinks.CapturingProgressSink(),
            new sinks.CapturingLogger(),
            { rpg: ctxmod.createRpgState({ ...datas.settings }) },
        );
        const svc = new RpgMakerService(context);
        await svc.extract({ dir, ext_note: true });
        fs.rmSync(path.join(dir, 'Extract', 'manifest.json'));

        await svc.apply({ dir });
        assert.strictEqual(fs.existsSync(path.join(dir, 'Completed', 'data', 'Actors.json')), true);
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('RPG encrypted asset decryption resolves only after decrypted files are written', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-asset-await-'));
    const data = path.join(root, 'data');
    const imageRoot = path.join(root, 'img');
    const sourceImage = path.join(root, 'source.png');
    const encryptedImage = path.join(imageRoot, 'source.rpgmvp');
    const key = '0'.repeat(32);
    fs.mkdirSync(data);
    fs.mkdirSync(imageRoot);
    fs.writeFileSync(path.join(data, 'System.json'), JSON.stringify({ encryptionKey: key }));
    fs.writeFileSync(sourceImage, Buffer.from('synthetic png payload'));
    await rpgEncrypt.Encrypt(sourceImage, imageRoot, key, true);

    const originalReadFile = fs.promises.readFile;
    let existedWhenResolved = false;
    try {
        fs.promises.readFile = async function delayedEncryptedRead(file, ...args) {
            if (path.resolve(String(file)) === path.resolve(encryptedImage)) {
                await new Promise((resolve) => setTimeout(resolve, 40));
            }
            return originalReadFile.call(fs.promises, file, ...args);
        };
        const context = ctxmod.createOperationContext(new sinks.CapturingProgressSink(), new sinks.CapturingLogger());
        await ctxmod.withOperationContext(context, () => DecryptDir(data, 'img'));
        existedWhenResolved = fs.existsSync(path.join(data, 'Extract_img', 'source.png'));
        await new Promise((resolve) => setTimeout(resolve, 80));
    } finally {
        fs.promises.readFile = originalReadFile;
        fs.rmSync(root, { recursive: true, force: true });
    }
    assert.strictEqual(existedWhenResolved, true);
});

test('RPG encrypted asset decryption cancellation preserves the previous output tree', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-asset-cancel-'));
    const data = path.join(root, 'data');
    const imageRoot = path.join(root, 'img');
    const output = path.join(data, 'Extract_img');
    fs.mkdirSync(data);
    fs.mkdirSync(imageRoot);
    fs.mkdirSync(output);
    fs.writeFileSync(path.join(data, 'System.json'), JSON.stringify({ encryptionKey: '0'.repeat(32) }));
    fs.writeFileSync(path.join(imageRoot, 'one.txt'), 'ignored', 'utf8');
    fs.writeFileSync(path.join(imageRoot, 'two.txt'), 'ignored', 'utf8');
    fs.writeFileSync(path.join(output, 'sentinel.png'), 'keep', 'utf8');

    const controller = new AbortController();
    const progress = new sinks.CapturingProgressSink();
    const originalSet = progress.set.bind(progress);
    let progressCalls = 0;
    progress.set = (value) => {
        originalSet(value);
        progressCalls += 1;
        if (progressCalls === 2) controller.abort('cancel encrypted asset decryption');
    };
    const logger = new sinks.CapturingLogger();
    const runtime = createOperationRuntime({ progress, logger, signal: controller.signal });
    const context = ctxmod.createOperationContext(progress, logger, {}, runtime);
    try {
        await assert.rejects(
            ctxmod.withOperationContext(context, () => DecryptDir(data, 'img')),
            (error) => error?.code === 'E_OPERATION_CANCELLED',
        );
        assert.strictEqual(fs.readFileSync(path.join(output, 'sentinel.png'), 'utf8'), 'keep');
        assert.deepEqual(
            fs.readdirSync(data).filter((name) => name.includes('tsukuru')).sort(),
            [],
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('RPG encrypted asset decryption rejects an invalid header and preserves the previous output tree', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-asset-header-'));
    const data = path.join(root, 'data');
    const imageRoot = path.join(root, 'img');
    const output = path.join(data, 'Extract_img');
    fs.mkdirSync(data);
    fs.mkdirSync(imageRoot);
    fs.mkdirSync(output);
    fs.writeFileSync(path.join(data, 'System.json'), JSON.stringify({ encryptionKey: '0'.repeat(32) }));
    fs.writeFileSync(path.join(imageRoot, 'corrupt.rpgmvp'), Buffer.alloc(32, 0x41));
    fs.writeFileSync(path.join(output, 'sentinel.png'), 'keep', 'utf8');

    const context = ctxmod.createOperationContext(new sinks.CapturingProgressSink(), new sinks.CapturingLogger());
    try {
        await assert.rejects(
            ctxmod.withOperationContext(context, () => DecryptDir(data, 'img')),
            (error) => error?.code === 'E_MAPPING_CORRUPT' && /복호화|header|헤더/i.test(error.message),
        );
        assert.strictEqual(fs.readFileSync(path.join(output, 'sentinel.png'), 'utf8'), 'keep');
        assert.strictEqual(fs.existsSync(path.join(output, 'corrupt.png')), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('RPG encrypted asset encryption resolves only after encrypted files are written', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-asset-encrypt-await-'));
    const data = path.join(root, 'www', 'data');
    const sourceRoot = path.join(data, 'Extract_img');
    const sourceImage = path.join(sourceRoot, 'source.png');
    const completedRoot = path.join(data, 'Completed');
    const key = '0'.repeat(32);
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(completedRoot);
    fs.writeFileSync(path.join(data, 'System.json'), JSON.stringify({ encryptionKey: key }));
    fs.writeFileSync(sourceImage, Buffer.from('synthetic translated png payload'));

    const originalReadFile = fs.promises.readFile;
    let existedWhenResolved = false;
    try {
        fs.promises.readFile = async function delayedDecryptedRead(file, ...args) {
            if (path.resolve(String(file)) === path.resolve(sourceImage)) {
                await new Promise((resolve) => setTimeout(resolve, 40));
            }
            return originalReadFile.call(fs.promises, file, ...args);
        };
        const context = ctxmod.createOperationContext(new sinks.CapturingProgressSink(), new sinks.CapturingLogger());
        await ctxmod.withOperationContext(context, () => EncryptDir(data, 'img', false, completedRoot));
        existedWhenResolved = fs.existsSync(path.join(completedRoot, 'img', 'source.rpgmvp'));
        await new Promise((resolve) => setTimeout(resolve, 80));
    } finally {
        fs.promises.readFile = originalReadFile;
        fs.rmSync(root, { recursive: true, force: true });
    }
    assert.strictEqual(existedWhenResolved, true);
});

test('RPG encrypted asset encryption observes operation cancellation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-asset-encrypt-cancel-'));
    const data = path.join(root, 'www', 'data');
    const sourceRoot = path.join(data, 'Extract_img');
    const completedRoot = path.join(data, 'Completed');
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(completedRoot);
    fs.writeFileSync(path.join(data, 'System.json'), JSON.stringify({ encryptionKey: '0'.repeat(32) }));
    fs.writeFileSync(path.join(sourceRoot, 'one.txt'), 'ignored', 'utf8');
    fs.writeFileSync(path.join(sourceRoot, 'two.txt'), 'ignored', 'utf8');

    const controller = new AbortController();
    const progress = new sinks.CapturingProgressSink();
    const originalSet = progress.set.bind(progress);
    progress.set = (value) => {
        originalSet(value);
        controller.abort('cancel encrypted asset encryption');
    };
    const logger = new sinks.CapturingLogger();
    const runtime = createOperationRuntime({ progress, logger, signal: controller.signal });
    const context = ctxmod.createOperationContext(progress, logger, {}, runtime);
    try {
        await assert.rejects(
            ctxmod.withOperationContext(context, () => EncryptDir(data, 'img', false, completedRoot)),
            (error) => error?.code === 'E_OPERATION_CANCELLED',
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('RPG font operations install a font and update the MV font size through validated targets', () => {
    const { installRpgFont, changeRpgFontSize } = require('../../.build/app/src/js/rpgmv/fontService.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-font-'));
    const data = path.join(root, 'www', 'data');
    const fonts = path.join(root, 'www', 'fonts');
    const scripts = path.join(root, 'www', 'js');
    const sourceFont = path.join(root, 'translated.ttf');
    const targetFont = path.join(fonts, 'mplus-1m-regular.ttf');
    const windowScript = path.join(scripts, 'rpg_windows.js');
    const fontData = Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x00]), Buffer.from('synthetic font')]);
    fs.mkdirSync(data, { recursive: true });
    fs.mkdirSync(fonts);
    fs.mkdirSync(scripts);
    fs.writeFileSync(sourceFont, fontData);
    fs.writeFileSync(targetFont, 'old font', 'utf8');
    fs.writeFileSync(
        windowScript,
        'Window_Base.prototype.standardFontSize = function() {return 24}',
        'utf8',
    );

    try {
        assert.strictEqual(installRpgFont(data, sourceFont), targetFont);
        assert.deepEqual(fs.readFileSync(targetFont), fontData);
        assert.strictEqual(changeRpgFontSize(data, 36), windowScript);
        assert.match(fs.readFileSync(windowScript, 'utf8'), /return 36/);
        assert.doesNotMatch(fs.readFileSync(windowScript, 'utf8'), /return 24/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('RPG font installation rejects a linked target directory without modifying its destination', (t) => {
    const { installRpgFont } = require('../../.build/app/src/js/rpgmv/fontService.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-font-link-'));
    const data = path.join(root, 'www', 'data');
    const fonts = path.join(root, 'www', 'fonts');
    const outside = path.join(root, 'outside-fonts');
    const sourceFont = path.join(root, 'translated.ttf');
    fs.mkdirSync(data, { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'mplus-1m-regular.ttf'), 'keep', 'utf8');
    fs.writeFileSync(
        sourceFont,
        Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x00]), Buffer.from('synthetic font')]),
    );
    try {
        try {
            fs.symlinkSync(outside, fonts, process.platform === 'win32' ? 'junction' : 'dir');
        } catch (error) {
            t.skip(`symlink/junction creation unavailable: ${error.code}`);
            return;
        }
        assert.throws(() => installRpgFont(data, sourceFont), /link|junction|symbolic|심볼릭|정션/i);
        assert.strictEqual(fs.readFileSync(path.join(outside, 'mplus-1m-regular.ttf'), 'utf8'), 'keep');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('RPG encrypted asset traversal rejects files reached through a junction', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-asset-link-'));
    const data = path.join(root, 'data');
    const imageRoot = path.join(root, 'img');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(data);
    fs.mkdirSync(imageRoot);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(data, 'System.json'), JSON.stringify({ encryptionKey: '0'.repeat(32) }));
    fs.writeFileSync(path.join(outside, 'secret.rpgmvp'), Buffer.from('outside'));
    try {
        fs.symlinkSync(outside, path.join(imageRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }
    const context = ctxmod.createOperationContext(new sinks.CapturingProgressSink(), new sinks.CapturingLogger());
    try {
        await assert.rejects(
            ctxmod.withOperationContext(context, () => DecryptDir(data, 'img')),
            (error) => error?.code === 'E_MAPPING_CORRUPT' && /link|junction|심볼릭|정션/i.test(error.message),
        );
        assert.strictEqual(fs.existsSync(path.join(data, 'Extract_img')), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('RPG extract rejects a JSON-like directory junction before creating outputs', async (t) => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-json-link-'));
    try {
        fs.cpSync(SRC, work, { recursive: true });
        const dir = path.join(work, 'www', 'data');
        const outside = path.join(work, 'outside-json');
        fs.mkdirSync(outside);
        fs.writeFileSync(path.join(outside, 'secret.txt'), 'keep', 'utf8');
        try {
            fs.symlinkSync(outside, path.join(dir, 'Map999.json'), process.platform === 'win32' ? 'junction' : 'dir');
        } catch (error) {
            t.skip(`symlink/junction creation unavailable: ${error.code}`);
            return;
        }
        const context = ctxmod.createOperationContext(
            new sinks.CapturingProgressSink(),
            new sinks.CapturingLogger(),
            { rpg: ctxmod.createRpgState({ ...datas.settings }) },
        );
        const svc = new RpgMakerService(context);
        await assert.rejects(
            svc.extract({ dir, ext_note: true }),
            (error) => error?.code === 'E_MAPPING_CORRUPT' && /link|junction|심볼릭|정션|일반 파일/i.test(error.message),
        );
        assert.strictEqual(fs.existsSync(path.join(dir, 'Extract')), false);
        assert.strictEqual(fs.existsSync(path.join(dir, 'Backup')), false);
        assert.strictEqual(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8'), 'keep');
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('RPG force extract rejects a planted Extract junction', async (t) => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-force-link-'));
    try {
        fs.cpSync(SRC, work, { recursive: true });
        const dir = path.join(work, 'www', 'data');
        const outside = path.join(work, 'outside-extract');
        fs.mkdirSync(outside);
        fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'keep', 'utf8');
        try {
            fs.symlinkSync(outside, path.join(dir, 'Extract'), process.platform === 'win32' ? 'junction' : 'dir');
        } catch (error) {
            t.skip(`symlink/junction creation unavailable: ${error.code}`);
            return;
        }
        const context = ctxmod.createOperationContext(
            new sinks.CapturingProgressSink(),
            new sinks.CapturingLogger(),
            { rpg: ctxmod.createRpgState({ ...datas.settings }) },
        );
        const svc = new RpgMakerService(context);
        await assert.rejects(
            svc.extract({ dir, force: true, ext_note: true }),
            (error) => error?.code === 'E_MAPPING_CORRUPT' && /link|junction|심볼릭|정션/i.test(error.message),
        );
        assert.strictEqual(fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'keep');
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('RPG extract rejects a YAML conversion that would overwrite a source JSON file', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-yaml-collision-'));
    try {
        fs.cpSync(SRC, work, { recursive: true });
        const dir = path.join(work, 'www', 'data');
        const actorsPath = path.join(dir, 'Actors.json');
        const originalActors = fs.readFileSync(actorsPath, 'utf8');
        fs.writeFileSync(path.join(dir, 'Actors.json.yaml'), '[]\n', 'utf8');
        const context = ctxmod.createOperationContext(
            new sinks.CapturingProgressSink(),
            new sinks.CapturingLogger(),
            { rpg: ctxmod.createRpgState({ ...datas.settings }) },
        );
        const svc = new RpgMakerService(context);
        await assert.rejects(
            svc.extract({ dir, ext_note: true }),
            (error) => error?.code === 'E_OUTPUT_CONFLICT' && /yaml|json|덮어|충돌/i.test(error.message),
        );
        assert.strictEqual(fs.readFileSync(actorsPath, 'utf8'), originalActors);
        assert.strictEqual(fs.existsSync(path.join(dir, 'Extract')), false);
        assert.strictEqual(fs.existsSync(path.join(dir, 'Backup')), false);
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('RPG extract requires force for an orphaned Backup and replaces it when forced', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-orphan-backup-'));
    try {
        fs.cpSync(SRC, work, { recursive: true });
        const dir = path.join(work, 'www', 'data');
        const backup = path.join(dir, 'Backup');
        fs.mkdirSync(backup);
        fs.writeFileSync(path.join(backup, 'sentinel.json'), '{}', 'utf8');
        const context = ctxmod.createOperationContext(
            new sinks.CapturingProgressSink(),
            new sinks.CapturingLogger(),
            { rpg: ctxmod.createRpgState({ ...datas.settings }) },
        );
        const svc = new RpgMakerService(context);
        await assert.rejects(
            svc.extract({ dir, ext_note: true }),
            (error) => error?.code === 'E_EXTRACT_EXISTS' && /Backup|추출|존재/i.test(error.message),
        );
        assert.strictEqual(fs.existsSync(path.join(backup, 'sentinel.json')), true);
        assert.strictEqual(fs.existsSync(path.join(dir, 'Extract')), false);

        await svc.extract({ dir, force: true, ext_note: true });
        assert.strictEqual(fs.existsSync(path.join(backup, 'sentinel.json')), false);
        assert.strictEqual(fs.existsSync(path.join(backup, 'Actors.json')), true);
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('RPG extract leaves no managed artifacts when source JSON parsing fails', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-extract-rollback-new-'));
    try {
        fs.cpSync(SRC, work, { recursive: true });
        const dir = path.join(work, 'www', 'data');
        fs.writeFileSync(path.join(dir, 'Actors.json'), '{ malformed json', 'utf8');
        const context = ctxmod.createOperationContext(
            new sinks.CapturingProgressSink(),
            new sinks.CapturingLogger(),
            { rpg: ctxmod.createRpgState({ ...datas.settings }) },
        );
        const svc = new RpgMakerService(context);

        await assert.rejects(svc.extract({ dir, ext_note: true }));
        assert.strictEqual(fs.existsSync(path.join(dir, 'Extract')), false);
        assert.strictEqual(fs.existsSync(path.join(dir, 'Backup')), false);
        assert.strictEqual(fs.existsSync(path.join(dir, '.extracteddata')), false);
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('RPG force extract preserves the previous managed pack when replacement fails', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-extract-rollback-old-'));
    try {
        fs.cpSync(SRC, work, { recursive: true });
        const dir = path.join(work, 'www', 'data');
        const context = ctxmod.createOperationContext(
            new sinks.CapturingProgressSink(),
            new sinks.CapturingLogger(),
            { rpg: ctxmod.createRpgState({ ...datas.settings }) },
        );
        const svc = new RpgMakerService(context);
        await svc.extract({ dir, ext_note: true });
        const extractSentinel = path.join(dir, 'Extract', 'keep.txt');
        const backupSentinel = path.join(dir, 'Backup', 'keep.json');
        fs.writeFileSync(extractSentinel, 'old extract', 'utf8');
        fs.writeFileSync(backupSentinel, 'old backup', 'utf8');
        const oldMapping = fs.readFileSync(path.join(dir, '.extracteddata'));
        fs.writeFileSync(path.join(dir, 'Actors.json'), '{ malformed json', 'utf8');

        await assert.rejects(svc.extract({ dir, force: true, ext_note: true }));
        assert.strictEqual(fs.readFileSync(extractSentinel, 'utf8'), 'old extract');
        assert.strictEqual(fs.readFileSync(backupSentinel, 'utf8'), 'old backup');
        assert.deepEqual(fs.readFileSync(path.join(dir, '.extracteddata')), oldMapping);
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('RPG extract reports success when only committed staging cleanup fails', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-extract-cleanup-'));
    const originalRmSync = fs.rmSync;
    let injected = false;
    try {
        fs.cpSync(SRC, work, { recursive: true });
        const dir = path.join(work, 'www', 'data');
        const logger = new sinks.CapturingLogger();
        const context = ctxmod.createOperationContext(
            new sinks.CapturingProgressSink(),
            logger,
            { rpg: ctxmod.createRpgState({ ...datas.settings }) },
        );
        const svc = new RpgMakerService(context);
        fs.rmSync = (target, options) => {
            if (!injected && path.basename(String(target)).startsWith('.tsukuru-rpg-extract.')) {
                injected = true;
                const error = new Error('simulated RPG staging cleanup failure');
                error.code = 'EACCES';
                throw error;
            }
            return originalRmSync(target, options);
        };

        const result = await svc.extract({ dir, ext_note: true });
        assert.ok(result.manifestEntries > 0);
        assert.strictEqual(injected, true);
        assert.strictEqual(fs.existsSync(path.join(dir, 'Extract', 'manifest.json')), true);
        assert.ok(logger.messages.some(({ level, message }) => level === 'warn' && /cleanup|정리|staging/i.test(message)));
    } finally {
        fs.rmSync = originalRmSync;
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('RPG extract rolls back managed artifacts when cancellation occurs between files', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-extract-cancel-'));
    try {
        fs.cpSync(SRC, work, { recursive: true });
        const dir = path.join(work, 'www', 'data');
        const controller = new AbortController();
        const progress = new sinks.CapturingProgressSink();
        const originalSet = progress.set.bind(progress);
        progress.set = (value) => {
            originalSet(value);
            controller.abort('cancel after first extracted file');
        };
        const logger = new sinks.CapturingLogger();
        const runtime = createOperationRuntime({ progress, logger, signal: controller.signal });
        const context = ctxmod.createOperationContext(
            progress,
            logger,
            { rpg: ctxmod.createRpgState({ ...datas.settings }) },
            runtime,
        );
        const svc = new RpgMakerService(context);

        await assert.rejects(
            svc.extract({ dir, ext_note: true }),
            (error) => error?.code === 'E_OPERATION_CANCELLED',
        );
        assert.strictEqual(fs.existsSync(path.join(dir, 'Extract')), false);
        assert.strictEqual(fs.existsSync(path.join(dir, 'Backup')), false);
        assert.strictEqual(fs.existsSync(path.join(dir, '.extracteddata')), false);
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('RPG text extraction leaves stale decrypted assets untouched when decryption is not requested', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-stale-assets-'));
    try {
        fs.cpSync(SRC, work, { recursive: true });
        const dir = path.join(work, 'www', 'data');
        const decrypted = path.join(dir, 'Extract_img');
        fs.mkdirSync(decrypted);
        fs.writeFileSync(path.join(decrypted, 'sentinel.png'), 'keep', 'utf8');
        const context = ctxmod.createOperationContext(
            new sinks.CapturingProgressSink(),
            new sinks.CapturingLogger(),
            { rpg: ctxmod.createRpgState({ ...datas.settings }) },
        );
        const svc = new RpgMakerService(context);
        await svc.extract({ dir, ext_note: true });
        assert.strictEqual(fs.readFileSync(path.join(decrypted, 'sentinel.png'), 'utf8'), 'keep');
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('RPG forced extraction preserves the previous text and asset pack when decryption fails', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-decrypt-group-rollback-'));
    try {
        fs.cpSync(SRC, work, { recursive: true });
        const dir = path.join(work, 'www', 'data');
        const context = ctxmod.createOperationContext(
            new sinks.CapturingProgressSink(),
            new sinks.CapturingLogger(),
            { rpg: ctxmod.createRpgState({ ...datas.settings }) },
        );
        const svc = new RpgMakerService(context);
        await svc.extract({ dir, ext_note: true });
        fs.writeFileSync(path.join(dir, 'Extract', 'sentinel.txt'), 'old text pack', 'utf8');
        fs.mkdirSync(path.join(dir, 'Extract_img'));
        fs.writeFileSync(path.join(dir, 'Extract_img', 'sentinel.png'), 'old asset pack', 'utf8');

        await assert.rejects(
            svc.extract({ dir, ext_note: true, decryptImg: true, force: true }),
            (error) => error?.code === 'ENOENT' || error?.code === 'E_MAPPING_CORRUPT',
        );
        assert.strictEqual(fs.readFileSync(path.join(dir, 'Extract', 'sentinel.txt'), 'utf8'), 'old text pack');
        assert.strictEqual(
            fs.readFileSync(path.join(dir, 'Extract_img', 'sentinel.png'), 'utf8'),
            'old asset pack',
        );
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('RPG plugin extraction rejects a js directory junction', async (t) => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-plugin-link-'));
    try {
        fs.cpSync(SRC, work, { recursive: true });
        const dir = path.join(work, 'www', 'data');
        const outside = path.join(work, 'outside-js');
        fs.mkdirSync(outside);
        fs.writeFileSync(path.join(outside, 'plugins.js'), 'var $plugins = [];', 'utf8');
        try {
            fs.symlinkSync(outside, path.join(work, 'www', 'js'), process.platform === 'win32' ? 'junction' : 'dir');
        } catch (error) {
            t.skip(`symlink/junction creation unavailable: ${error.code}`);
            return;
        }
        const context = ctxmod.createOperationContext(
            new sinks.CapturingProgressSink(),
            new sinks.CapturingLogger(),
            { rpg: ctxmod.createRpgState({ ...datas.settings }) },
        );
        const svc = new RpgMakerService(context);
        await assert.rejects(
            svc.extract({ dir, ext_plugin: true, ext_note: true }),
            (error) => error?.code === 'E_MAPPING_CORRUPT' && /plugin|link|junction|심볼릭|정션|경로/i.test(error.message),
        );
        assert.strictEqual(fs.existsSync(path.join(dir, 'Extract')), false);
        assert.strictEqual(fs.existsSync(path.join(dir, 'Backup')), false);
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('RPG plugin extraction still supports the standard sibling js directory', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-plugin-standard-'));
    try {
        fs.cpSync(SRC, work, { recursive: true });
        const dir = path.join(work, 'www', 'data');
        const jsDir = path.join(work, 'www', 'js');
        fs.mkdirSync(jsDir);
        fs.writeFileSync(
            path.join(jsDir, 'plugins.js'),
            'var $plugins = [{"name":"Sample","status":true,"description":"설명","parameters":{"message":"안녕"}}];',
            'utf8',
        );
        const context = ctxmod.createOperationContext(
            new sinks.CapturingProgressSink(),
            new sinks.CapturingLogger(),
            { rpg: ctxmod.createRpgState({ ...datas.settings }) },
        );
        const svc = new RpgMakerService(context);
        const report = await svc.extract({ dir, ext_plugin: true, exJson: true, ext_note: true });
        assert.strictEqual(fs.existsSync(path.join(dir, 'Backup', 'ext_plugins.json')), true);
        assert.strictEqual(fs.existsSync(path.join(dir, 'ext_plugins.json')), false);
        assert(report.extractedFiles.some((file) => /ext_plugins\.txt$/i.test(file)));
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
});
