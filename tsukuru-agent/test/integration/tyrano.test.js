const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const iconv = require('iconv-lite');

const { TyranoService } = require('../../.build/app/src/js/tyrano/TyranoService.js');
const { applyPatches } = require('../../.build/app/src/cli/patcher.js');
const { runAgent } = require('../../.build/app/src/cli/run.js');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-tyrano-pipeline-'));
}

test('extracts only translatable Tyrano KS text segments into a manifest-backed workspace', () => {
    const root = tempDir();
    const scenarioDir = path.join(root, 'data', 'scenario');
    fs.mkdirSync(scenarioDir, { recursive: true });
    fs.writeFileSync(path.join(scenarioDir, 'first.ks'), [
        '; translator comment',
        '*start',
        '[bg storage="room.jpg"]',
        '[if exp="true"]',
        'こんにちは[l]',
        '@wait time=100',
        '[iscript]',
        'const hidden = "Do not extract";',
        '[endscript]',
        '世界',
        '[endif]',
    ].join('\n'));

    const service = new TyranoService();
    const report = service.extract({ projectRoot: root });

    assert.equal(report.extractedEntries, 2);
    assert.equal(report.extractedFiles, 1);
    const manifest = JSON.parse(fs.readFileSync(report.manifestPath, 'utf8'));
    assert.equal(manifest.format, 'tyrano');
    assert.equal(manifest.entries.length, 2);
    assert.equal(manifest.sourceSnapshots['data/scenario/first.ks'].encoding, 'utf8');
    assert.deepEqual(
        manifest.entries.map((entry) => entry.id),
        ['data/scenario/first.ks#L5:C1-6', 'data/scenario/first.ks#L10:C1-3'],
    );
    assert.deepEqual(
        manifest.entries.map((entry) => entry.tyrano),
        [
            { line: 4, start: 0, end: 5, sourceHash: manifest.entries[0].tyrano.sourceHash },
            { line: 9, start: 0, end: 2, sourceHash: manifest.entries[1].tyrano.sourceHash },
        ],
    );
    assert.equal(fs.readFileSync(path.join(root, 'data', '_Extract', 'scenario', 'first.ks.txt'), 'utf8'), 'こんにちは\n世界');
    assert.equal(fs.readFileSync(path.join(scenarioDir, 'first.ks'), 'utf8').includes('Do not extract'), true);
});

test('Tyrano force extract restores the previous workspace when commit fails', () => {
    const root = tempDir();
    const scenarioDir = path.join(root, 'data', 'scenario');
    fs.mkdirSync(scenarioDir, { recursive: true });
    const scenario = path.join(scenarioDir, 'first.ks');
    fs.writeFileSync(scenario, 'Old text[l]\n');
    const service = new TyranoService();
    const first = service.extract({ projectRoot: root });
    const sentinel = path.join(first.extractDir, 'keep.txt');
    fs.writeFileSync(sentinel, 'old workspace');
    const oldManifest = fs.readFileSync(first.manifestPath);
    fs.writeFileSync(scenario, 'New text[l]\n');
    const originalRename = fs.renameSync;
    fs.renameSync = (source, destination) => {
        if (path.resolve(destination) === path.resolve(first.extractDir)
            && path.basename(source).includes('.tsukuru-stage-')) {
            throw new Error('simulated Tyrano extract commit failure');
        }
        return originalRename(source, destination);
    };
    try {
        assert.throws(
            () => service.extract({ projectRoot: root, force: true }),
            /simulated Tyrano extract commit failure/,
        );
    } finally {
        fs.renameSync = originalRename;
    }
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'old workspace');
    assert.deepEqual(fs.readFileSync(first.manifestPath), oldManifest);
    assert.deepEqual(
        fs.readdirSync(path.join(root, 'data')).filter((name) => /\.tsukuru-(stage|backup)-/.test(name)),
        [],
    );
});

test('patches a Tyrano extraction workspace without requiring legacy extracteddata', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'data', 'scenario'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data', 'scenario', 'first.ks'), 'こんにちは[l]\n');
    const service = new TyranoService();
    const extracted = service.extract({ projectRoot: root });
    const manifest = JSON.parse(fs.readFileSync(extracted.manifestPath, 'utf8'));
    const entry = manifest.entries[0];

    const result = applyPatches(extracted.extractDir, 'tyrano', [{
        id: entry.id,
        expectedHash: entry.hash,
        text: '번역문',
    }]);

    assert.deepEqual(result, { patched: 1, files: 1 });
    assert.equal(fs.readFileSync(path.join(extracted.extractDir, entry.extractFile), 'utf8'), '번역문');
    const updated = JSON.parse(fs.readFileSync(extracted.manifestPath, 'utf8'));
    assert.notEqual(updated.entries[0].hash, entry.hash);
    assert.equal(updated.entries[0].tyrano.sourceHash, entry.tyrano.sourceHash);
    assert.equal(fs.existsSync(path.join(extracted.extractDir, '.extracteddata')), false);
});

test('applies patched Tyrano segments to a validated game copy while preserving the source', () => {
    const root = tempDir();
    const game = path.join(root, 'game');
    const output = path.join(root, 'translated');
    const scenario = path.join(game, 'data', 'scenario', 'first.ks');
    const config = path.join(game, 'data', 'system', 'Config.tjs');
    fs.mkdirSync(path.dirname(scenario), { recursive: true });
    fs.mkdirSync(path.dirname(config), { recursive: true });
    fs.writeFileSync(scenario, '[if exp="true"]\nこんにちは[l]\n[endif]\n');
    fs.writeFileSync(config, 'function setup() { return true; }\n');
    const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(scenario)).digest('hex');
    const service = new TyranoService();
    const extracted = service.extract({ projectRoot: game });
    const manifest = JSON.parse(fs.readFileSync(extracted.manifestPath, 'utf8'));
    const entry = manifest.entries[0];
    applyPatches(extracted.extractDir, 'tyrano', [{ id: entry.id, expectedHash: entry.hash, text: '번역문' }]);

    const result = service.applyToCopy({ projectRoot: game, outputRoot: output });

    assert.equal(result.appliedEntries, 1);
    assert.equal(result.appliedFiles, 1);
    assert.equal(result.validation.ok, true, JSON.stringify(result.validation.issues));
    assert.equal(fs.readFileSync(path.join(output, 'data', 'scenario', 'first.ks'), 'utf8'), '[if exp="true"]\n번역문[l]\n[endif]\n');
    assert.equal(fs.readFileSync(path.join(output, 'data', 'system', 'Config.tjs'), 'utf8'), 'function setup() { return true; }\n');
    assert.equal(fs.existsSync(path.join(output, 'data', '_Extract')), false);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(scenario)).digest('hex'), sourceHash);
});

test('rejects a Tyrano extraction workspace reached through a junction before apply', (t) => {
    const root = tempDir();
    const game = path.join(root, 'game');
    const output = path.join(root, 'translated');
    const scenario = path.join(game, 'data', 'scenario', 'first.ks');
    fs.mkdirSync(path.dirname(scenario), { recursive: true });
    fs.writeFileSync(scenario, 'Hello[l]\n');
    const service = new TyranoService();
    const extracted = service.extract({ projectRoot: game });
    const outsideExtract = path.join(root, 'outside-extract');
    fs.cpSync(extracted.extractDir, outsideExtract, { recursive: true });
    fs.rmSync(extracted.extractDir, { recursive: true, force: true });
    try {
        fs.symlinkSync(outsideExtract, extracted.extractDir, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }

    assert.throws(
        () => service.applyToCopy({ projectRoot: game, outputRoot: output }),
        (error) => error?.code === 'E_MAPPING_CORRUPT' && /link|junction|심볼릭|정션/i.test(error.message),
    );
    assert.equal(fs.existsSync(output), false);
    assert.equal(fs.readFileSync(scenario, 'utf8'), 'Hello[l]\n');
});

test('rejects an unrelated Tyrano source junction before copy publication', (t) => {
    const root = tempDir();
    const game = path.join(root, 'game');
    const output = path.join(root, 'translated');
    const scenario = path.join(game, 'data', 'scenario', 'first.ks');
    const outside = path.join(root, 'outside-assets');
    fs.mkdirSync(path.dirname(scenario), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(scenario, 'Hello[l]\n');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    const service = new TyranoService();
    service.extract({ projectRoot: game });
    fs.mkdirSync(path.join(game, 'assets'), { recursive: true });
    try {
        fs.symlinkSync(outside, path.join(game, 'assets', 'external'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }

    assert.throws(
        () => service.applyToCopy({ projectRoot: game, outputRoot: output }),
        (error) => error?.code === 'E_VERIFY_FAILED' && /link|junction|심볼릭|정션/i.test(error.message),
    );
    assert.equal(fs.existsSync(output), false);
    assert.equal(fs.readdirSync(root).some((name) => name.includes('tyrano-staging')), false);
});

test('runs the Tyrano extract, patch, verify, and apply pipeline through the agent CLI', async () => {
    const root = tempDir();
    const game = path.join(root, 'game');
    const output = path.join(root, 'translated');
    const scenario = path.join(game, 'data', 'scenario', 'first.ks');
    fs.mkdirSync(path.dirname(scenario), { recursive: true });
    fs.writeFileSync(scenario, '*start\nこんにちは[l]\n');
    const invoke = async (name, request) => {
        const requestPath = path.join(root, `${name}.json`);
        fs.writeFileSync(requestPath, JSON.stringify(request));
        let stdout = '';
        const originalWrite = process.stdout.write;
        process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
        let status;
        try { status = await runAgent(['run', '--request', requestPath]); } finally { process.stdout.write = originalWrite; }
        return { status, result: JSON.parse(stdout) };
    };
    const request = (operation, extra = {}) => ({
        schemaVersion: 2, operation, format: 'auto', projectPath: game,
        profile: 'standard', options: {}, patches: [], ...extra,
    });

    let response = await invoke('extract', request('extract'));
    assert.equal(response.status, 0, JSON.stringify(response.result));
    assert.equal(response.result.stats.entries, 1);
    const manifestPath = path.join(game, 'data', '_Extract', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const entry = manifest.entries[0];

    response = await invoke('patch', request('patch', {
        patches: [{ id: entry.id, expectedHash: entry.hash, text: '번역문' }],
    }));
    assert.equal(response.status, 0, JSON.stringify(response.result));

    response = await invoke('verify', request('verify'));
    assert.equal(response.status, 0, JSON.stringify(response.result));
    assert.equal(response.result.validation.profile, 'tyrano');
    assert.equal(response.result.validation.entriesChecked, 1);
    assert.equal(response.result.scores.reinsertionValidity, 100);

    response = await invoke('apply', request('apply', { outputPath: output }));
    assert.equal(response.status, 0, JSON.stringify(response.result));
    assert.equal(response.result.validation.ok, true, JSON.stringify(response.result.validation.issues));
    assert.equal(fs.readFileSync(path.join(output, 'data', 'scenario', 'first.ks'), 'utf8'), '*start\n번역문[l]\n');
    assert.equal(fs.existsSync(path.join(output, 'data', '_Extract')), false);
});

test('rejects a tampered Tyrano manifest that targets a protected system script', () => {
    const root = tempDir();
    const game = path.join(root, 'game');
    const output = path.join(root, 'translated');
    const scenario = path.join(game, 'data', 'scenario', 'first.ks');
    const config = path.join(game, 'data', 'system', 'Config.tjs');
    fs.mkdirSync(path.dirname(scenario), { recursive: true });
    fs.mkdirSync(path.dirname(config), { recursive: true });
    fs.writeFileSync(scenario, 'Hello\n');
    fs.writeFileSync(config, 'SECRET\n');
    const service = new TyranoService();
    const extracted = service.extract({ projectRoot: game });
    const manifest = JSON.parse(fs.readFileSync(extracted.manifestPath, 'utf8'));
    manifest.entries[0].sourceFile = 'data/system/Config.tjs';
    manifest.entries[0].tyrano = {
        line: 0, start: 0, end: 6,
        sourceHash: crypto.createHash('sha256').update('SECRET').digest('hex'),
    };
    manifest.sourceSnapshots['data/system/Config.tjs'] = {
        hash: crypto.createHash('sha256').update(fs.readFileSync(config)).digest('hex'),
        encoding: 'utf8',
    };
    fs.writeFileSync(extracted.manifestPath, JSON.stringify(manifest));

    assert.throws(
        () => service.applyToCopy({ projectRoot: game, outputRoot: output }),
        (error) => error?.code === 'E_MAPPING_CORRUPT' && /scenario/i.test(error.message),
    );
    assert.equal(fs.readFileSync(config, 'utf8'), 'SECRET\n');
    assert.equal(fs.existsSync(output), false);
});

test('returns a specific integrity error when translation cannot round-trip Shift_JIS', () => {
    const root = tempDir();
    const game = path.join(root, 'game');
    const output = path.join(root, 'translated');
    const scenario = path.join(game, 'data', 'scenario', 'first.ks');
    fs.mkdirSync(path.dirname(scenario), { recursive: true });
    fs.writeFileSync(scenario, iconv.encode('こんにちは[l]\n', 'shift_jis'));
    const service = new TyranoService();
    const extracted = service.extract({ projectRoot: game });
    const manifest = JSON.parse(fs.readFileSync(extracted.manifestPath, 'utf8'));
    const entry = manifest.entries[0];
    applyPatches(extracted.extractDir, 'tyrano', [{ id: entry.id, expectedHash: entry.hash, text: '한국어 번역' }]);

    assert.throws(
        () => service.applyToCopy({ projectRoot: game, outputRoot: output }),
        (error) => error?.code === 'E_ENCODING_UNREPRESENTABLE',
    );
    assert.equal(iconv.decode(fs.readFileSync(scenario), 'shift_jis'), 'こんにちは[l]\n');
    assert.equal(fs.existsSync(output), false);
});

test('verify returns a scored Tyrano validation report when source changed after extraction', async () => {
    const root = tempDir();
    const game = path.join(root, 'game');
    const scenario = path.join(game, 'data', 'scenario', 'first.ks');
    fs.mkdirSync(path.dirname(scenario), { recursive: true });
    fs.writeFileSync(scenario, 'Hello\n');
    new TyranoService().extract({ projectRoot: game });
    fs.writeFileSync(scenario, 'Changed outside agent\n');
    const requestPath = path.join(root, 'verify.json');
    fs.writeFileSync(requestPath, JSON.stringify({
        schemaVersion: 2, operation: 'verify', format: 'auto', projectPath: game,
        profile: 'standard', options: {}, patches: [],
    }));
    let stdout = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
    let status;
    try { status = await runAgent(['run', '--request', requestPath]); } finally { process.stdout.write = originalWrite; }
    const result = JSON.parse(stdout);

    assert.equal(status, 1);
    assert.equal(result.error.code, 'E_VERIFY_FAILED');
    assert.equal(result.validation.profile, 'tyrano');
    assert.equal(result.validation.ok, false);
    assert.equal(result.validation.invalidEntries, 1);
    assert.ok(result.validation.issues.some((issue) => issue.code === 'TYRANO_SOURCE_CHANGED'));
    assert.equal(result.scores.reinsertionValidity, 0);
});
