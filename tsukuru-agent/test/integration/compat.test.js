const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    inspectContainer,
    extractContainer,
    packContainer,
    verifyContainerOutput,
} = require('../../.build/app/src/core/container.js');
const { GDevelopService } = require('../../.build/app/src/js/gdevelop/GDevelopService.js');
const { applyPatches } = require('../../.build/app/src/cli/patcher.js');
const { runAgent } = require('../../.build/app/src/cli/run.js');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-compat-'));
}

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function writeStoredZip(outputPath, files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const [name, value] of Object.entries(files)) {
        const nameBytes = Buffer.from(name, 'utf8');
        const data = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
        const checksum = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(0, 8);
        local.writeUInt32LE(checksum, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBytes.length, 26);
        localParts.push(local, nameBytes, data);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(0x0314, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(0, 10);
        central.writeUInt32LE(checksum, 16);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBytes.length, 28);
        central.writeUInt32LE(offset, 42);
        centralParts.push(central, nameBytes);
        offset += local.length + nameBytes.length + data.length;
    }
    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Object.keys(files).length, 8);
    end.writeUInt16LE(Object.keys(files).length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    fs.writeFileSync(outputPath, Buffer.concat([...localParts, ...centralParts, end]));
}

function writePeAppendedZip(outputPath, files, { signed = false } = {}) {
    const zipPath = `${outputPath}.zip-part`;
    writeStoredZip(zipPath, files);
    const prefix = Buffer.alloc(512);
    prefix.write('MZ', 0, 'ascii');
    prefix.writeUInt32LE(0x80, 0x3c);
    prefix.write('PE\0\0', 0x80, 'binary');
    prefix.writeUInt16LE(0x14c, 0x84);
    prefix.writeUInt16LE(0, 0x86);
    prefix.writeUInt16LE(0xe0, 0x94);
    prefix.writeUInt16LE(0x010f, 0x96);
    const optionalHeader = 0x98;
    prefix.writeUInt16LE(0x10b, optionalHeader);
    prefix.writeUInt32LE(16, optionalHeader + 92);
    if (signed) {
        prefix.writeUInt32LE(0x1c0, optionalHeader + 96 + (4 * 8));
        prefix.writeUInt32LE(0x20, optionalHeader + 96 + (4 * 8) + 4);
        prefix.fill(0xa5, 0x1c0, 0x1e0);
    }
    fs.writeFileSync(outputPath, Buffer.concat([prefix, fs.readFileSync(zipPath)]));
    fs.rmSync(zipPath, { force: true });
    return prefix;
}

function readGDevelopProjectData(dataFile) {
    const source = fs.readFileSync(dataFile, 'utf8');
    const marker = 'gdjs.projectData = ';
    const start = source.indexOf(marker) + marker.length;
    const end = source.indexOf(';\ngdjs.runtimeGameOptions', start);
    return JSON.parse(source.slice(start, end));
}

test('inspects, safely extracts, repacks, and verifies a package.nw archive', async () => {
    const root = tempDir();
    const wrapper = path.join(root, 'game');
    const work = path.join(root, 'work');
    const staging = path.join(work, 'staging');
    const output = path.join(work, 'translated', 'package.nw');
    const archive = path.join(wrapper, 'package.nw');
    fs.mkdirSync(wrapper, { recursive: true });
    writeStoredZip(archive, {
        'package.json': JSON.stringify({ name: 'fixture', main: 'index.html' }),
        'index.html': '<script src="gdjs/runtime.js"></script>',
        'gdjs/runtime.js': '/* protected runtime */',
        'data/game.json': JSON.stringify({ title: 'Fixture' }),
    });
    const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');

    const info = inspectContainer(wrapper);

    assert.equal(info.type, 'nwjs-package');
    assert.equal(info.packagePath, archive);
    assert.ok(info.archive);
    assert.ok(info.archive.entries.includes('package.json'));
    assert.equal(info.engine.type, 'gdevelop');
    assert.equal(info.engine.wrapper, 'nwjs');

    await extractContainer(info, staging);
    assert.equal(fs.readFileSync(path.join(staging, 'package.json'), 'utf8'), JSON.stringify({ name: 'fixture', main: 'index.html' }));
    await packContainer(info, staging, output);

    const verified = verifyContainerOutput(output, ['package.json', 'gdjs/runtime.js', 'data/game.json']);
    assert.equal(verified.type, 'nwjs-package');
    assert.equal(verified.engine.type, 'gdevelop');
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), sourceHash);
});

test('rejects a package.nw archive changed after inspection before creating staging', async () => {
    const root = tempDir();
    const wrapper = path.join(root, 'game');
    const work = tempDir();
    const archive = path.join(wrapper, 'package.nw');
    const staging = path.join(work, 'staging');
    fs.mkdirSync(wrapper, { recursive: true });
    writeStoredZip(archive, {
        'package.json': JSON.stringify({ main: 'index.html' }),
        'index.html': '<html></html>',
    });
    const info = inspectContainer(wrapper);
    fs.appendFileSync(archive, Buffer.from([0]));

    await assert.rejects(extractContainer(info, staging), /변경/);
    assert.equal(fs.existsSync(staging), false);
});

test('rejects package.nw path traversal before creating a staging directory', async () => {
    const root = tempDir();
    const wrapper = path.join(root, 'game');
    const archive = path.join(wrapper, 'package.nw');
    const staging = path.join(root, 'work', 'staging');
    fs.mkdirSync(wrapper, { recursive: true });
    writeStoredZip(archive, {
        'package.json': JSON.stringify({ main: 'index.html' }),
        '../escaped.txt': 'must not escape',
    });

    const info = inspectContainer(wrapper);
    assert.equal(info.archive.invalidEntryCount, 1);
    assert.ok(info.archive.invalidEntries.includes('../escaped.txt'));
    await assert.rejects(extractContainer(info, staging), /안전하지 않은 package\.nw/);
    assert.equal(fs.existsSync(path.join(root, 'work')), false);
    assert.equal(fs.existsSync(path.join(root, 'escaped.txt')), false);
});

test('extracts only static GDevelop text objects from the projectData assignment', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'gdjs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), '<script src="gdjs/runtime.js"></script><script src="data.js"></script>');
    fs.writeFileSync(path.join(root, 'gdjs', 'runtime.js'), '/* protected runtime */');
    const projectData = {
        firstLayout: 'Scene',
        objects: [{ type: 'TextObject::Text', name: 'GlobalLabel', string: 'Global hello' }],
        layouts: [{
            name: 'Scene',
            objects: [
                { type: 'TextObject::Text', name: 'Dialogue', string: 'Hello\nWorld' },
                { type: 'Sprite', name: 'DoNotTranslate', string: 'asset-key' },
            ],
        }],
    };
    fs.writeFileSync(
        path.join(root, 'data.js'),
        `gdjs.projectData = ${JSON.stringify(projectData)};\ngdjs.runtimeGameOptions = { keep: true };\n`,
    );

    const report = new GDevelopService().extract({ projectRoot: root });

    assert.equal(report.extractedEntries, 2);
    assert.equal(report.extractedFiles, 1);
    const manifest = JSON.parse(fs.readFileSync(report.manifestPath, 'utf8'));
    assert.equal(manifest.format, 'gdevelop');
    assert.deepEqual(
        manifest.entries.map((entry) => entry.dataPath),
        ['/objects/0/string', '/layouts/0/objects/0/string'],
    );
    assert.ok(manifest.entries.every((entry) => entry.gdevelop.objectType === 'TextObject::Text'));
    assert.equal(
        fs.readFileSync(path.join(report.extractDir, 'gdevelop-text.txt'), 'utf8'),
        'Global hello\nHello\nWorld',
    );
    assert.equal(fs.readFileSync(path.join(root, 'gdjs', 'runtime.js'), 'utf8'), '/* protected runtime */');
});

test('GDevelop force extract restores the previous workspace when commit fails', () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, 'data.js'), `gdjs.projectData = ${JSON.stringify({
        layouts: [{ name: 'Scene', objects: [{ type: 'TextObject::Text', string: 'Old text' }] }],
    })};\n`);
    const service = new GDevelopService();
    const first = service.extract({ projectRoot: root });
    const sentinel = path.join(first.extractDir, 'keep.txt');
    fs.writeFileSync(sentinel, 'old workspace');
    const oldManifest = fs.readFileSync(first.manifestPath);
    fs.writeFileSync(path.join(root, 'data.js'), `gdjs.projectData = ${JSON.stringify({
        layouts: [{ name: 'Scene', objects: [{ type: 'TextObject::Text', string: 'New text' }] }],
    })};\n`);
    const originalRename = fs.renameSync;
    fs.renameSync = (source, destination) => {
        if (path.resolve(destination) === path.resolve(first.extractDir)
            && path.basename(source).includes('.tsukuru-stage-')) {
            throw new Error('simulated GDevelop extract commit failure');
        }
        return originalRename(source, destination);
    };
    try {
        assert.throws(
            () => service.extract({ projectRoot: root, force: true }),
            /simulated GDevelop extract commit failure/,
        );
    } finally {
        fs.renameSync = originalRename;
    }
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'old workspace');
    assert.deepEqual(fs.readFileSync(first.manifestPath), oldManifest);
    assert.deepEqual(
        fs.readdirSync(root).filter((name) => /\.tsukuru-(stage|backup)-/.test(name)),
        [],
    );
});

test('rejects GDevelop data.js reached through a junction', (t) => {
    const root = tempDir();
    const outside = tempDir();
    fs.writeFileSync(
        path.join(outside, 'data.js'),
        `gdjs.projectData = ${JSON.stringify({
            layouts: [{ name: 'Scene', objects: [{ type: 'TextObject::Text', string: 'Outside' }] }],
        })};\n`,
    );
    try {
        fs.symlinkSync(outside, path.join(root, 'www'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }

    assert.throws(
        () => new GDevelopService().extract({ projectRoot: root }),
        (error) => error?.code === 'E_MAPPING_CORRUPT',
    );
    assert.equal(fs.existsSync(path.join(root, '_Extract')), false);
});

test('rejects GDevelop code files reached through a junction in the opt-in profile', (t) => {
    const root = tempDir();
    const outside = tempDir();
    fs.mkdirSync(path.join(root, 'gdjs'));
    fs.writeFileSync(path.join(root, 'index.html'), '<script src="gdjs/runtime.js"></script><script src="data.js"></script>');
    fs.writeFileSync(path.join(root, 'gdjs', 'runtime.js'), '/* protected runtime */');
    fs.writeFileSync(path.join(root, 'data.js'), `gdjs.projectData = ${JSON.stringify({
        layouts: [{ name: 'Scene', objects: [{ type: 'TextObject::Text', string: 'Hello' }] }],
    })};\n`);
    fs.writeFileSync(path.join(outside, 'code0.js'), 'object.setString("Outside code");');
    try {
        fs.symlinkSync(outside, path.join(root, 'linked-code'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }

    assert.throws(
        () => new GDevelopService().extract({ projectRoot: root, experimentalGdevelopCodeStrings: true }),
        (error) => error?.code === 'E_MAPPING_CORRUPT' && /link|junction|심볼릭|정션/i.test(error.message),
    );
    assert.equal(fs.existsSync(path.join(root, '_Extract')), false);
});

test('patches and applies GDevelop text to a validated copy without changing generated runtime files', () => {
    const root = tempDir();
    const game = path.join(root, 'game');
    const output = path.join(root, 'translated');
    const dataFile = path.join(game, 'data.js');
    const runtimeFile = path.join(game, 'gdjs', 'runtime.js');
    fs.mkdirSync(path.dirname(runtimeFile), { recursive: true });
    fs.writeFileSync(path.join(game, 'index.html'), '<script src="gdjs/runtime.js"></script><script src="data.js"></script>');
    fs.writeFileSync(runtimeFile, '/* protected runtime */');
    fs.writeFileSync(dataFile, `gdjs.projectData = ${JSON.stringify({
        firstLayout: 'Scene',
        layouts: [{ name: 'Scene', objects: [{ type: 'TextObject::Text', name: 'Dialogue', string: 'Hello' }] }],
    })};\ngdjs.runtimeGameOptions = { keep: true };\n`);
    const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(dataFile)).digest('hex');
    const runtimeHash = crypto.createHash('sha256').update(fs.readFileSync(runtimeFile)).digest('hex');
    const service = new GDevelopService();
    const extracted = service.extract({ projectRoot: game });
    const manifest = JSON.parse(fs.readFileSync(extracted.manifestPath, 'utf8'));
    const entry = manifest.entries[0];

    const patch = applyPatches(extracted.extractDir, 'gdevelop', [{
        id: entry.id,
        expectedHash: entry.hash,
        text: '안녕하세요',
    }]);
    const applied = service.applyToCopy({ projectRoot: game, outputRoot: output });

    assert.deepEqual(patch, { patched: 1, files: 1 });
    assert.equal(applied.appliedEntries, 1);
    assert.equal(applied.validation.ok, true, JSON.stringify(applied.validation.issues));
    assert.equal(applied.validation.profile, 'gdevelop');
    assert.equal(readGDevelopProjectData(path.join(output, 'data.js')).layouts[0].objects[0].string, '안녕하세요');
    assert.match(fs.readFileSync(path.join(output, 'data.js'), 'utf8'), /gdjs\.runtimeGameOptions = \{ keep: true \}/);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(dataFile)).digest('hex'), sourceHash);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(runtimeFile)).digest('hex'), runtimeHash);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(output, 'gdjs', 'runtime.js'))).digest('hex'), runtimeHash);
    assert.equal(fs.existsSync(path.join(output, '_Extract')), false);
});

test('rejects a GDevelop extraction workspace reached through a junction before apply', (t) => {
    const root = tempDir();
    const game = path.join(root, 'game');
    const output = path.join(root, 'translated');
    fs.mkdirSync(path.join(game, 'gdjs'), { recursive: true });
    fs.writeFileSync(path.join(game, 'index.html'), '<script src="gdjs/runtime.js"></script><script src="data.js"></script>');
    fs.writeFileSync(path.join(game, 'gdjs', 'runtime.js'), '/* protected runtime */');
    fs.writeFileSync(path.join(game, 'data.js'), `gdjs.projectData = ${JSON.stringify({
        layouts: [{ name: 'Scene', objects: [{ type: 'TextObject::Text', string: 'Hello' }] }],
    })};\n`);
    const service = new GDevelopService();
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
});

test('rejects an unrelated GDevelop source junction before copy publication', (t) => {
    const root = tempDir();
    const game = path.join(root, 'game');
    const output = path.join(root, 'translated');
    const outside = path.join(root, 'outside-assets');
    fs.mkdirSync(path.join(game, 'gdjs'), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(game, 'index.html'), '<script src="gdjs/runtime.js"></script><script src="data.js"></script>');
    fs.writeFileSync(path.join(game, 'gdjs', 'runtime.js'), '/* protected runtime */');
    fs.writeFileSync(path.join(game, 'data.js'), `gdjs.projectData = ${JSON.stringify({
        layouts: [{ name: 'Scene', objects: [{ type: 'TextObject::Text', string: 'Hello' }] }],
    })};\n`);
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    const service = new GDevelopService();
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
    assert.equal(fs.readdirSync(root).some((name) => name.includes('gdevelop-staging')), false);
});

test('runs the loose GDevelop extract, patch, verify, and copy-only apply pipeline through the agent CLI', async () => {
    const root = tempDir();
    const game = path.join(root, 'game');
    const output = path.join(root, 'translated');
    const blockedOutput = path.join(root, 'translated-without-code-opt-in');
    fs.mkdirSync(path.join(game, 'gdjs'), { recursive: true });
    fs.writeFileSync(path.join(game, 'index.html'), '<script src="gdjs/runtime.js"></script><script src="code0.js"></script><script src="data.js"></script>');
    fs.writeFileSync(path.join(game, 'gdjs', 'runtime.js'), '/* protected runtime */');
    fs.writeFileSync(path.join(game, 'data.js'), `gdjs.projectData = ${JSON.stringify({
        layouts: [{ name: 'Scene', objects: [{ type: 'TextObject::Text', name: 'Dialogue', string: 'Hello' }] }],
    })};\ngdjs.runtimeGameOptions = {};\n`);
    fs.writeFileSync(
        path.join(game, 'code0.js'),
        'for (var i = 0; i < gdjs.SceneCode.GDDialogueObjects1.length; ++i) { gdjs.SceneCode.GDDialogueObjects1[i].setString("Code hello"); }',
    );
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

    let response = await invoke('extract', request('extract', {
        options: { experimentalGdevelopCodeStrings: true },
    }));
    assert.equal(response.status, 0, JSON.stringify(response.result));
    assert.equal(response.result.format, 'gdevelop');
    assert.equal(response.result.stats.entries, 2);
    assert.equal(response.result.stats.codeEntries, 1);
    const manifestPath = path.join(game, '_Extract', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const dataEntry = manifest.entries.find((entry) => entry.gdevelop?.kind === 'project-data');
    const codeEntry = manifest.entries.find((entry) => entry.gdevelop?.kind === 'code-literal');

    response = await invoke('patch', request('patch', {
        patches: [
            { id: dataEntry.id, expectedHash: dataEntry.hash, text: '번역문' },
            { id: codeEntry.id, expectedHash: codeEntry.hash, text: '코드 번역문' },
        ],
    }));
    assert.equal(response.status, 0, JSON.stringify(response.result));

    response = await invoke('verify', request('verify'));
    assert.equal(response.status, 0, JSON.stringify(response.result));
    assert.equal(response.result.validation.profile, 'gdevelop');
    assert.equal(response.result.scores.reinsertionValidity, 100);

    response = await invoke('apply-without-code-opt-in', request('apply', { outputPath: blockedOutput }));
    assert.equal(response.status, 1);
    assert.equal(response.result.error.code, 'E_EXPERIMENTAL_FEATURE_DISABLED');
    assert.equal(fs.existsSync(blockedOutput), false);

    response = await invoke('apply', request('apply', {
        outputPath: output,
        options: { experimentalGdevelopCodeStrings: true },
    }));
    assert.equal(response.status, 0, JSON.stringify(response.result));
    assert.equal(response.result.validation.ok, true, JSON.stringify(response.result.validation.issues));
    assert.equal(readGDevelopProjectData(path.join(output, 'data.js')).layouts[0].objects[0].string, '번역문');
    assert.match(fs.readFileSync(path.join(output, 'code0.js'), 'utf8'), /setString\("코드 번역문"\)/);
});

test('round-trips a GDevelop package.nw through CLI provenance without modifying the source wrapper', async () => {
    const root = tempDir();
    const wrapper = path.join(root, 'game');
    const working = path.join(root, 'working');
    const output = path.join(root, 'translated-game');
    const archive = path.join(wrapper, 'package.nw');
    fs.mkdirSync(wrapper, { recursive: true });
    fs.writeFileSync(path.join(wrapper, 'launcher.exe'), 'wrapper-binary');
    writeStoredZip(archive, {
        'package.json': JSON.stringify({ name: 'fixture', main: 'index.html' }),
        'index.html': '<script src="gdjs/runtime.js"></script><script src="code0.js"></script><script src="data.js"></script>',
        'gdjs/runtime.js': '/* protected runtime */',
        'code0.js': 'for (var i = 0; i < gdjs.SceneCode.GDDialogueObjects1.length; ++i) { gdjs.SceneCode.GDDialogueObjects1[i].setString("Code hello"); }',
        'data.js': `gdjs.projectData = ${JSON.stringify({
            layouts: [{ name: 'Scene', objects: [{ type: 'TextObject::Text', name: 'Dialogue', string: 'Hello' }] }],
        })};\ngdjs.runtimeGameOptions = {};\n`,
    });
    const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
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
    const request = (operation, projectPath, extra = {}) => ({
        schemaVersion: 2, operation, format: 'auto', projectPath,
        profile: 'standard', options: {}, patches: [], ...extra,
    });

    let response = await invoke('nw-extract', request('extract', wrapper, {
        outputPath: working,
        options: { experimentalGdevelopCodeStrings: true },
    }));
    assert.equal(response.status, 0, JSON.stringify(response.result));
    assert.equal(response.result.container.type, 'nwjs-package');
    assert.equal(response.result.engine.type, 'gdevelop');
    const manifest = JSON.parse(fs.readFileSync(path.join(working, '_Extract', 'manifest.json'), 'utf8'));
    const dataEntry = manifest.entries.find((entry) => entry.gdevelop?.kind === 'project-data');
    const codeEntry = manifest.entries.find((entry) => entry.gdevelop?.kind === 'code-literal');

    response = await invoke('nw-patch', request('patch', working, {
        patches: [
            { id: dataEntry.id, expectedHash: dataEntry.hash, text: '번역문' },
            { id: codeEntry.id, expectedHash: codeEntry.hash, text: 'NW 코드 번역' },
        ],
    }));
    assert.equal(response.status, 0, JSON.stringify(response.result));

    response = await invoke('nw-apply', request('apply', working, {
        outputPath: output,
        options: { containerSourcePath: wrapper, experimentalGdevelopCodeStrings: true },
    }));
    assert.equal(response.status, 0, JSON.stringify(response.result));
    assert.equal(fs.readFileSync(path.join(output, 'launcher.exe'), 'utf8'), 'wrapper-binary');
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), sourceHash);

    const outputInfo = inspectContainer(output);
    assert.equal(outputInfo.type, 'nwjs-package');
    assert.equal(outputInfo.engine.type, 'gdevelop');
    const outputStaging = path.join(root, 'output-staging');
    await extractContainer(outputInfo, outputStaging);
    assert.equal(readGDevelopProjectData(path.join(outputStaging, 'data.js')).layouts[0].objects[0].string, '번역문');
    assert.match(fs.readFileSync(path.join(outputStaging, 'code0.js'), 'utf8'), /setString\("NW 코드 번역"\)/);
});

test('directory-form package.nw is diagnostic by default and round-trips only with explicit opt-in', async () => {
    const root = tempDir();
    const wrapper = path.join(root, 'directory-game');
    const packageDir = path.join(wrapper, 'package.nw');
    const working = path.join(root, 'directory-working');
    const blockedOutput = path.join(root, 'directory-blocked-output');
    const output = path.join(root, 'directory-translated');
    fs.mkdirSync(path.join(packageDir, 'gdjs'), { recursive: true });
    fs.writeFileSync(path.join(wrapper, 'launcher.exe'), 'directory-wrapper-binary');
    fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: 'fixture', main: 'index.html' }));
    fs.writeFileSync(path.join(packageDir, 'index.html'), '<script src="gdjs/runtime.js"></script><script src="data.js"></script>');
    fs.writeFileSync(path.join(packageDir, 'gdjs', 'runtime.js'), '/* protected runtime */');
    fs.writeFileSync(path.join(packageDir, 'data.js'), `gdjs.projectData = ${JSON.stringify({
        layouts: [{ name: 'Scene', objects: [{ type: 'TextObject::Text', name: 'Dialogue', string: 'Hello' }] }],
    })};\ngdjs.runtimeGameOptions = {};\n`);
    const sourceInfoBefore = inspectContainer(wrapper);
    assert.equal(sourceInfoBefore.type, 'nwjs-package');
    assert.ok(sourceInfoBefore.engine.features.includes('nwjs-directory-form'));
    const sourceDigest = sourceInfoBefore.archive.sha256;

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
    const request = (operation, projectPath, extra = {}) => ({
        schemaVersion: 2, operation, format: 'auto', projectPath,
        profile: 'standard', options: {}, patches: [], ...extra,
    });

    let response = await invoke('directory-nw-extract-blocked', request('extract', wrapper, { outputPath: working }));
    assert.equal(response.status, 1);
    assert.equal(response.result.error.code, 'E_EXPERIMENTAL_FEATURE_DISABLED');
    assert.equal(fs.existsSync(working), false);

    response = await invoke('directory-nw-extract', request('extract', wrapper, {
        outputPath: working,
        options: { experimentalNwDirectory: true },
    }));
    assert.equal(response.status, 0, JSON.stringify(response.result));
    assert.ok(response.result.engine.features.includes('nwjs-directory-form'));
    const manifest = JSON.parse(fs.readFileSync(path.join(working, '_Extract', 'manifest.json'), 'utf8'));
    const entry = manifest.entries[0];

    response = await invoke('directory-nw-patch', request('patch', working, {
        patches: [{ id: entry.id, expectedHash: entry.hash, text: '디렉터리 번역' }],
    }));
    assert.equal(response.status, 0, JSON.stringify(response.result));

    response = await invoke('directory-nw-apply-blocked', request('apply', working, {
        outputPath: blockedOutput,
        options: { containerSourcePath: wrapper },
    }));
    assert.equal(response.status, 1);
    assert.equal(response.result.error.code, 'E_EXPERIMENTAL_FEATURE_DISABLED');
    assert.equal(fs.existsSync(blockedOutput), false);

    response = await invoke('directory-nw-apply', request('apply', working, {
        outputPath: output,
        options: { containerSourcePath: wrapper, experimentalNwDirectory: true },
    }));
    assert.equal(response.status, 0, JSON.stringify(response.result));
    assert.equal(fs.statSync(path.join(output, 'package.nw')).isDirectory(), true);
    assert.equal(fs.readFileSync(path.join(output, 'launcher.exe'), 'utf8'), 'directory-wrapper-binary');
    assert.equal(readGDevelopProjectData(path.join(output, 'package.nw', 'data.js')).layouts[0].objects[0].string, '디렉터리 번역');
    assert.equal(inspectContainer(wrapper).archive.sha256, sourceDigest);
    assert.equal(inspectContainer(output).engine.features.includes('nwjs-directory-form'), true);
    assert.deepEqual(fs.readdirSync(root).filter((name) => name.includes('tsukuru-stage') || name.includes('tsukuru-backup')), []);
});

test('directory-form package.nw rejects a linked entry before staging publication', async (t) => {
    const root = tempDir();
    const wrapper = path.join(root, 'linked-game');
    const packageDir = path.join(wrapper, 'package.nw');
    const outside = path.join(root, 'outside');
    const staging = path.join(root, 'linked-staging');
    fs.mkdirSync(packageDir, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ main: 'index.html' }));
    fs.writeFileSync(path.join(packageDir, 'index.html'), '<html></html>');
    try {
        fs.symlinkSync(outside, path.join(packageDir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }
    const info = inspectContainer(wrapper);
    assert.equal(info.type, 'nwjs-package');
    assert.ok(info.archive.invalidEntryCount > 0);
    await assert.rejects(extractContainer(info, staging), /안전하지 않은|링크|정션/);
    assert.equal(fs.existsSync(staging), false);
});

test('rechecks a directory-form package.nw source for junction replacement before extraction', async (t) => {
    const root = tempDir();
    const work = tempDir();
    const wrapper = path.join(root, 'game');
    const packageDir = path.join(wrapper, 'package.nw');
    const outside = path.join(root, 'outside-package');
    const staging = path.join(work, 'staging');
    fs.mkdirSync(packageDir, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ main: 'index.html' }));
    fs.writeFileSync(path.join(packageDir, 'index.html'), '<html>original</html>');
    fs.writeFileSync(path.join(outside, 'package.json'), JSON.stringify({ main: 'index.html' }));
    fs.writeFileSync(path.join(outside, 'index.html'), '<html>outside</html>');
    const info = inspectContainer(wrapper);
    fs.rmSync(packageDir, { recursive: true, force: true });
    try {
        fs.symlinkSync(outside, packageDir, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        t.skip(`symlink/junction creation unavailable: ${error.code}`);
        return;
    }
    const originalCopyFile = fs.copyFileSync;
    let copyCalled = false;
    fs.copyFileSync = (...args) => {
        copyCalled = true;
        return originalCopyFile(...args);
    };

    try {
        await assert.rejects(extractContainer(info, staging), /link|junction|symbolic|심볼릭|정션/i);
        assert.equal(copyCalled, false);
        assert.equal(fs.existsSync(staging), false);
    } finally {
        fs.copyFileSync = originalCopyFile;
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(work, { recursive: true, force: true });
    }
});

test('unsigned PE-appended NW.js ZIP is diagnostic by default and preserves its prefix with opt-in', async () => {
    const root = tempDir();
    const wrapper = path.join(root, 'appended-game');
    const executable = path.join(wrapper, 'game.exe');
    const working = path.join(root, 'appended-working');
    const output = path.join(root, 'appended-translated');
    fs.mkdirSync(wrapper, { recursive: true });
    fs.writeFileSync(path.join(wrapper, 'wrapper.dat'), 'wrapper-resource');
    const prefix = writePeAppendedZip(executable, {
        'package.json': JSON.stringify({ name: 'fixture', main: 'index.html' }),
        'index.html': '<script src="gdjs/runtime.js"></script><script src="data.js"></script>',
        'gdjs/runtime.js': '/* protected runtime */',
        'data.js': `gdjs.projectData = ${JSON.stringify({
            layouts: [{ name: 'Scene', objects: [{ type: 'TextObject::Text', name: 'Dialogue', string: 'Hello' }] }],
        })};\ngdjs.runtimeGameOptions = {};\n`,
    });
    const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
    const info = inspectContainer(wrapper);
    assert.equal(info.type, 'nwjs-package');
    assert.equal(info.packagePath, executable);
    assert.ok(info.engine.features.includes('nwjs-appended-zip'));
    assert.ok(info.engine.features.includes('nwjs-appended-zip-unsigned'));
    assert.ok(info.engine.features.includes('nwjs-appended-zip-launch-unverified'));

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
    const request = (operation, projectPath, extra = {}) => ({
        schemaVersion: 2, operation, format: 'auto', projectPath,
        profile: 'standard', options: {}, patches: [], ...extra,
    });

    let response = await invoke('appended-extract-blocked', request('extract', wrapper, { outputPath: working }));
    assert.equal(response.status, 1);
    assert.equal(response.result.error.code, 'E_EXPERIMENTAL_FEATURE_DISABLED');
    assert.equal(fs.existsSync(working), false);

    response = await invoke('appended-extract', request('extract', wrapper, {
        outputPath: working,
        options: { experimentalNwAppendedZip: true },
    }));
    assert.equal(response.status, 0, JSON.stringify(response.result));
    const manifest = JSON.parse(fs.readFileSync(path.join(working, '_Extract', 'manifest.json'), 'utf8'));
    const entry = manifest.entries[0];
    response = await invoke('appended-patch', request('patch', working, {
        patches: [{ id: entry.id, expectedHash: entry.hash, text: '추가 ZIP 번역' }],
    }));
    assert.equal(response.status, 0, JSON.stringify(response.result));
    response = await invoke('appended-apply', request('apply', working, {
        outputPath: output,
        options: { containerSourcePath: wrapper, experimentalNwAppendedZip: true },
    }));
    assert.equal(response.status, 0, JSON.stringify(response.result));
    assert.equal(fs.readFileSync(path.join(output, 'wrapper.dat'), 'utf8'), 'wrapper-resource');
    assert.deepEqual(fs.readFileSync(path.join(output, 'game.exe')).subarray(0, prefix.length), prefix);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex'), sourceHash);
    const outputInfo = inspectContainer(output);
    assert.ok(outputInfo.engine.features.includes('nwjs-appended-zip'));
    const extractedOutput = path.join(root, 'appended-output-extracted');
    await extractContainer(outputInfo, extractedOutput);
    assert.equal(readGDevelopProjectData(path.join(extractedOutput, 'data.js')).layouts[0].objects[0].string, '추가 ZIP 번역');
});

test('signed PE-appended ZIP remains diagnostic-only even with the experimental flag', async () => {
    const root = tempDir();
    const wrapper = path.join(root, 'signed-appended-game');
    const executable = path.join(wrapper, 'signed.exe');
    const output = path.join(root, 'signed-working');
    fs.mkdirSync(wrapper, { recursive: true });
    writePeAppendedZip(executable, {
        'package.json': JSON.stringify({ name: 'fixture', main: 'index.html' }),
        'index.html': '<script src="gdjs/runtime.js"></script><script src="data.js"></script>',
        'gdjs/runtime.js': '/* protected runtime */',
        'data.js': `gdjs.projectData = ${JSON.stringify({
            layouts: [{ name: 'Scene', objects: [{ type: 'TextObject::Text', name: 'Dialogue', string: 'Hello' }] }],
        })};\ngdjs.runtimeGameOptions = {};\n`,
    }, { signed: true });
    const info = inspectContainer(wrapper);
    assert.equal(info.type, 'nwjs-package');
    assert.ok(info.engine.features.includes('nwjs-appended-zip'));
    assert.ok(info.engine.features.includes('nwjs-appended-zip-authenticode-present'));

    const requestPath = path.join(root, 'signed-extract.json');
    fs.writeFileSync(requestPath, JSON.stringify({
        schemaVersion: 2,
        operation: 'extract',
        format: 'auto',
        projectPath: wrapper,
        outputPath: output,
        profile: 'standard',
        options: { experimentalNwAppendedZip: true },
        patches: [],
    }));
    let stdout = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
    let status;
    try { status = await runAgent(['run', '--request', requestPath]); } finally { process.stdout.write = originalWrite; }
    const result = JSON.parse(stdout);
    assert.equal(status, 1);
    assert.equal(result.error.code, 'E_EXPERIMENTAL_FEATURE_UNSAFE');
    assert.equal(fs.existsSync(output), false);
});

test('multiple PE-appended ZIP candidates remain ambiguous and unchanged', async () => {
    const root = tempDir();
    const wrapper = path.join(root, 'ambiguous-appended-game');
    const output = path.join(root, 'ambiguous-working');
    fs.mkdirSync(wrapper, { recursive: true });
    const files = {
        'package.json': JSON.stringify({ name: 'fixture', main: 'index.html' }),
        'index.html': '<script src="gdjs/runtime.js"></script><script src="data.js"></script>',
        'gdjs/runtime.js': '/* protected runtime */',
        'data.js': `gdjs.projectData = ${JSON.stringify({
            layouts: [{ name: 'Scene', objects: [{ type: 'TextObject::Text', name: 'Dialogue', string: 'Hello' }] }],
        })};\ngdjs.runtimeGameOptions = {};\n`,
    };
    writePeAppendedZip(path.join(wrapper, 'game-a.exe'), files);
    writePeAppendedZip(path.join(wrapper, 'game-b.exe'), files);
    const before = fs.readdirSync(wrapper).map((name) => ({
        name,
        hash: crypto.createHash('sha256').update(fs.readFileSync(path.join(wrapper, name))).digest('hex'),
    }));
    const info = inspectContainer(wrapper);
    assert.equal(info.type, 'nwjs-package');
    assert.equal(info.archive, null);
    assert.ok(info.engine.features.includes('nwjs-appended-zip-ambiguous'));

    const requestPath = path.join(root, 'ambiguous-extract.json');
    fs.writeFileSync(requestPath, JSON.stringify({
        schemaVersion: 2,
        operation: 'extract',
        format: 'auto',
        projectPath: wrapper,
        outputPath: output,
        profile: 'standard',
        options: { experimentalNwAppendedZip: true },
        patches: [],
    }));
    let stdout = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
    let status;
    try { status = await runAgent(['run', '--request', requestPath]); } finally { process.stdout.write = originalWrite; }
    assert.equal(status, 1);
    assert.equal(JSON.parse(stdout).error.code, 'E_FORMAT_UNKNOWN');
    assert.equal(fs.existsSync(output), false);
    const after = fs.readdirSync(wrapper).map((name) => ({
        name,
        hash: crypto.createHash('sha256').update(fs.readFileSync(path.join(wrapper, name))).digest('hex'),
    }));
    assert.deepEqual(after, before);
});

test('opt-in GDevelop code profile extracts only AST-proven generated text literals without executing code', () => {
    const root = tempDir();
    const project = path.join(root, 'gdevelop-code-profile');
    const output = path.join(root, 'gdevelop-code-output');
    fs.mkdirSync(path.join(project, 'gdjs'), { recursive: true });
    fs.writeFileSync(path.join(project, 'index.html'), '<script src="gdjs/runtime.js"></script><script src="code0.js"></script><script src="data.js"></script>');
    fs.writeFileSync(path.join(project, 'gdjs', 'runtime.js'), '/* protected runtime */');
    fs.writeFileSync(path.join(project, 'data.js'), `gdjs.projectData = ${JSON.stringify({
        layouts: [{ name: 'Scene', objects: [{ type: 'TextObject::Text', name: 'Dialogue', string: 'Data hello' }] }],
    })};\ngdjs.runtimeGameOptions = {};\n`);
    const codeSource = [
        'throw new Error("must not execute");',
        'gdjs.SceneCode.func = function(runtimeScene) {',
        '  for (var i = 0; i < gdjs.SceneCode.GDDialogueObjects1.length; ++i) {',
        '    gdjs.SceneCode.GDDialogueObjects1[i].setString("assets/generated-dialogue.png");',
        '    gdjs.SceneCode.GDDialogueObjects1[i].setString("Code hello");',
        '  }',
        '  other.setString("Ambiguous setter");',
        '  gdjs.evtTools.common.setVariableString(runtimeScene.getVariables().get("State"), "Variable value");',
        '  const resource = "assets/dialogue.png";',
        '  const identifier = "DialogueObject";',
        '};',
        '',
    ].join('\n');
    fs.writeFileSync(path.join(project, 'code0.js'), codeSource);
    const service = new GDevelopService();

    service.extract({ projectRoot: project });
    let manifest = JSON.parse(fs.readFileSync(path.join(project, '_Extract', 'manifest.json'), 'utf8'));
    assert.equal(manifest.entries.length, 1, 'default profile must keep code*.js protected');

    const report = service.extract({ projectRoot: project, force: true, experimentalGdevelopCodeStrings: true });
    manifest = JSON.parse(fs.readFileSync(path.join(project, '_Extract', 'manifest.json'), 'utf8'));
    const codeEntries = manifest.entries.filter((entry) => entry.gdevelop?.kind === 'code-literal');
    assert.equal(codeEntries.length, 1);
    assert.equal(codeEntries[0].sourceFile, 'code0.js');
    assert.equal(report.codeEntries, 1);
    assert.ok(report.ambiguousCodeStrings >= 4);
    const codeReport = JSON.parse(fs.readFileSync(path.join(project, '_Extract', 'gdevelop-code-report.json'), 'utf8'));
    assert.equal(codeReport.safeCandidates, 1);
    assert.ok(codeReport.ambiguousCandidates.some((candidate) => candidate.value === 'assets/dialogue.png'));

    const codeEntry = codeEntries[0];
    applyPatches(path.join(project, '_Extract'), 'gdevelop', [{
        id: codeEntry.id,
        expectedHash: codeEntry.hash,
        text: 'OK',
    }]);
    assert.throws(
        () => service.applyToCopy({ projectRoot: project, outputRoot: output }),
        (error) => error?.code === 'E_EXPERIMENTAL_FEATURE_DISABLED',
    );
    assert.equal(fs.existsSync(output), false);

    const applied = service.applyToCopy({
        projectRoot: project,
        outputRoot: output,
        experimentalGdevelopCodeStrings: true,
    });
    assert.equal(applied.validation.ok, true);
    assert.deepEqual(applied.approvedCodeFiles, ['code0.js']);
    const outputCode = fs.readFileSync(path.join(output, 'code0.js'), 'utf8');
    assert.match(outputCode, /setString\("OK"\)/);
    assert.match(outputCode, /setString\("assets\/generated-dialogue\.png"\)/);
    assert.match(outputCode, /other\.setString\("Ambiguous setter"\)/);
    assert.match(outputCode, /"assets\/dialogue\.png"/);
    assert.match(outputCode, /throw new Error\("must not execute"\)/);
    assert.equal(fs.readFileSync(path.join(project, 'code0.js'), 'utf8'), codeSource);
    assert.equal(globalThis.__tsukuruExecuted, undefined);

    const tamperedOutput = path.join(root, 'gdevelop-code-tampered-output');
    const tamperedManifest = JSON.parse(fs.readFileSync(path.join(project, '_Extract', 'manifest.json'), 'utf8'));
    tamperedManifest.entries.find((entry) => entry.id === codeEntry.id).gdevelop.sourceStart = 0;
    fs.writeFileSync(path.join(project, '_Extract', 'manifest.json'), JSON.stringify(tamperedManifest, null, 2));
    assert.throws(
        () => service.applyToCopy({
            projectRoot: project,
            outputRoot: tamperedOutput,
            experimentalGdevelopCodeStrings: true,
        }),
        (error) => error?.code === 'E_MAPPING_CORRUPT',
    );
    assert.equal(fs.existsSync(tamperedOutput), false);
    assert.equal(fs.readFileSync(path.join(project, 'code0.js'), 'utf8'), codeSource);
});
