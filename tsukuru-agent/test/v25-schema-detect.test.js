const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const asar = require('@electron/asar');

const { validateRequest } = require('../src/core/schema.js');
const { detectProject } = require('../src/cli/formatDetect.js');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-schema-'));
}

test('keeps v1 requests and accepts v2 diagnostic options', () => {
    const base = { operation: 'verify', format: 'auto', projectPath: tempDir(), profile: 'standard', options: {}, patches: [] };
    const v1 = validateRequest({ schemaVersion: 1, ...base });
    const v2 = validateRequest({ schemaVersion: 2, ...base, options: { verifyDepth: 'deep', humanSummary: true } });
    assert.equal(v1.schemaVersion, 1);
    assert.equal(v2.schemaVersion, 2);
    assert.equal(v2.options.verifyDepth, 'deep');
});

test('validates the bounded opt-in launch probe options', () => {
    const base = { schemaVersion: 2, operation: 'apply', format: 'auto', projectPath: tempDir(), profile: 'standard', patches: [] };
    const request = validateRequest({ ...base, options: { launchProbe: true, launchTimeoutMs: 2500 } });
    assert.equal(request.options.launchProbe, true);
    assert.equal(request.options.launchTimeoutMs, 2500);
    assert.throws(
        () => validateRequest({ ...base, options: { launchProbe: 'yes' } }),
        (err) => err && err.code === 'E_REQUEST_INVALID',
    );
    assert.throws(
        () => validateRequest({ ...base, options: { launchProbe: true, launchTimeoutMs: 60_000 } }),
        (err) => err && err.code === 'E_REQUEST_INVALID',
    );
});

test('detects an Electron ASAR nested MZ project without extracting it', async () => {
    const root = tempDir();
    const source = path.join(root, 'source');
    const game = path.join(root, 'game');
    const archive = path.join(game, 'resources', 'app.asar');
    fs.mkdirSync(path.join(source, 'project', 'data'), { recursive: true });
    fs.mkdirSync(path.join(source, 'project', 'js'), { recursive: true });
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.writeFileSync(path.join(source, 'project', 'data', 'Actors.json'), '[]');
    fs.writeFileSync(path.join(source, 'project', 'js', 'rmmz_core.js'), '');
    await asar.createPackage(source, archive);

    const detected = detectProject(game);
    assert.equal(detected.format, 'rpgmz');
    assert.equal(detected.container.type, 'electron-asar');
    assert.equal(detected.container.engine.root, 'project');
    assert.equal(detected.dataDir, path.join(game, 'project', 'data'));
});
