const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { finished } = require('node:stream/promises');
const asar = require('@electron/asar');
const AdmZip = require('adm-zip');
const iconv = require('iconv-lite');
const { Pickle } = require(path.join(path.dirname(require.resolve('@electron/asar')), 'pickle.js'));

const { inspectContainer, extractContainer, packContainer, verifyContainerOutput, copyExternalResources } = require('../../.build/app/src/core/container.js');
const { scoreVerification, diffFileMaps, snapshotDirectory, inspectRpgProject, inspectWolfBinaryMappings, inspectTyranoProject } = require('../../.build/app/src/core/validator.js');
const { applyPatches } = require('../../.build/app/src/cli/patcher.js');
const { sha256Text } = require('../../.build/app/src/core/manifest.js');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-'));
}

function wolfMappingFixture() {
    const root = tempDir();
    const sourceFile = path.join(root, 'Map001.mps');
    const text = Buffer.from('hello\0', 'utf8');
    const bytes = Buffer.alloc(8 + 4 + text.length + 3, 0x2a);
    const pos1 = 8;
    const pos2 = pos1 + 4;
    const pos3 = pos2 + text.length;
    bytes.writeUInt32LE(text.length, pos1);
    text.copy(bytes, pos2);
    fs.writeFileSync(sourceFile, bytes);
    const hash = require('node:crypto').createHash('sha256').update('hello', 'utf8').digest('hex');
    const manifest = {
        schemaVersion: 1,
        format: 'wolf',
        entries: [{
            id: 'Map001.mps#0', sourceFile: 'Map001.mps', encoding: 'utf8', nullTerminated: true, hash,
            wolf: { pos1, pos2, pos3, len: text.length },
        }],
    };
    return { root, sourceFile, bytes, text, manifest, pos1, pos2, pos3 };
}

function rpgIntegrityFixture() {
    const data = tempDir();
    fs.mkdirSync(path.join(data, 'Extract'));
    fs.mkdirSync(path.join(data, 'Backup'));
    const actors = [null, { id: 1, name: 'Alice', classId: 1 }];
    const database = {
        'Actors.json': actors,
        'Classes.json': [null, { id: 1, name: 'Hero', learnings: [{ skillId: 1 }] }],
        'Skills.json': [null, { id: 1, name: 'Attack' }],
        'Enemies.json': [null, { id: 1, name: 'Slime', actions: [{ skillId: 1 }] }],
        'Troops.json': [null, { id: 1, name: 'Slime troop', members: [{ enemyId: 1 }] }],
        'CommonEvents.json': [null, { id: 1, name: 'Greeting', list: [] }],
        'MapInfos.json': [null, { id: 1, name: 'Start', parentId: 0 }],
        'Map001.json': { events: [null, { id: 1, pages: [{ list: [{ code: 117, parameters: [1] }] }] }] },
        'System.json': { startMapId: 1 },
    };
    for (const [name, value] of Object.entries(database)) {
        fs.writeFileSync(path.join(data, name), JSON.stringify(value));
    }
    fs.writeFileSync(path.join(data, 'Backup', 'Actors.json'), JSON.stringify(actors));
    fs.writeFileSync(path.join(data, 'Extract', 'Actors.txt'), 'Alice\n');
    const manifest = {
        schemaVersion: 1,
        format: 'rpgmv',
        entries: [{
            id: 'Actors.json#1.name', sourceFile: 'Backup/Actors.json', dataPath: '1.name',
            extractFile: 'Actors.txt', lineStart: 0, lineEnd: 1,
            hash: sha256Text('Alice'), encoding: 'utf8', nullTerminated: false,
            mv: { qpath: '', endLine: 1, originFile: 'Actors.json' },
        }],
    };
    return { data, manifest, database };
}

function addInvalidAsarEntry(sourceArchive, outputArchive) {
    const raw = asar.getRawHeader(sourceArchive);
    raw.header.files.decoy = { offset: 0, size: 1024 * 1024 * 1024 };
    const headerPickle = Pickle.createEmpty();
    headerPickle.writeString(JSON.stringify(raw.header));
    const headerBuffer = headerPickle.toBuffer();
    const sizePickle = Pickle.createEmpty();
    sizePickle.writeUInt32(headerBuffer.length);
    const sourceBuffer = fs.readFileSync(sourceArchive);
    const body = sourceBuffer.subarray(8 + raw.headerSize);
    fs.writeFileSync(outputArchive, Buffer.concat([sizePickle.toBuffer(), headerBuffer, body]));
}

function addEmptyAsarEntry(sourceArchive, outputArchive) {
    const raw = asar.getRawHeader(sourceArchive);
    raw.header.files[''] = { offset: 0, size: 0 };
    const headerPickle = Pickle.createEmpty();
    headerPickle.writeString(JSON.stringify(raw.header));
    const headerBuffer = headerPickle.toBuffer();
    const sizePickle = Pickle.createEmpty();
    sizePickle.writeUInt32(headerBuffer.length);
    const sourceBuffer = fs.readFileSync(sourceArchive);
    const body = sourceBuffer.subarray(8 + raw.headerSize);
    fs.writeFileSync(outputArchive, Buffer.concat([sizePickle.toBuffer(), headerBuffer, body]));
}

test('detects Electron ASAR and nested RPG Maker MZ project root', async () => {
    const root = tempDir();
    const appSource = path.join(root, 'app-source');
    const game = path.join(root, 'game');
    const resources = path.join(game, 'resources');
    const archive = path.join(resources, 'app.asar');

    fs.mkdirSync(path.join(appSource, 'project', 'data'), { recursive: true });
    fs.mkdirSync(path.join(appSource, 'project', 'js'), { recursive: true });
    fs.mkdirSync(resources, { recursive: true });
    fs.writeFileSync(path.join(appSource, 'package.json'), JSON.stringify({ main: 'src/main.js' }));
    fs.writeFileSync(path.join(appSource, 'project', 'index.html'), '<!doctype html>');
    fs.writeFileSync(path.join(appSource, 'project', 'data', 'Actors.json'), '[]');
    fs.writeFileSync(path.join(appSource, 'project', 'js', 'rmmz_core.js'), '/* MZ core */');

    await asar.createPackage(appSource, archive);
    const info = inspectContainer(game);

    assert.equal(info.type, 'electron-asar');
    assert.equal(info.archivePath, archive);
    assert.equal(info.engine.type, 'rpgmz');
    assert.equal(info.engine.root, 'project');
    assert.ok(info.archive.fileCount >= 4);
    assert.ok(info.archive.entries.includes('project/data/Actors.json'));
});

test('calculates weighted validation scores and blocks critical failures', () => {
    const healthy = scoreVerification({
        extractionCoverage: 100,
        mappingIntegrity: 100,
        reinsertionValidity: 100,
        protectedScriptIntegrity: 100,
        containerIntegrity: 80,
    });
    assert.equal(healthy.total, 98);
    assert.equal(healthy.risk, 'low');
    assert.equal(healthy.ok, true);

    const critical = scoreVerification({
        extractionCoverage: 100,
        mappingIntegrity: 100,
        reinsertionValidity: 100,
        protectedScriptIntegrity: 100,
        containerIntegrity: 100,
        critical: ['protected-script-parse'],
    });
    assert.equal(critical.total, 100);
    assert.equal(critical.ok, false);
    assert.equal(critical.risk, 'critical');
    assert.ok(critical.issues.includes('protected-script-parse'));
});

test('reports file and protected-script change magnitude separately', () => {
    const before = [
        { path: 'project/data/Actors.json', size: 100, hash: 'a', protected: false },
        { path: 'project/js/rmmz_core.js', size: 200, hash: 'b', protected: true },
    ];
    const after = [
        { path: 'project/data/Actors.json', size: 140, hash: 'c', protected: false },
        { path: 'project/js/rmmz_core.js', size: 201, hash: 'd', protected: true },
    ];

    const diff = diffFileMaps(before, after);
    assert.equal(diff.filesChanged, 2);
    assert.equal(diff.bytesChanged, 41);
    assert.equal(diff.protectedFilesChanged, 1);
    assert.equal(diff.protectedScriptDamage, 100);
});

test('round-trips an ASAR through staging without modifying the source archive', async () => {
    const root = tempDir();
    const work = tempDir();
    const source = path.join(root, 'source');
    const archive = path.join(root, 'resources', 'app.asar');
    const staging = path.join(work, 'staging');
    const outputRoot = path.join(work, 'out');
    const output = path.join(outputRoot, 'app.asar');
    fs.mkdirSync(path.join(source, 'project', 'data'), { recursive: true });
    fs.mkdirSync(path.join(source, 'project', 'js'), { recursive: true });
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.mkdirSync(path.join(root, 'resources', 'app.asar.unpacked'), { recursive: true });
    fs.writeFileSync(path.join(root, 'resources', 'app.asar.unpacked', 'native.bin'), 'native');
    fs.writeFileSync(path.join(root, 'resources', 'license.txt'), 'license');
    fs.writeFileSync(path.join(source, 'package.json'), '{}');
    fs.writeFileSync(path.join(source, 'project', 'data', 'Actors.json'), '[]');
    fs.writeFileSync(path.join(source, 'project', 'js', 'rmmz_core.js'), '');
    await asar.createPackage(source, archive);
    const before = require('node:crypto').createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    const info = inspectContainer(archive);
    assert.throws(() => inspectContainer(archive, { maxFiles: 1 }), /제한/);
    await assert.rejects(extractContainer(info, path.join(root, 'unsafe-staging')), /staging/);
    await extractContainer(info, staging);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    await assert.rejects(packContainer(info, staging, path.join(root, 'resources', 'new.asar')), /output|원본/);
    await packContainer(info, staging, output);
    copyExternalResources(info, outputRoot);
    assert.equal(fs.readFileSync(path.join(outputRoot, 'resources', 'app.asar.unpacked', 'native.bin'), 'utf8'), 'native');
    assert.equal(fs.readFileSync(path.join(outputRoot, 'resources', 'license.txt'), 'utf8'), 'license');
    const nested = path.join(root, 'resources', 'nested');
    const target = path.join(nested, 'target');
    fs.mkdirSync(target, { recursive: true });
    fs.symlinkSync(target, path.join(nested, 'link'), 'junction');
    assert.throws(() => copyExternalResources(info, path.join(work, 'linked-out')), /심볼릭/);
    const verified = verifyContainerOutput(output, ['package.json', 'project/data/Actors.json']);
    const after = require('node:crypto').createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    assert.equal(verified.type, 'electron-asar');
    assert.equal(after, before);
    assert.ok(verified.archive.fileCount >= 3);
});

test('rejects an ASAR external-resource link inserted during copy', async (t) => {
    const root = tempDir();
    const work = tempDir();
    const source = path.join(root, 'source');
    const resources = path.join(root, 'resources');
    const extras = path.join(resources, 'extras');
    const outside = path.join(root, 'outside');
    const archive = path.join(resources, 'app.asar');
    const outputRoot = path.join(work, 'output');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(extras, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), '{}');
    fs.writeFileSync(path.join(extras, 'asset.txt'), 'asset');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    await asar.createPackage(source, archive);
    const probe = path.join(extras, 'probe-link');
    try {
        fs.symlinkSync(outside, probe, process.platform === 'win32' ? 'junction' : 'dir');
        fs.rmSync(probe, { recursive: true, force: true });
    } catch (error) {
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }
    const info = inspectContainer(archive);
    const originalCopy = fs.cpSync;
    let injected = false;
    fs.cpSync = function patchedCopy(candidate, target, options) {
        if (!injected && path.resolve(String(candidate)) === path.resolve(extras)) {
            fs.symlinkSync(outside, path.join(extras, 'late-link'), process.platform === 'win32' ? 'junction' : 'dir');
            injected = true;
        }
        return originalCopy.call(fs, candidate, target, options);
    };
    try {
        assert.throws(() => copyExternalResources(info, outputRoot), /link|junction|symbolic|심볼릭|정션/i);
        assert.equal(injected, true);
        assert.equal(fs.existsSync(path.join(outputRoot, 'resources', 'extras', 'late-link')), false);
    } finally {
        fs.cpSync = originalCopy;
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('removes a newly-created staging directory when container extraction fails', async () => {
    const root = tempDir();
    const source = path.join(root, 'source');
    const staging = path.join(root, 'work', 'staging');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), '{}');
    const info = inspectContainer(source);
    fs.rmSync(source, { recursive: true, force: true });

    await assert.rejects(extractContainer(info, staging));
    assert.equal(fs.existsSync(staging), false);
});

test('removes a partial output when container packing fails', async () => {
    const root = tempDir();
    const source = path.join(root, 'source');
    const staging = path.join(root, 'staging');
    const output = path.join(root, 'out', 'packed');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), '{}');
    fs.writeFileSync(path.join(staging, 'package.json'), '{}');
    const info = inspectContainer(source);
    const packError = new Error('simulated container pack failure');
    const originalCopy = fs.cpSync;
    fs.cpSync = (from, to, options) => {
        if (path.resolve(from) === path.resolve(staging) && path.resolve(to) === path.resolve(output)) {
            fs.mkdirSync(to, { recursive: true });
            fs.writeFileSync(path.join(to, 'partial.txt'), 'partial');
            throw packError;
        }
        return originalCopy(from, to, options);
    };

    let thrown;
    try {
        await packContainer(info, staging, output);
    } catch (error) {
        thrown = error;
    } finally {
        fs.cpSync = originalCopy;
    }

    assert.equal(thrown, packError);
    assert.equal(fs.existsSync(output), false);
});

test('rejects a container output path reached through a junction', async (t) => {
    const root = tempDir();
    const source = path.join(root, 'source');
    const staging = path.join(root, 'staging');
    const redirectedParent = path.join(source, 'redirected-output');
    const outputLink = path.join(root, 'output-link');
    const redirectedOutput = path.join(redirectedParent, 'packed');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(staging, { recursive: true });
    fs.mkdirSync(redirectedParent, { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), '{}');
    fs.writeFileSync(path.join(staging, 'package.json'), '{}');
    try {
        fs.symlinkSync(redirectedParent, outputLink, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }

    try {
        const info = inspectContainer(source);
        await assert.rejects(packContainer(info, staging, path.join(outputLink, 'packed')), /link|junction|symbolic|심볼릭|정션/i);
        assert.equal(fs.existsSync(redirectedOutput), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('rejects a container source reached through an intermediate junction', (t) => {
    const root = tempDir();
    const realParent = path.join(root, 'real-parent');
    const source = path.join(realParent, 'source');
    const sourceLink = path.join(root, 'source-link');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), '{}');
    try {
        fs.symlinkSync(realParent, sourceLink, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }

    try {
        assert.throws(() => inspectContainer(path.join(sourceLink, 'source')), /link|junction|symbolic|심볼릭|정션/i);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('rejects linked entries in directory staging before packing', async (t) => {
    const root = tempDir();
    const work = tempDir();
    const source = path.join(root, 'source');
    const staging = path.join(work, 'staging');
    const outside = path.join(work, 'outside');
    const output = path.join(work, 'out', 'packed');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(staging, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), '{}');
    fs.writeFileSync(path.join(staging, 'package.json'), '{}');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    try {
        fs.symlinkSync(outside, path.join(staging, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }
    const originalCopy = fs.cpSync;
    let copyCalled = false;
    fs.cpSync = (...args) => {
        copyCalled = true;
        return originalCopy(...args);
    };

    try {
        const info = inspectContainer(source);
        await assert.rejects(packContainer(info, staging, output), /link|junction|symbolic|심볼릭|정션/i);
        assert.equal(copyCalled, false);
        assert.equal(fs.existsSync(output), false);
    } finally {
        fs.cpSync = originalCopy;
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('rechecks a directory source for links immediately before extraction', async (t) => {
    const root = tempDir();
    const work = tempDir();
    const source = path.join(root, 'source');
    const outside = path.join(root, 'outside');
    const staging = path.join(work, 'staging');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), '{}');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    const info = inspectContainer(source);
    try {
        fs.symlinkSync(outside, path.join(source, 'late-link'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }

    try {
        await assert.rejects(extractContainer(info, staging), /link|junction|symbolic|심볼릭|정션/i);
        assert.equal(fs.existsSync(staging), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('rejects a directory source link inserted during extraction copy', async (t) => {
    const root = tempDir();
    const work = tempDir();
    const source = path.join(root, 'source');
    const outside = path.join(root, 'outside');
    const staging = path.join(work, 'staging');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), '{}');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    const probe = path.join(source, 'probe-link');
    try {
        fs.symlinkSync(outside, probe, process.platform === 'win32' ? 'junction' : 'dir');
        fs.rmSync(probe, { recursive: true, force: true });
    } catch (error) {
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }
    const info = inspectContainer(source);
    const originalCopy = fs.cpSync;
    let injected = false;
    fs.cpSync = function patchedCopy(candidate, target, options) {
        if (!injected && path.resolve(String(candidate)) === path.resolve(source)) {
            fs.symlinkSync(outside, path.join(source, 'late-link'), process.platform === 'win32' ? 'junction' : 'dir');
            injected = true;
        }
        return originalCopy.call(fs, candidate, target, options);
    };
    try {
        await assert.rejects(extractContainer(info, staging), /link|junction|symbolic|심볼릭|정션/i);
        assert.equal(injected, true);
        assert.equal(fs.existsSync(staging), false);
    } finally {
        fs.cpSync = originalCopy;
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('rejects a directory staging link inserted during pack copy', async (t) => {
    const root = tempDir();
    const work = tempDir();
    const source = path.join(root, 'source');
    const staging = path.join(work, 'staging');
    const outside = path.join(work, 'outside');
    const output = path.join(work, 'output');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(staging, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), '{}');
    fs.writeFileSync(path.join(staging, 'package.json'), '{}');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    const probe = path.join(staging, 'probe-link');
    try {
        fs.symlinkSync(outside, probe, process.platform === 'win32' ? 'junction' : 'dir');
        fs.rmSync(probe, { recursive: true, force: true });
    } catch (error) {
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }
    const info = inspectContainer(source);
    const originalCopy = fs.cpSync;
    let injected = false;
    fs.cpSync = function patchedCopy(candidate, target, options) {
        if (!injected && path.resolve(String(candidate)) === path.resolve(staging)) {
            fs.symlinkSync(outside, path.join(staging, 'late-link'), process.platform === 'win32' ? 'junction' : 'dir');
            injected = true;
        }
        return originalCopy.call(fs, candidate, target, options);
    };
    try {
        await assert.rejects(packContainer(info, staging, output), /link|junction|symbolic|심볼릭|정션/i);
        assert.equal(injected, true);
        assert.equal(fs.existsSync(output), false);
    } finally {
        fs.cpSync = originalCopy;
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('refuses to overwrite an existing ASAR unpacked sidecar', async () => {
    const root = tempDir();
    const work = tempDir();
    const source = path.join(root, 'source');
    const archive = path.join(root, 'resources', 'app.asar');
    const staging = path.join(work, 'staging');
    const output = path.join(work, 'out', 'app.asar');
    const sidecar = output + '.unpacked';
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(staging, { recursive: true });
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.mkdirSync(sidecar, { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), '{}');
    fs.writeFileSync(path.join(staging, 'package.json'), '{}');
    fs.writeFileSync(path.join(sidecar, 'sentinel.txt'), 'preserve');
    await asar.createPackage(source, archive);

    const info = inspectContainer(archive);
    await assert.rejects(packContainer(info, staging, output), /이미 존재/);
    assert.equal(fs.existsSync(output), false);
    assert.equal(fs.readFileSync(path.join(sidecar, 'sentinel.txt'), 'utf8'), 'preserve');
});

test('preserves exact ASAR unpacked-file metadata while repacking', async () => {
    const root = tempDir();
    const work = tempDir();
    const source = path.join(root, 'source');
    const archive = path.join(root, 'resources', 'app.asar');
    const staging = path.join(work, 'staging');
    const output = path.join(work, 'output', 'app.asar');
    fs.mkdirSync(path.join(source, 'native'), { recursive: true });
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), '{}');
    fs.writeFileSync(path.join(source, 'native', 'addon.node'), 'native-addon');
    const stream = await asar.createPackageWithOptions(source, archive, { unpack: '*.node' });
    if (!stream.writableFinished) await finished(stream);

    const info = inspectContainer(archive);
    assert.deepEqual(info.archive.unpackedEntries, ['native/addon.node']);
    await extractContainer(info, staging);
    await packContainer(info, staging, output);

    const verified = inspectContainer(output);
    assert.deepEqual(verified.archive.unpackedEntries, ['native/addon.node']);
    assert.equal(asar.statFile(output, path.join('native', 'addon.node'), false).unpacked, true);
    assert.equal(fs.readFileSync(path.join(output + '.unpacked', 'native', 'addon.node'), 'utf8'), 'native-addon');
});

test('rejects an ASAR unpacked entry reached through a junction before extraction', async (t) => {
    const root = tempDir();
    const work = tempDir();
    const source = path.join(root, 'source');
    const archive = path.join(root, 'resources', 'app.asar');
    const staging = path.join(work, 'staging');
    const outside = path.join(root, 'outside-native');
    fs.mkdirSync(path.join(source, 'native'), { recursive: true });
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(source, 'package.json'), '{}');
    fs.writeFileSync(path.join(source, 'native', 'addon.node'), 'native-addon');
    const stream = await asar.createPackageWithOptions(source, archive, { unpack: '*.node' });
    if (!stream.writableFinished) await finished(stream);
    const unpackedNative = path.join(archive + '.unpacked', 'native');
    fs.rmSync(unpackedNative, { recursive: true, force: true });
    fs.writeFileSync(path.join(outside, 'addon.node'), 'outside-secret');
    try {
        fs.symlinkSync(outside, unpackedNative, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }

    try {
        const info = inspectContainer(archive);
        assert.ok(info.archive.unsafeLinkCount > 0);
        await assert.rejects(extractContainer(info, staging), /link|junction|symbolic|심볼릭|정션/i);
        assert.equal(fs.existsSync(staging), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('rechecks ASAR unpacked entries for junctions immediately before extraction', async (t) => {
    const root = tempDir();
    const work = tempDir();
    const source = path.join(root, 'source');
    const archive = path.join(root, 'resources', 'app.asar');
    const staging = path.join(work, 'staging');
    const outside = path.join(root, 'outside-native');
    fs.mkdirSync(path.join(source, 'native'), { recursive: true });
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(source, 'package.json'), '{}');
    fs.writeFileSync(path.join(source, 'native', 'addon.node'), 'native-addon');
    const stream = await asar.createPackageWithOptions(source, archive, { unpack: '*.node' });
    if (!stream.writableFinished) await finished(stream);
    const info = inspectContainer(archive);
    const unpackedNative = path.join(archive + '.unpacked', 'native');
    fs.rmSync(unpackedNative, { recursive: true, force: true });
    fs.writeFileSync(path.join(outside, 'addon.node'), 'outside-secret');
    try {
        fs.symlinkSync(outside, unpackedNative, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }

    try {
        await assert.rejects(extractContainer(info, staging), /link|junction|symbolic|심볼릭|정션/i);
        assert.equal(fs.existsSync(staging), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('rejects an ASAR archive changed after inspection before creating staging', async () => {
    const root = tempDir();
    const work = tempDir();
    const source = path.join(root, 'source');
    const archive = path.join(root, 'app.asar');
    const staging = path.join(work, 'staging');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), '{}');
    await asar.createPackage(source, archive);
    const info = inspectContainer(archive);
    fs.appendFileSync(archive, Buffer.from([0]));

    await assert.rejects(extractContainer(info, staging), /변경/);
    assert.equal(fs.existsSync(staging), false);
});

test('packs byte-identical NW.js ZIPs regardless of staging mtimes', async () => {
    const root = tempDir();
    const wrapper = path.join(root, 'game');
    const work = tempDir();
    const sourceArchive = path.join(wrapper, 'package.nw');
    const staging = path.join(work, 'staging');
    const first = path.join(work, 'first', 'package.nw');
    const second = path.join(work, 'second', 'package.nw');
    fs.mkdirSync(wrapper, { recursive: true });
    const sourceZip = new AdmZip();
    sourceZip.addFile('package.json', Buffer.from(JSON.stringify({ main: 'index.html' })));
    sourceZip.addFile('index.html', Buffer.from('<script src="data.js"></script>'));
    sourceZip.addFile('data.js', Buffer.from('gdjs.projectData = {"layouts":[]};\ngdjs.runtimeGameOptions = {};\n'));
    sourceZip.writeZip(sourceArchive);
    const info = inspectContainer(wrapper);
    await extractContainer(info, staging);
    for (const entry of fs.readdirSync(staging)) {
        fs.utimesSync(path.join(staging, entry), new Date(2022, 0, 1), new Date(2022, 0, 1));
    }
    await packContainer(info, staging, first);
    for (const entry of fs.readdirSync(staging)) {
        fs.utimesSync(path.join(staging, entry), new Date(2024, 0, 1), new Date(2024, 0, 1));
    }
    await packContainer(info, staging, second);
    const digest = (target) => require('node:crypto').createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    assert.equal(digest(first), digest(second));
    const entries = new AdmZip(first).getEntries();
    assert.ok(entries.every((entry) => entry.header.time.getFullYear() === 2000
        && entry.header.time.getMonth() === 0
        && entry.header.time.getDate() === 1));
    assert.deepEqual(entries.map((entry) => entry.entryName), [
        'data.js',
        'index.html',
        'package.json',
    ]);
});

test('snapshots source and output with protected runtime classification', () => {
    const root = tempDir();
    const beforeRoot = path.join(root, 'before');
    const afterRoot = path.join(root, 'after');
    fs.mkdirSync(path.join(beforeRoot, 'data'), { recursive: true });
    fs.mkdirSync(path.join(beforeRoot, 'js'), { recursive: true });
    fs.mkdirSync(path.join(afterRoot, 'data'), { recursive: true });
    fs.mkdirSync(path.join(afterRoot, 'js'), { recursive: true });
    fs.writeFileSync(path.join(beforeRoot, 'data', 'Actors.json'), 'original');
    fs.writeFileSync(path.join(afterRoot, 'data', 'Actors.json'), 'translated');
    fs.writeFileSync(path.join(beforeRoot, 'js', 'rmmz_core.js'), 'core');
    fs.writeFileSync(path.join(afterRoot, 'js', 'rmmz_core.js'), 'changed-core');
    const diff = diffFileMaps(snapshotDirectory(beforeRoot), snapshotDirectory(afterRoot));
    assert.equal(diff.filesChanged, 2);
    assert.ok(diff.textBytesChanged > 0);
    assert.equal(diff.protectedFilesChanged, 1);
    assert.equal(diff.protectedScriptDamage, 100);
});

test('separates Tyrano, GDevelop and NW.js wrapper diagnostics', () => {
    const root = tempDir();
    const tyrano = path.join(root, 'tyrano');
    fs.mkdirSync(path.join(tyrano, 'data', 'scenario'), { recursive: true });
    fs.writeFileSync(path.join(tyrano, 'data', 'scenario', 'first.ks'), '*start\nこんにちは');
    assert.equal(inspectContainer(tyrano).engine.type, 'tyrano');

    const gdevelop = path.join(root, 'gdevelop');
    fs.mkdirSync(path.join(gdevelop, 'gdjs'), { recursive: true });
    fs.writeFileSync(path.join(gdevelop, 'index.html'), '<script src="gdjs/runtime.js"></script>');
    fs.writeFileSync(path.join(gdevelop, 'gdjs', 'runtime.js'), '');
    assert.equal(inspectContainer(gdevelop).engine.type, 'gdevelop');

    const nw = path.join(root, 'nw');
    fs.mkdirSync(nw, { recursive: true });
    fs.writeFileSync(path.join(nw, 'package.json'), JSON.stringify({ main: 'index.html' }));
    fs.writeFileSync(path.join(nw, 'package.nw'), 'placeholder');
    assert.equal(inspectContainer(nw).type, 'nwjs-package');
});


test('enforces exact loose-directory file count limits', () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, 'one.json'), '{}');
    fs.writeFileSync(path.join(root, 'two.json'), '{}');
    assert.throws(() => snapshotDirectory(root, 1), /제한/);
    assert.throws(() => inspectContainer(root, { maxFiles: 1 }), /제한/);
});


test('rejects loose-directory symbolic links instead of silently skipping them', () => {
    const root = tempDir();
    const target = path.join(root, 'target');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'Actors.json'), '{}');
    fs.symlinkSync(target, path.join(root, 'linked'), 'junction');
    assert.throws(() => snapshotDirectory(root), /심볼릭/);
    assert.throws(() => inspectContainer(root), /심볼릭/);
});


test('rejects manifest extractFile traversal before patching', () => {
    const root = tempDir();
    const extractDir = path.join(root, 'Extract');
    const outside = path.join(root, 'outside.txt');
    fs.mkdirSync(extractDir);
    fs.writeFileSync(outside, 'original');
    const entry = { id: 'outside', extractFile: '../outside.txt', lineStart: 0, lineEnd: 1, hash: sha256Text('original') };
    fs.writeFileSync(path.join(extractDir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, format: 'rpgmv', entries: [entry] }));
    const patch = { id: entry.id, expectedHash: entry.hash, text: 'changed' };
    assert.throws(() => applyPatches(extractDir, 'rpgmv', [patch]), (error) => error?.code === 'E_MAPPING_CORRUPT');
    assert.equal(fs.readFileSync(outside, 'utf8'), 'original');
});


test('rejects manifest extractFile junctions before patching', (t) => {
    const root = tempDir();
    const extractDir = path.join(root, 'Extract');
    const outsideDir = path.join(root, 'outside');
    const outside = path.join(outsideDir, 'outside.txt');
    fs.mkdirSync(extractDir);
    fs.mkdirSync(outsideDir);
    fs.writeFileSync(outside, 'original');
    try {
        fs.symlinkSync(outsideDir, path.join(extractDir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }
    const entry = {
        id: 'linked',
        extractFile: 'linked/outside.txt',
        lineStart: 0,
        lineEnd: 1,
        hash: sha256Text('original'),
    };
    fs.writeFileSync(path.join(extractDir, 'manifest.json'), JSON.stringify({
        schemaVersion: 1,
        format: 'tyrano',
        entries: [entry],
    }));
    const patch = { id: entry.id, expectedHash: entry.hash, text: 'changed' };
    assert.throws(
        () => applyPatches(extractDir, 'tyrano', [patch]),
        (error) => error?.code === 'E_MAPPING_CORRUPT' && /link|junction|심볼릭|정션/i.test(error.message),
    );
    assert.equal(fs.readFileSync(outside, 'utf8'), 'original');
});


test('diagnoses malformed ASAR metadata and selectively extracts valid entries', async () => {
    const root = tempDir();
    const work = tempDir();
    const source = path.join(root, 'source');
    const cleanArchive = path.join(root, 'clean.asar');
    const archive = path.join(root, 'decoy.asar');
    const staging = path.join(work, 'staging');
    fs.mkdirSync(path.join(source, 'project', 'data'), { recursive: true });
    fs.mkdirSync(path.join(source, 'project', 'js'), { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), '{}');
    fs.writeFileSync(path.join(source, 'project', 'data', 'Actors.json'), '[]');
    fs.writeFileSync(path.join(source, 'project', 'js', 'rmmz_core.js'), '');
    await asar.createPackage(source, cleanArchive);
    addInvalidAsarEntry(cleanArchive, archive);
    const info = inspectContainer(archive);
    assert.equal(info.archive.invalidEntryCount, 1);
    assert.ok(info.engine.features.includes('asar-invalid-metadata'));
    await extractContainer(info, staging);
    assert.equal(fs.readFileSync(path.join(staging, 'project', 'data', 'Actors.json'), 'utf8'), '[]');
    assert.equal(fs.existsSync(path.join(staging, 'decoy')), false);
});

test('counts an empty ASAR header entry as invalid metadata', async () => {
    const root = tempDir();
    const source = path.join(root, 'source');
    const cleanArchive = path.join(root, 'clean.asar');
    const archive = path.join(root, 'empty-entry.asar');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), '{}');
    await asar.createPackage(source, cleanArchive);
    addEmptyAsarEntry(cleanArchive, archive);

    const info = inspectContainer(archive);
    assert.equal(info.archive.invalidEntryCount, 1);
    assert.ok(info.engine.features.includes('asar-invalid-metadata'));
});


test('reports and rejects ASAR symbolic links', async () => {
    const root = tempDir();
    const work = tempDir();
    const source = path.join(root, 'source');
    const target = path.join(source, 'target');
    const archive = path.join(root, 'linked.asar');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'Actors.json'), '{}');
    fs.symlinkSync(target, path.join(source, 'linked'), 'junction');
    await asar.createPackage(source, archive);
    const info = inspectContainer(archive);
    assert.equal(info.archive.unsafeLinkCount, 1);
    await assert.rejects(extractContainer(info, path.join(work, 'staging')), /링크/);
});

test('accepts an RPG project whose JSON roots, references, and manifest mapping agree', () => {
    const { data, manifest } = rpgIntegrityFixture();

    const report = inspectRpgProject(data, manifest);

    assert.equal(report.ok, true, JSON.stringify(report.issues));
    assert.equal(report.profile, 'rpgmv');
    assert.equal(report.entriesChecked, 1);
    assert.equal(report.validEntries, 1);
    assert.equal(report.invalidEntries, 0);
});

test('rejects RPG manifest extract and source files reached through junctions', (t) => {
    const { data, manifest } = rpgIntegrityFixture();
    const outside = tempDir();
    const outsideExtract = path.join(outside, 'extract');
    const outsideBackup = path.join(outside, 'backup');
    fs.mkdirSync(outsideExtract);
    fs.mkdirSync(outsideBackup);
    fs.writeFileSync(path.join(outsideExtract, 'Actors.txt'), 'Alice\n');
    fs.writeFileSync(path.join(outsideBackup, 'Actors.json'), JSON.stringify([null, { id: 1, name: 'Alice', classId: 1 }]));
    try {
        fs.symlinkSync(outsideExtract, path.join(data, 'Extract', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
        fs.symlinkSync(outsideBackup, path.join(data, 'linked-backup'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }
    manifest.entries[0].extractFile = 'linked/Actors.txt';
    manifest.entries[0].sourceFile = 'linked-backup/Actors.json';

    const report = inspectRpgProject(data, manifest);

    assert.equal(report.ok, false);
    assert.equal(report.invalidEntries, 1);
    assert.ok(report.issues.some((issue) => issue.code === 'RPG_EXTRACT_FILE_MISSING'));
    assert.ok(report.issues.some((issue) => issue.code === 'RPG_SOURCE_FILE_MISSING'));
});

test('rejects an RPG Backup baseline reached through a junction', (t) => {
    const data = tempDir();
    const outsideBackup = tempDir();
    fs.writeFileSync(path.join(outsideBackup, 'Actors.json'), JSON.stringify([null, { id: 1, name: 'Outside', classId: 0 }]));
    try {
        fs.symlinkSync(outsideBackup, path.join(data, 'Backup'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }

    const report = inspectRpgProject(data, { entries: [] });

    assert.equal(report.ok, false);
    assert.equal(report.filesChecked, 0);
    assert.ok(report.issues.some((issue) => issue.code === 'RPG_LINKED_PATH' && issue.file === 'Backup'));
});

test('reports missing RPG database and map references with their source paths', () => {
    const { data, manifest } = rpgIntegrityFixture();
    const actorsPath = path.join(data, 'Actors.json');
    const actors = JSON.parse(fs.readFileSync(actorsPath, 'utf8'));
    actors[1].classId = 99;
    fs.writeFileSync(actorsPath, JSON.stringify(actors));
    const mapInfosPath = path.join(data, 'MapInfos.json');
    const mapInfos = JSON.parse(fs.readFileSync(mapInfosPath, 'utf8'));
    mapInfos.push({ id: 2, name: 'Missing', parentId: 0 });
    fs.writeFileSync(mapInfosPath, JSON.stringify(mapInfos));

    const report = inspectRpgProject(data, manifest);

    assert.equal(report.ok, false);
    assert.ok(report.issues.some((issue) => issue.code === 'RPG_REFERENCE_MISSING' && issue.file === 'Actors.json' && issue.entryId === '1.classId'));
    assert.ok(report.issues.some((issue) => issue.code === 'RPG_MAP_FILE_MISSING' && issue.file === 'MapInfos.json' && issue.entryId === '2'));
});

test('downgrades an RPG reference already present in Backup to a baseline warning', () => {
    const { data, manifest } = rpgIntegrityFixture();
    const mapInfosPath = path.join(data, 'MapInfos.json');
    const mapInfos = JSON.parse(fs.readFileSync(mapInfosPath, 'utf8'));
    mapInfos.push({ id: 2, name: 'Originally missing', parentId: 0 });
    fs.writeFileSync(mapInfosPath, JSON.stringify(mapInfos));
    fs.writeFileSync(path.join(data, 'Backup', 'MapInfos.json'), JSON.stringify(mapInfos));

    const report = inspectRpgProject(data, manifest);

    assert.equal(report.ok, true, JSON.stringify(report.issues));
    assert.ok(report.issues.some((issue) => issue.code === 'RPG_MAP_FILE_MISSING_BASELINE'
        && issue.severity === 'warning' && issue.file === 'MapInfos.json' && issue.entryId === '2'));
    assert.equal(report.issues.some((issue) => issue.code === 'RPG_MAP_FILE_MISSING'), false);
});

test('keeps an RPG reference introduced after Backup as a blocking error', () => {
    const { data, manifest } = rpgIntegrityFixture();
    fs.writeFileSync(path.join(data, 'Backup', 'MapInfos.json'), fs.readFileSync(path.join(data, 'MapInfos.json')));
    const mapInfosPath = path.join(data, 'MapInfos.json');
    const mapInfos = JSON.parse(fs.readFileSync(mapInfosPath, 'utf8'));
    mapInfos.push({ id: 2, name: 'Newly missing', parentId: 0 });
    fs.writeFileSync(mapInfosPath, JSON.stringify(mapInfos));

    const report = inspectRpgProject(data, manifest);

    assert.equal(report.ok, false);
    assert.ok(report.issues.some((issue) => issue.code === 'RPG_MAP_FILE_MISSING'
        && issue.severity === 'error' && issue.file === 'MapInfos.json' && issue.entryId === '2'));
    assert.equal(report.issues.some((issue) => issue.code === 'RPG_MAP_FILE_MISSING_BASELINE'), false);
});

test('rejects an RPG manifest entry when extracted text no longer matches its hash', () => {
    const { data, manifest } = rpgIntegrityFixture();
    fs.writeFileSync(path.join(data, 'Extract', 'Actors.txt'), 'Mallory\n');

    const report = inspectRpgProject(data, manifest);

    assert.equal(report.ok, false);
    assert.equal(report.invalidEntries, 1);
    assert.ok(report.issues.some((issue) => issue.code === 'RPG_EXTRACT_HASH_MISMATCH'));
});

test('reports malformed RPG JSON before reinsertion', () => {
    const { data, manifest } = rpgIntegrityFixture();
    fs.writeFileSync(path.join(data, 'Map001.json'), '{ broken');

    const report = inspectRpgProject(data, manifest);

    assert.equal(report.ok, false);
    assert.ok(report.issues.some((issue) => issue.code === 'RPG_JSON_PARSE_ERROR' && issue.file === 'Map001.json'));
});

test('accepts a Wolf manifest entry whose offsets, length, bytes, hash, and null terminator agree', () => {
    const { root, manifest } = wolfMappingFixture();

    const report = inspectWolfBinaryMappings(root, manifest);

    assert.equal(report.ok, true);
    assert.equal(report.entriesChecked, 1);
    assert.equal(report.validEntries, 1);
    assert.equal(report.invalidEntries, 0);
    assert.deepEqual(report.issues, []);
});

test('rejects a Wolf manifest source file reached through a junction', (t) => {
    const { root, sourceFile, manifest } = wolfMappingFixture();
    const outside = tempDir();
    const outsideSource = path.join(outside, 'Map001.mps');
    fs.renameSync(sourceFile, outsideSource);
    try {
        fs.symlinkSync(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }
    manifest.entries[0].sourceFile = 'linked/Map001.mps';

    const report = inspectWolfBinaryMappings(root, manifest);

    assert.equal(report.ok, false);
    assert.equal(report.invalidEntries, 1);
    assert.ok(report.issues.some((issue) => issue.code === 'WOLF_SOURCE_MISSING'));
});

test('rejects a Wolf mapping when the binary length prefix no longer matches the manifest', () => {
    const { root, sourceFile, bytes, text, manifest, pos1 } = wolfMappingFixture();
    bytes.writeUInt32LE(text.length + 1, pos1);
    fs.writeFileSync(sourceFile, bytes);

    const report = inspectWolfBinaryMappings(root, manifest);

    assert.equal(report.ok, false);
    assert.equal(report.validEntries, 0);
    assert.equal(report.invalidEntries, 1);
    assert.ok(report.issues.some((issue) => issue.code === 'WOLF_LENGTH_PREFIX_MISMATCH'));
});

test('rejects a Wolf mapping whose declared string interval escapes the source file', () => {
    const { root, bytes, manifest } = wolfMappingFixture();
    manifest.entries[0].wolf.pos3 = bytes.length + 1;

    const report = inspectWolfBinaryMappings(root, manifest);

    assert.equal(report.ok, false);
    assert.ok(report.issues.some((issue) => issue.code === 'WOLF_OFFSET_INVALID'));
});

test('rejects a null-terminated Wolf mapping when the source terminator is missing', () => {
    const { root, sourceFile, bytes, manifest, pos3 } = wolfMappingFixture();
    bytes[pos3 - 1] = 0x21;
    fs.writeFileSync(sourceFile, bytes);

    const report = inspectWolfBinaryMappings(root, manifest);

    assert.equal(report.ok, false);
    assert.ok(report.issues.some((issue) => issue.code === 'WOLF_NULL_TERMINATOR_MISSING'));
});

test('rejects a Wolf mapping when decoded source text no longer matches the manifest hash', () => {
    const { root, manifest } = wolfMappingFixture();
    manifest.entries[0].hash = '0'.repeat(64);

    const report = inspectWolfBinaryMappings(root, manifest);

    assert.equal(report.ok, false);
    assert.ok(report.issues.some((issue) => issue.code === 'WOLF_SOURCE_HASH_MISMATCH'));
});

test('validates a Shift_JIS Wolf mapping using its manifest encoding', () => {
    const root = tempDir();
    const sourceFile = path.join(root, 'Map002.mps');
    const text = iconv.encode('こんにちは\0', 'shift_jis');
    const pos1 = 4;
    const pos2 = 8;
    const pos3 = pos2 + text.length;
    const bytes = Buffer.alloc(pos3);
    bytes.writeUInt32LE(text.length, pos1);
    text.copy(bytes, pos2);
    fs.writeFileSync(sourceFile, bytes);
    const hash = require('node:crypto').createHash('sha256').update('こんにちは', 'utf8').digest('hex');
    const manifest = { format: 'wolf', entries: [{
        id: 'Map002.mps#0', sourceFile: 'Map002.mps', encoding: 'shift_jis', nullTerminated: true, hash,
        wolf: { pos1, pos2, pos3, len: text.length },
    }] };

    const report = inspectWolfBinaryMappings(root, manifest);

    assert.equal(report.ok, true, JSON.stringify(report.issues));
    assert.equal(report.encodingWarnings, 0);
});

test('accepts balanced Tyrano KS control tags and TJS delimiters', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'data', 'scenario'), { recursive: true });
    fs.mkdirSync(path.join(root, 'data', 'system'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data', 'scenario', 'first.ks'), [
        '*start',
        '[if exp="f.flag"]',
        'こんにちは',
        '[endif]',
        '[iscript]',
        'const obj = { values: [1, 2, 3] };',
        '[endscript]',
    ].join('\n'));
    fs.writeFileSync(path.join(root, 'data', 'system', 'Config.tjs'), 'function setup() { return { ok: true }; }\n');

    const report = inspectTyranoProject(root);

    assert.equal(report.ok, true, JSON.stringify(report.issues));
    assert.equal(report.profile, 'tyrano');
    assert.equal(report.filesChecked, 2);
    assert.equal(report.tokenErrors, 0);
});

test('rejects a linked Tyrano scenario path instead of silently skipping it', (t) => {
    const root = tempDir();
    const scenario = path.join(root, 'data', 'scenario');
    const outside = tempDir();
    fs.mkdirSync(scenario, { recursive: true });
    fs.writeFileSync(path.join(outside, 'outside.ks'), '*start\n외부 대사');
    try {
        fs.symlinkSync(outside, path.join(scenario, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }

    const report = inspectTyranoProject(root);

    assert.equal(report.ok, false);
    assert.equal(report.invalidEntries, 1);
    assert.ok(report.issues.some((issue) => issue.code === 'TYRANO_LINKED_PATH'));
});

test('reports an unterminated Tyrano KS tag with its source position', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'data', 'scenario'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data', 'scenario', 'broken.ks'), '*start\n[if exp="f.flag"\n본문');

    const report = inspectTyranoProject(root);

    assert.equal(report.ok, false);
    assert.equal(report.invalidEntries, 1);
    assert.equal(report.tokenErrors, 1);
    const issue = report.issues.find((item) => item.code === 'TYRANO_KS_UNTERMINATED_TAG');
    assert.ok(issue);
    assert.equal(issue.line, 2);
    assert.equal(issue.column, 1);
});

test('reports an unclosed Tyrano KS control block', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'data', 'scenario'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data', 'scenario', 'branch.ks'), '[if exp="true"]\n본문');

    const report = inspectTyranoProject(root);

    assert.equal(report.ok, false);
    const issue = report.issues.find((item) => item.code === 'TYRANO_KS_UNCLOSED_BLOCK');
    assert.ok(issue);
    assert.equal(issue.line, 1);
    assert.match(issue.message, /if.*endif/i);
});

test('reports an unclosed Tyrano TJS delimiter while ignoring strings and comments', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'data', 'system'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data', 'system', 'Config.tjs'), [
        'const ignored = "[ not syntax ]";',
        '// } ignored closer',
        'function setup() {',
        '    return { ok: true };',
    ].join('\n'));

    const report = inspectTyranoProject(root);

    assert.equal(report.ok, false);
    const issue = report.issues.find((item) => item.code === 'TYRANO_TJS_UNCLOSED_DELIMITER');
    assert.ok(issue);
    assert.equal(issue.line, 3);
    assert.match(issue.message, /\{.*\}/);
});

test('reports an unterminated Tyrano TJS string at its opening quote', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'data', 'system'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data', 'system', 'Config.tjs'), 'const broken = "unterminated');

    const report = inspectTyranoProject(root);

    assert.equal(report.ok, false);
    const issue = report.issues.find((item) => item.code === 'TYRANO_TJS_UNTERMINATED_STRING');
    assert.ok(issue);
    assert.equal(issue.line, 1);
    assert.equal(issue.column, 16);
});

test('detects Shift_JIS Tyrano scenario files without an encoding warning', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'data', 'scenario'), { recursive: true });
    fs.writeFileSync(
        path.join(root, 'data', 'scenario', 'shift-jis.ks'),
        iconv.encode('[if exp="true"]\nこんにちは\n[endif]\n', 'shift_jis'),
    );

    const report = inspectTyranoProject(root);

    assert.equal(report.ok, true, JSON.stringify(report.issues));
    assert.equal(report.encodingCounts.shiftJis, 1);
    assert.equal(report.encodingWarnings, 0);
});

test('warns when a Tyrano text file is neither valid UTF-8 nor round-trip Shift_JIS', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'data', 'scenario'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data', 'scenario', 'unknown.ks'), Buffer.from([0x81]));

    const report = inspectTyranoProject(root);

    assert.equal(report.ok, true);
    assert.equal(report.encodingCounts.unknown, 1);
    assert.equal(report.encodingWarnings, 1);
    assert.ok(report.issues.some((item) => item.code === 'TYRANO_ENCODING_UNCERTAIN'));
});
