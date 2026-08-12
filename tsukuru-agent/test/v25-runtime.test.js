const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { finished } = require('node:stream/promises');
const asar = require('@electron/asar');
const { NtExecutable, NtExecutableResource } = require('resedit');

const {
    calculateAsarHeaderSha256,
    findElectronExecutables,
    inspectElectronFuses,
    inspectElectronRuntime,
    inspectWindowsSignature,
    inspectWindowsAsarIntegrity,
    isRuntimeIntegrityBlocked,
    normalizeAuthenticodeStatus,
    runLaunchProbe,
} = require('../src/core/runtimeDiagnostics.js');

test('selects the game executable and excludes updater or crash helpers', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-runtime-'));
    fs.mkdirSync(path.join(root, 'resources'), { recursive: true });
    fs.writeFileSync(path.join(root, 'MyGame.exe'), 'game');
    fs.writeFileSync(path.join(root, 'Update.exe'), 'updater');
    fs.writeFileSync(path.join(root, 'unins000.exe'), 'uninstaller');
    fs.writeFileSync(path.join(root, 'crashpad_handler.exe'), 'crash');

    const result = findElectronExecutables(root);

    assert.equal(result.primary, path.join(root, 'MyGame.exe'));
    assert.deepEqual(result.candidates, [path.join(root, 'MyGame.exe')]);
});

test('calculates the Electron ASAR header hash used by embedded integrity', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-header-'));
    const source = path.join(root, 'source');
    const archive = path.join(root, 'app.asar');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'package.json'), '{}');
    const stream = await asar.createPackage(source, archive);
    if (!stream.writableFinished) await finished(stream);
    const expected = crypto.createHash('sha256').update(asar.getRawHeader(archive).headerString).digest('hex');

    assert.equal(calculateAsarHeaderSha256(archive), expected);
});

test('reads the packaged Electron fuse wire without modifying the executable', async () => {
    const executable = require('electron');
    const before = fs.statSync(executable);

    const result = await inspectElectronFuses(executable);

    const after = fs.statSync(executable);
    assert.equal(result.status, 'detected');
    assert.equal(result.version, '1');
    assert.match(result.embeddedAsarIntegrityValidation, /^(enabled|disabled|removed)$/);
    assert.match(result.onlyLoadAppFromAsar, /^(enabled|disabled|removed)$/);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
});

test('reports a missing Windows ElectronAsar integrity resource separately from ASAR file integrity', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-resource-'));
    const source = path.join(root, 'source');
    const archive = path.join(root, 'app.asar');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'package.json'), '{}');
    const stream = await asar.createPackage(source, archive);
    if (!stream.writableFinished) await finished(stream);

    const result = inspectWindowsAsarIntegrity(require('electron'), archive, 'resources/app.asar');

    assert.equal(result.status, 'absent');
    assert.equal(result.archiveHeaderSha256, calculateAsarHeaderSha256(archive));
    assert.equal(result.embeddedValue, null);
    assert.equal(result.matched, null);
});

test('distinguishes a matching embedded ElectronAsar resource from a stale one after repack', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-resource-match-'));
    const source = path.join(root, 'source');
    const archive = path.join(root, 'app.asar');
    const executablePath = path.join(root, 'Game.exe');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'package.json'), '{}');
    let stream = await asar.createPackage(source, archive);
    if (!stream.writableFinished) await finished(stream);

    const executable = NtExecutable.from(fs.readFileSync(process.execPath), { ignoreCert: true });
    const resources = NtExecutableResource.from(executable, true);
    resources.replaceResourceEntryFromString('INTEGRITY', 'ELECTRONASAR', 1033, JSON.stringify([{
        file: 'resources\\app.asar',
        alg: 'sha256',
        value: calculateAsarHeaderSha256(archive),
    }]));
    resources.outputResource(executable);
    fs.writeFileSync(executablePath, Buffer.from(executable.generate()));

    assert.equal(inspectWindowsAsarIntegrity(executablePath, archive, 'resources/app.asar').status, 'matched');

    fs.writeFileSync(path.join(source, 'package.json'), '{"changed":true}');
    fs.rmSync(archive);
    stream = await asar.createPackage(source, archive);
    if (!stream.writableFinished) await finished(stream);
    const stale = inspectWindowsAsarIntegrity(executablePath, archive, 'resources/app.asar');
    assert.equal(stale.status, 'mismatch');
    assert.equal(stale.matched, false);
});

test('normalizes Authenticode statuses without treating every signature problem as tampering', () => {
    assert.equal(normalizeAuthenticodeStatus('Valid'), 'valid');
    assert.equal(normalizeAuthenticodeStatus('NotSigned'), 'not-signed');
    assert.equal(normalizeAuthenticodeStatus('HashMismatch'), 'hash-mismatch');
    assert.equal(normalizeAuthenticodeStatus('NotTrusted'), 'not-trusted');
    assert.equal(normalizeAuthenticodeStatus('NotSupportedFileFormat'), 'unsupported-format');
    assert.equal(normalizeAuthenticodeStatus('Incompatible'), 'incompatible');
    assert.equal(normalizeAuthenticodeStatus('SomethingNew'), 'unknown');
});

test('inspects the Windows executable signature without modifying the file', () => {
    const executable = require('electron');
    const before = fs.statSync(executable);

    const result = inspectWindowsSignature(executable);

    const after = fs.statSync(executable);
    assert.match(result.status, /^(valid|not-signed|hash-mismatch|not-trusted|unsupported-format|incompatible|unknown|unavailable)$/);
    if (result.status !== 'unavailable') {
        assert.match(result.rawStatus, /^(Valid|UnknownError|NotSigned|HashMismatch|NotTrusted|NotSupportedFileFormat|Incompatible)$/);
    }
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
});

test('preserves non-ASCII executable paths when requesting Authenticode status', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), '서명-テスト-'));
    const executable = path.join(root, '게임.exe');
    fs.copyFileSync(process.execPath, executable);

    const result = inspectWindowsSignature(executable);

    assert.notEqual(result.status, 'unavailable', result.error);
    assert.match(result.rawStatus, /^(Valid|UnknownError|NotSigned|HashMismatch|NotTrusted|NotSupportedFileFormat|Incompatible)$/);
    if (result.statusMessage) assert.doesNotMatch(result.statusMessage, /\uFFFD/);
});

test('launch probe treats a process that stays alive through the observation window as bootable', async () => {
    const result = await runLaunchProbe(
        process.execPath,
        ['-e', 'setInterval(() => {}, 1000)'],
        { timeoutMs: 150 },
    );

    assert.equal(result.status, 'running');
    assert.equal(result.timedOut, true);
    assert.equal(result.terminatedByProbe, true);
    assert.equal(result.exitCode, null);
});

test('launch probe preserves an early non-zero exit as a failed boot signal', async () => {
    const result = await runLaunchProbe(process.execPath, ['-e', 'process.exit(7)'], { timeoutMs: 1000 });

    assert.equal(result.status, 'exited-error');
    assert.equal(result.timedOut, false);
    assert.equal(result.terminatedByProbe, false);
    assert.equal(result.exitCode, 7);
});

test('blocks repack only when the embedded ASAR integrity fuse enforces a non-matching hash', () => {
    assert.equal(isRuntimeIntegrityBlocked(
        { status: 'detected', embeddedAsarIntegrityValidation: 'enabled' },
        { status: 'mismatch' },
    ), true);
    assert.equal(isRuntimeIntegrityBlocked(
        { status: 'detected', embeddedAsarIntegrityValidation: 'enabled' },
        { status: 'matched' },
    ), false);
    assert.equal(isRuntimeIntegrityBlocked(
        { status: 'detected', embeddedAsarIntegrityValidation: 'disabled' },
        { status: 'mismatch' },
    ), false);
});

test('aggregates fuse, ASAR resource, and signature diagnostics for an Electron root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-aggregate-'));
    const source = path.join(root, 'source');
    const archive = path.join(root, 'app.asar');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'package.json'), '{}');
    const stream = await asar.createPackage(source, archive);
    if (!stream.writableFinished) await finished(stream);

    const electronRoot = path.dirname(require('electron'));
    const result = await inspectElectronRuntime(electronRoot, archive, 'resources/app.asar');

    assert.ok(result.executable);
    assert.ok(result.fuses);
    assert.ok(result.asarIntegrity);
    assert.ok(result.signature);
    assert.equal(typeof result.blocked, 'boolean');
    assert.match(result.risk, /^(low|warning|critical|unassessed)$/);
});
