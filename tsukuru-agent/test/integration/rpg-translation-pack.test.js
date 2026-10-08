const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const asar = require('@electron/asar');
const { executeAgentRequest } = require('../../.build/app/src/cli/run.js');

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const run = (operation, projectPath, extra = {}, execution = {}) => executeAgentRequest({
    schemaVersion: 2, operation, projectPath, format: 'auto', profile: 'standard',
    options: {}, patches: [], ...extra,
}, execution);
function files(root) {
    const result = {};
    const visit = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) visit(file);
            else result[path.relative(root, file).replaceAll('\\', '/')] = hash(fs.readFileSync(file));
        }
    };
    visit(root);
    return result;
}
async function fixture(t, archived) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-compact-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, 'source');
    const game = archived ? path.join(root, 'game') : source;
    const engine = archived ? 'project' : 'www';
    const data = path.join(source, engine, 'data');
    const js = path.join(source, engine, 'js');
    fs.mkdirSync(data, { recursive: true });
    fs.mkdirSync(path.join(js, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ main: `${engine}/index.html` }));
    fs.writeFileSync(path.join(source, engine, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(data, 'Actors.json'), JSON.stringify([null, { id: 1, name: 'Alice', profile: 'Hello' }]));
    fs.writeFileSync(path.join(data, 'System.json'), JSON.stringify({ gameTitle: 'Original', encryptionKey: '' }));
    fs.writeFileSync(path.join(data, 'CommonEvents.json'), JSON.stringify([null, {
        id: 1, name: 'Scene', trigger: 0, switchId: 1, list: [
            { code: 357, indent: 0, parameters: ['Live2DExample', 'show', 'Show', { modelName: 'Hero' }] },
            { code: 355, indent: 0, parameters: ['const label = "Hello";'] },
            { code: 0, indent: 0, parameters: [] },
        ],
    }]));
    fs.writeFileSync(path.join(js, archived ? 'rmmz_core.js' : 'rpg_core.js'), '// protected core');
    fs.writeFileSync(path.join(js, 'plugins.js'), '// preserve comment\nvar $plugins = ' + JSON.stringify([
        { name: 'Live2DExample', status: true, description: 'fixture', parameters: { modelName: 'Hero', optionName: 'Voice' } },
    ]) + ';\n');
    fs.writeFileSync(path.join(js, 'plugins', 'Live2DExample.js'), 'throw new Error("must never execute");');
    const modelDir = path.join(source, engine, 'img', 'live2d', 'Hero');
    fs.mkdirSync(modelDir, { recursive: true });
    fs.writeFileSync(path.join(modelDir, 'Hero.model3.json'), '{"FileReferences":{"Moc":"Hero.moc3"}}');
    fs.writeFileSync(path.join(modelDir, 'Hero.moc3'), Buffer.alloc(1024 * 1024, 17));
    fs.writeFileSync(path.join(modelDir, 'texture.png'), Buffer.alloc(1024 * 1024, 19));
    if (archived) {
        fs.mkdirSync(path.join(game, 'resources'), { recursive: true });
        fs.copyFileSync(process.execPath, path.join(game, 'Game.exe'));
        await asar.createPackage(source, path.join(game, 'resources', 'app.asar'));
    } else {
        // Existing extraction artifacts in the supplied game are not fresh inputs.
        fs.mkdirSync(path.join(data, 'Extract'));
        fs.writeFileSync(path.join(data, 'Extract', 'old.txt'), 'keep existing source artifact');
    }
    return { root, source, game, engine, data, pack: path.join(root, 'pack'), output: path.join(root, 'output') };
}
function outputFile(f, name) {
    asar.uncache(path.join(f.output, 'resources', 'app.asar'));
    return fs.existsSync(path.join(f.output, 'resources', 'app.asar'))
        ? asar.extractFile(path.join(f.output, 'resources', 'app.asar'), path.normalize(name))
        : fs.readFileSync(path.join(f.output, name));
}

test('compact RPG packs extract without assets and round-trip mapped text and plugin parameters', async t => {
    for (const archived of [false, true]) await t.test(archived ? 'ASAR MZ with Live2D' : 'loose MV with plugins', async t => {
        const f = await fixture(t, archived);
        const sourceBefore = files(f.game);
        const extractAll = asar.extractAll;
        asar.extractAll = () => { throw new Error('compact extract must not expand full archive'); };
        let extracted;
        try {
            extracted = await run('extract', f.game, {
                profile: 'full', outputPath: f.pack, options: { translationPack: true },
            });
        } finally { asar.extractAll = extractAll; }
        assert.equal(extracted.ok, true, JSON.stringify(extracted.error));
        assert.deepEqual(fs.readdirSync(f.pack).sort(), ['.extracteddata', '.tsukuru-rpg-pack.json', 'Backup', 'Extract']);
        assert.ok(Object.keys(files(f.pack)).every(name => !/live2d|\.moc3|texture\.png|rmmz_core|rpg_core/i.test(name)));
        const moved = path.join(f.root, '한글 작업팩');
        fs.renameSync(f.pack, moved);
        f.pack = moved;
        const checked = await run('verify', f.pack, { options: { verifyDepth: 'deep' } });
        assert.equal(checked.ok, true, JSON.stringify(checked.error));
        assert.equal(checked.format, archived ? 'rpgmz' : 'rpgmv');
        const metadata = fs.readFileSync(path.join(f.pack, '.tsukuru-rpg-pack.json'), 'utf8');
        assert.equal(metadata.includes(f.game), false);
        const noopPack = files(f.pack);
        const noop = await run('apply', f.pack, { outputPath: f.output, options: { containerSourcePath: f.game } });
        assert.equal(noop.ok, true, JSON.stringify(noop.error));
        assert.deepEqual(outputFile(f, `${f.engine}/js/plugins.js`), fs.readFileSync(path.join(f.source, f.engine, 'js', 'plugins.js')));
        assert.deepEqual(files(f.pack), noopPack);
        const manifest = JSON.parse(fs.readFileSync(path.join(f.pack, 'Extract', 'manifest.json'), 'utf8'));
        const actor = manifest.entries.find(e => e.id === 'Actors.json#1.name');
        const plugin = manifest.entries.find(e => e.id === 'ext_plugins.json#0.parameters.optionName');
        assert.ok(actor && plugin, 'normal and plugin parameter text both mapped');
        const patched = await run('patch', f.pack, { patches: [
            { id: actor.id, expectedHash: actor.hash, text: '앨리스' },
            { id: plugin.id, expectedHash: plugin.hash, text: '음성' },
        ] });
        assert.equal(patched.ok, true, JSON.stringify(patched.error));
        const packBeforeApply = files(f.pack);
        const applied = await run('apply', f.pack, { outputPath: f.output, options: { containerSourcePath: f.game, force: true } });
        assert.equal(applied.ok, true, JSON.stringify(applied.error));
        assert.equal(JSON.parse(outputFile(f, `${f.engine}/data/Actors.json`))[1].name, '앨리스');
        const plugins = outputFile(f, `${f.engine}/js/plugins.js`).toString('utf8');
        assert.match(plugins, /음성/);
        assert.match(plugins, /"modelName":"Hero"/);
        for (const name of [`${f.engine}/img/live2d/Hero/Hero.moc3`, `${f.engine}/img/live2d/Hero/texture.png`, `${f.engine}/js/plugins/Live2DExample.js`]) {
            assert.deepEqual(outputFile(f, name), fs.readFileSync(path.join(f.source, name)));
        }
        assert.deepEqual(files(f.game), sourceBefore);
        assert.deepEqual(files(f.pack), packBeforeApply);
        assert.equal(applied.change.protectedScriptDamage, 0);
    });
});

test('compact extraction rejects conflicting contracts and preserves existing output on failure', async t => {
    const f = await fixture(t, false);
    fs.mkdirSync(f.pack);
    fs.writeFileSync(path.join(f.pack, 'sentinel'), 'unchanged');
    const before = files(f.game);
    for (const options of [{ translationPack: true }, { translationPack: true, decryptImg: true, force: true }]) {
        const result = await run('extract', f.game, { outputPath: f.pack, options });
        assert.equal(result.ok, false);
        assert.equal(fs.readFileSync(path.join(f.pack, 'sentinel'), 'utf8'), 'unchanged');
    }
    const missingOutput = await run('extract', f.game, { options: { translationPack: true } });
    assert.equal(missingOutput.error.code, 'E_REQUEST_INVALID');
    const wrongOperation = await run('verify', f.game, { options: { translationPack: true } });
    assert.equal(wrongOperation.error.code, 'E_REQUEST_INVALID');
    fs.writeFileSync(path.join(f.data, 'Actors.json'), '{');
    const invalidSourceBefore = files(f.game);
    const failed = await run('extract', f.game, { outputPath: f.pack, options: { translationPack: true, force: true } });
    assert.equal(failed.ok, false);
    assert.equal(fs.readFileSync(path.join(f.pack, 'sentinel'), 'utf8'), 'unchanged');
    assert.equal(Object.keys(files(f.game)).length, Object.keys(before).length);
    assert.deepEqual(files(f.game), invalidSourceBefore);
    assert.ok(!fs.readdirSync(f.root).some(name => /staging/.test(name)));
});

test('compact resource accounting includes reconnected source and cancellation rolls back a staged game copy', async t => {
    const f = await fixture(t, false);
    const extracted = await run('extract', f.game, {
        outputPath: f.pack, options: { translationPack: true, resourceLimits: { maxTempBytes: 1024 * 1024 } },
    });
    assert.equal(extracted.ok, true, JSON.stringify(extracted.error));
    const before = files(f.game);
    const limited = await run('apply', f.pack, {
        outputPath: f.output, options: { containerSourcePath: f.game, resourceLimits: { maxTempBytes: 1024 * 1024 } },
    });
    assert.equal(limited.error.code, 'E_RESOURCE_LIMIT_EXCEEDED');
    assert.equal(fs.existsSync(f.output), false);
    fs.mkdirSync(f.output);
    fs.writeFileSync(path.join(f.output, 'sentinel'), 'previous output');
    const controller = new AbortController();
    const copy = fs.copyFileSync;
    let cancelledDuringCopy = false;
    fs.copyFileSync = (source, ...args) => {
        const result = copy(source, ...args);
        if (path.resolve(String(source)) === path.join(f.game, f.engine, 'img', 'live2d', 'Hero', 'Hero.moc3')) {
            cancelledDuringCopy = true;
            controller.abort();
        }
        return result;
    };
    let cancelled;
    try {
        cancelled = await run('apply', f.pack, {
            outputPath: f.output, options: { containerSourcePath: f.game, force: true },
        }, { signal: controller.signal });
    } finally { fs.copyFileSync = copy; }
    assert.equal(cancelledDuringCopy, true);
    assert.equal(cancelled.error.code, 'E_OPERATION_CANCELLED');
    assert.deepEqual(fs.readdirSync(f.output), ['sentinel']);
    assert.deepEqual(files(f.game), before);
});

test('compact apply rejects stale source and forged immutable metadata without publishing output', async t => {
    const f = await fixture(t, false);
    const extracted = await run('extract', f.game, { outputPath: f.pack, options: { translationPack: true } });
    assert.equal(extracted.ok, true, JSON.stringify(extracted.error));
    const sourceBefore = files(f.game);
    const actorsPath = path.join(f.data, 'Actors.json');
    const original = fs.readFileSync(actorsPath);
    fs.writeFileSync(actorsPath, JSON.stringify([null, { id: 1, name: 'Changed', profile: 'Hello' }]));
    const stale = await run('apply', f.pack, { outputPath: f.output, options: { containerSourcePath: f.game } });
    assert.equal(stale.error.code, 'E_SOURCE_CHANGED');
    assert.equal(fs.existsSync(f.output), false);
    fs.writeFileSync(actorsPath, original);
    const metaPath = path.join(f.pack, '.tsukuru-rpg-pack.json');
    const originalMeta = fs.readFileSync(metaPath);
    const backup = path.join(f.pack, 'Backup', 'Actors.json');
    const originalBackup = fs.readFileSync(backup);
    const changedBackup = JSON.stringify([null, { id: 1, name: 'Forged', profile: 'Hello' }]);
    fs.writeFileSync(backup, changedBackup);
    const resealed = JSON.parse(originalMeta);
    resealed.immutable.find(item => item.path === 'Backup/Actors.json').sha256 = hash(Buffer.from(changedBackup));
    fs.writeFileSync(metaPath, JSON.stringify(resealed));
    const resealResult = await run('apply', f.pack, { outputPath: f.output, options: { containerSourcePath: f.game } });
    assert.equal(resealResult.error.code, 'E_SOURCE_CHANGED', 'metadata alone cannot authenticate forged Backup');
    assert.equal(fs.existsSync(f.output), false);
    fs.writeFileSync(backup, originalBackup);
    fs.writeFileSync(metaPath, originalMeta);
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.source.inputs[0].path = '../escape.json';
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    const forged = await run('apply', f.pack, { outputPath: f.output, options: { containerSourcePath: f.game } });
    assert.equal(forged.ok, false);
    assert.equal(fs.existsSync(f.output), false);
    assert.deepEqual(files(f.game), sourceBefore);
});

test('compact metadata refuses linked immutable files and honors explicit contract scope', async t => {
    const f = await fixture(t, false);
    const extracted = await run('extract', f.game, { outputPath: f.pack, options: { translationPack: true } });
    assert.equal(extracted.ok, true, JSON.stringify(extracted.error));
    const { validateRequest, validateResolvedRequest } = require('../../.build/app/src/core/schema.js');
    const request = { schemaVersion: 2, operation: 'extract', projectPath: f.game, outputPath: f.pack,
        format: 'auto', profile: 'full', options: { translationPack: true }, patches: [] };
    const valid = validateRequest(request);
    assert.equal(validateResolvedRequest(valid, 'rpgmz'), valid);
    assert.throws(() => validateResolvedRequest(valid, 'gdevelop'), e => e.code === 'E_REQUEST_INVALID');
    assert.throws(() => validateRequest({ ...request, options: { translationPack: 'yes' } }), e => e.code === 'E_REQUEST_INVALID');
    const invalidYaml = await run('apply', f.pack, { outputPath: f.output, options: { containerSourcePath: f.game, useYaml: true } });
    assert.equal(invalidYaml.error.code, 'E_REQUEST_INVALID');
    const backup = path.join(f.pack, 'Backup');
    const outside = path.join(f.root, 'original-backups');
    fs.renameSync(backup, outside);
    fs.symlinkSync(outside, backup, process.platform === 'win32' ? 'junction' : 'dir');
    const linked = await run('verify', f.pack, { options: { verifyDepth: 'deep' } });
    assert.equal(linked.ok, false);
    assert.equal(fs.existsSync(f.output), false);
});
