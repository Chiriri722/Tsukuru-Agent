const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { finished } = require('node:stream/promises');
const asar = require('@electron/asar');
const iconv = require('iconv-lite');
const { Pickle } = require(path.join(path.dirname(require.resolve('@electron/asar')), 'pickle.js'));

const { inspectContainer, extractContainer, packContainer, verifyContainerOutput, copyExternalResources } = require('../src/core/container.js');
const { scoreVerification, diffFileMaps, snapshotDirectory, inspectRpgProject, inspectWolfBinaryMappings, inspectTyranoProject } = require('../src/core/validator.js');
const { applyPatches } = require('../src/cli/patcher.js');
const { sha256Text } = require('../src/core/manifest.js');

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
