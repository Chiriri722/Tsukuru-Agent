const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { finished } = require('node:stream/promises');
const asar = require('@electron/asar');
const { Pickle } = require(path.join(path.dirname(require.resolve('@electron/asar')), 'pickle.js'));
const { runAgent } = require('../../.build/app/src/cli/run.js');

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

test('v2 verify emits machine JSON and human summary for nested ASAR', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-cli-'));
    const source = path.join(root, 'source');
    const game = path.join(root, 'game');
    const archive = path.join(game, 'resources', 'app.asar');
    fs.mkdirSync(path.join(source, 'project', 'data'), { recursive: true });
    fs.mkdirSync(path.join(source, 'project', 'js'), { recursive: true });
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.writeFileSync(path.join(source, 'project', 'data', 'Actors.json'), '[]');
    fs.writeFileSync(path.join(source, 'project', 'js', 'rmmz_core.js'), '');
    await asar.createPackage(source, archive);

    const requestPath = path.join(root, 'request.json');
    fs.writeFileSync(requestPath, JSON.stringify({
        schemaVersion: 2, operation: 'verify', format: 'auto', projectPath: game,
        profile: 'standard', options: { verifyDepth: 'deep', humanSummary: true }, patches: [],
    }));
    let stdout = '';
    let stderr = '';
    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
    process.stderr.write = (chunk) => { stderr += String(chunk); return true; };
    let status;
    try {
        status = await runAgent(['run', '--request', requestPath]);
    } finally {
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
    }
    assert.equal(status, 1);
    const json = JSON.parse(stdout);
    assert.equal(json.format, 'rpgmz');
    assert.equal(json.container.type, 'electron-asar');
    assert.equal(json.container.invalidEntryCount, 0);
    assert.equal(json.engine.type, 'rpgmz');
    assert.equal(json.runtime.executable, null);
    assert.equal(json.runtime.risk, 'unassessed');
    assert.equal(typeof json.scores.total, 'number');
    assert.equal(json.scores.protectedScriptIntegrity, 50);
    assert.equal(json.change.protectedScriptDamage, 0);
    assert.match(stderr, /score=/);
    assert.match(stderr, /protected-script-damage=unassessed/);
});

test('deep verify quantifies non-protected output changes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-diff-'));
    const game = path.join(root, 'game');
    const output = path.join(root, 'output');
    const data = path.join(game, 'www', 'data');
    fs.mkdirSync(path.join(data, 'Extract'), { recursive: true });
    fs.mkdirSync(path.join(data, 'Backup'), { recursive: true });
    const actors = [null, { id: 1, name: 'original', classId: 0 }];
    fs.writeFileSync(path.join(data, 'Actors.json'), JSON.stringify(actors));
    fs.writeFileSync(path.join(data, 'Backup', 'Actors.json'), JSON.stringify(actors));
    fs.writeFileSync(path.join(data, '.extracteddata'), '{}');
    fs.writeFileSync(path.join(data, 'Extract', 'Actors.txt'), 'original\n');
    fs.writeFileSync(path.join(data, 'Extract', 'manifest.json'), JSON.stringify({ schemaVersion: 1, format: 'rpgmv', entries: [{
        id: 'Actors.json#1.name', sourceFile: 'Backup/Actors.json', dataPath: '1.name', extractFile: 'Actors.txt',
        lineStart: 0, lineEnd: 1, hash: crypto.createHash('sha256').update('original').digest('hex'),
        encoding: 'utf8', nullTerminated: false,
    }] }));
    fs.cpSync(game, output, { recursive: true });
    fs.rmSync(path.join(output, 'www', 'data', '.extracteddata'));
    fs.writeFileSync(path.join(output, 'www', 'data', 'Actors.json'), JSON.stringify([null, { id: 1, name: 'translated', classId: 0 }]));
    const requestPath = path.join(root, 'request.json');
    fs.writeFileSync(requestPath, JSON.stringify({ schemaVersion: 2, operation: 'verify', format: 'auto', projectPath: game, outputPath: output, profile: 'standard', options: { verifyDepth: 'deep' }, patches: [] }));
    let stdout = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
    try { await runAgent(['run', '--request', requestPath]); } finally { process.stdout.write = originalWrite; }
    const json = JSON.parse(stdout);
    assert.equal(json.ok, true);
    assert.equal(json.change.filesChanged, 1);
    assert.ok(json.change.textBytesChanged > 0);
    assert.equal(json.change.protectedScriptDamage, 0);
    assert.equal(json.scores.reinsertionValidity, 80);
    assert.equal(json.scores.protectedScriptIntegrity, 100);
});

test('verify publishes RPG JSON and manifest integrity in its validation report', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-rpg-verify-'));
    const game = path.join(root, 'game');
    const data = path.join(game, 'www', 'data');
    fs.mkdirSync(path.join(data, 'Extract'), { recursive: true });
    fs.mkdirSync(path.join(data, 'Backup'), { recursive: true });
    const actors = [null, { id: 1, name: 'Alice', classId: 0 }];
    fs.writeFileSync(path.join(data, 'Actors.json'), JSON.stringify(actors));
    fs.writeFileSync(path.join(data, 'Backup', 'Actors.json'), JSON.stringify(actors));
    fs.writeFileSync(path.join(data, '.extracteddata'), '{}');
    fs.writeFileSync(path.join(data, 'Extract', 'Actors.txt'), 'Alice\n');
    fs.writeFileSync(path.join(data, 'Extract', 'manifest.json'), JSON.stringify({
        schemaVersion: 1, format: 'rpgmv', entries: [{
            id: 'Actors.json#1.name', sourceFile: 'Backup/Actors.json', dataPath: '1.name', extractFile: 'Actors.txt',
            lineStart: 0, lineEnd: 1, hash: crypto.createHash('sha256').update('Alice').digest('hex'),
            encoding: 'utf8', nullTerminated: false,
        }],
    }));
    const requestPath = path.join(root, 'verify.json');
    fs.writeFileSync(requestPath, JSON.stringify({
        schemaVersion: 2, operation: 'verify', format: 'auto', projectPath: game,
        profile: 'standard', options: { humanSummary: true }, patches: [],
    }));
    let stdout = '';
    let stderr = '';
    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
    process.stderr.write = (chunk) => { stderr += String(chunk); return true; };
    let status;
    try { status = await runAgent(['run', '--request', requestPath]); } finally {
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
    }
    const result = JSON.parse(stdout);
    assert.equal(status, 0, JSON.stringify(result));
    assert.equal(result.validation.profile, 'rpgmv');
    assert.equal(result.validation.ok, true, JSON.stringify(result.validation.issues));
    assert.equal(result.validation.entriesChecked, 1);
    assert.equal(result.scores.mappingIntegrity, 100);
    assert.match(stderr, /validation=rpgmv.*invalid=0/);
});

test('verify recognizes a portable RPG extraction pack with source JSON only in Backup', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-rpg-pack-'));
    const pack = path.join(root, 'translated-pack');
    fs.mkdirSync(path.join(pack, 'Backup'), { recursive: true });
    fs.mkdirSync(path.join(pack, 'Extract'), { recursive: true });
    const actors = [null, { id: 1, name: 'Alice', classId: 0 }];
    fs.writeFileSync(path.join(pack, 'Backup', 'Actors.json'), JSON.stringify(actors));
    fs.writeFileSync(path.join(pack, '.extracteddata'), '{}');
    fs.writeFileSync(path.join(pack, 'Extract', 'Actors.txt'), 'Alice\n');
    fs.writeFileSync(path.join(pack, 'Extract', 'manifest.json'), JSON.stringify({
        schemaVersion: 1, format: 'rpgmv', entries: [{
            id: 'Actors.json#1.name', sourceFile: 'Backup/Actors.json', dataPath: '1.name', extractFile: 'Actors.txt',
            lineStart: 0, lineEnd: 1, hash: crypto.createHash('sha256').update('Alice').digest('hex'),
            encoding: 'utf8', nullTerminated: false,
        }],
    }));
    const requestPath = path.join(root, 'verify.json');
    fs.writeFileSync(requestPath, JSON.stringify({
        schemaVersion: 2, operation: 'verify', format: 'auto', projectPath: pack,
        profile: 'standard', options: { verifyDepth: 'deep' }, patches: [],
    }));
    const cli = require('node:child_process').spawnSync(process.execPath, [
        path.join(__dirname, '..', '..', '.build', 'app', 'src', 'cli', 'main.js'), 'run', '--request', requestPath,
    ], { encoding: 'utf8' });
    const result = JSON.parse(cli.stdout);
    assert.equal(cli.status, 0, JSON.stringify(result));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.format, 'rpgmv');
    assert.equal(result.engine.type, 'rpgmv');
    assert.equal(result.validation.entriesChecked, 1);
    assert.equal(result.validation.invalidEntries, 0);
    assert.equal(result.validation.filesChecked, 1);
});

test('verify keeps RPG reference damage inherited from Backup as a non-blocking warning', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-rpg-baseline-'));
    const pack = path.join(root, 'translated-pack');
    fs.mkdirSync(path.join(pack, 'Backup'), { recursive: true });
    fs.mkdirSync(path.join(pack, 'Extract'), { recursive: true });
    const mapInfos = [
        null,
        { id: 1, name: 'Start', parentId: 0 },
        { id: 2, name: 'Already missing', parentId: 0 },
    ];
    fs.writeFileSync(path.join(pack, 'Backup', 'MapInfos.json'), JSON.stringify(mapInfos));
    fs.writeFileSync(path.join(pack, '.extracteddata'), '{}');
    fs.writeFileSync(path.join(pack, 'Extract', 'MapInfos.txt'), 'Start\n');
    fs.writeFileSync(path.join(pack, 'Extract', 'manifest.json'), JSON.stringify({
        schemaVersion: 1, format: 'rpgmv', entries: [{
            id: 'MapInfos.json#1.name', sourceFile: 'Backup/MapInfos.json', dataPath: '1.name', extractFile: 'MapInfos.txt',
            lineStart: 0, lineEnd: 1, hash: crypto.createHash('sha256').update('Start').digest('hex'),
            encoding: 'utf8', nullTerminated: false,
        }],
    }));
    const requestPath = path.join(root, 'verify.json');
    fs.writeFileSync(requestPath, JSON.stringify({
        schemaVersion: 2, operation: 'verify', format: 'auto', projectPath: pack,
        profile: 'standard', options: { verifyDepth: 'deep' }, patches: [],
    }));

    const cli = spawnSync(process.execPath, [
        path.join(__dirname, '..', '..', '.build', 'app', 'src', 'cli', 'main.js'), 'run', '--request', requestPath,
    ], { encoding: 'utf8' });
    const result = JSON.parse(cli.stdout);

    assert.equal(cli.status, 0, JSON.stringify(result));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.error, null);
    assert.equal(result.validation.ok, true, JSON.stringify(result.validation.issues));
    assert.ok(result.validation.issues.some((issue) => issue.code === 'RPG_MAP_FILE_MISSING_BASELINE'
        && issue.severity === 'warning'));
});

test('apply completes a portable RPG extraction pack without root System.json when no media needs encryption', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-rpg-pack-apply-'));
    const pack = path.join(root, 'translated-pack');
    fs.mkdirSync(path.join(pack, 'Backup'), { recursive: true });
    fs.mkdirSync(path.join(pack, 'Extract'), { recursive: true });
    const actors = [null, { id: 1, name: 'Alice', classId: 0 }];
    fs.writeFileSync(path.join(pack, 'Backup', 'Actors.json'), JSON.stringify(actors));
    fs.writeFileSync(path.join(pack, 'Extract', 'Actors.txt'), '앨리스\n');
    fs.writeFileSync(path.join(pack, 'Extract', 'manifest.json'), JSON.stringify({
        schemaVersion: 1, format: 'rpgmv', entries: [{
            id: 'Actors.json#1.name', sourceFile: 'Backup/Actors.json', dataPath: '1.name', extractFile: 'Actors.txt',
            lineStart: 0, lineEnd: 1, hash: crypto.createHash('sha256').update('앨리스').digest('hex'),
            encoding: 'utf8', nullTerminated: false,
        }],
    }));
    require('../../.build/app/src/js/rpgmv/edtool.js').write(pack, { main: {
        'Actors.json': { data: { '0': { origin: 'Actors.json', val: '1.name', m: 1 } } },
    } });
    const requestPath = path.join(root, 'apply.json');
    fs.writeFileSync(requestPath, JSON.stringify({
        schemaVersion: 2, operation: 'apply', format: 'auto', projectPath: pack,
        profile: 'standard', options: {}, patches: [],
    }));
    const cli = require('node:child_process').spawnSync(process.execPath, [
        path.join(__dirname, '..', '..', '.build', 'app', 'src', 'cli', 'main.js'), 'run', '--request', requestPath,
    ], { encoding: 'utf8' });
    const result = JSON.parse(cli.stdout);
    assert.equal(cli.status, 0, JSON.stringify(result));
    assert.equal(result.ok, true, JSON.stringify(result));
    const completed = JSON.parse(fs.readFileSync(path.join(pack, 'Completed', 'data', 'Actors.json'), 'utf8'));
    assert.equal(completed[1].name, '앨리스');
    assert.equal(fs.existsSync(path.join(pack, 'System.json')), false);
});

test('loose RPG apply rejects launchProbe before creating output', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-loose-launch-'));
    try {
        const pack = path.join(root, 'translated-pack');
        const output = path.join(root, 'translated-game');
        fs.mkdirSync(path.join(pack, 'Backup'), { recursive: true });
        fs.mkdirSync(path.join(pack, 'Extract'), { recursive: true });
        const actors = [null, { id: 1, name: 'Alice', classId: 0 }];
        fs.writeFileSync(path.join(pack, 'Backup', 'Actors.json'), JSON.stringify(actors));
        fs.writeFileSync(path.join(pack, 'Extract', 'Actors.txt'), '앨리스\n');
        fs.writeFileSync(path.join(pack, 'Extract', 'manifest.json'), JSON.stringify({
            schemaVersion: 1, format: 'rpgmv', entries: [{
                id: 'Actors.json#1.name', sourceFile: 'Backup/Actors.json', dataPath: '1.name', extractFile: 'Actors.txt',
                lineStart: 0, lineEnd: 1, hash: crypto.createHash('sha256').update('앨리스').digest('hex'),
                encoding: 'utf8', nullTerminated: false,
            }],
        }));
        require('../../.build/app/src/js/rpgmv/edtool.js').write(pack, { main: {
            'Actors.json': { data: { '0': { origin: 'Actors.json', val: '1.name', m: 1 } } },
        } });
        const requestPath = path.join(root, 'apply.json');
        fs.writeFileSync(requestPath, JSON.stringify({
            schemaVersion: 2, operation: 'apply', format: 'auto', projectPath: pack,
            outputPath: output, profile: 'standard', options: { launchProbe: true }, patches: [],
        }));

        let stdout = '';
        const originalWrite = process.stdout.write;
        process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
        let status;
        try {
            status = await runAgent(['run', '--request', requestPath]);
        } finally {
            process.stdout.write = originalWrite;
        }
        const result = JSON.parse(stdout);
        assert.equal(status, 1, JSON.stringify(result));
        assert.equal(result.error.code, 'E_NOT_IMPLEMENTED');
        assert.match(result.error.message, /launchProbe/);
        assert.equal(fs.existsSync(output), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('patch imports safe RPG translation dictionaries and reports skipped entries', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-rpg-dictionary-'));
    const pack = path.join(root, 'translated-pack');
    const translations = path.join(pack, 'translations');
    fs.mkdirSync(path.join(pack, 'Backup'), { recursive: true });
    fs.mkdirSync(path.join(pack, 'Extract'), { recursive: true });
    fs.mkdirSync(translations, { recursive: true });
    const actors = [
        null,
        { id: 1, name: 'Alice', classId: 0 },
        { id: 2, name: 'Bob', classId: 0 },
        { id: 3, name: 'Carol', classId: 0 },
    ];
    fs.writeFileSync(path.join(pack, 'Backup', 'Actors.json'), JSON.stringify(actors));
    fs.writeFileSync(path.join(pack, 'Extract', 'Actors.txt'), 'Alice\nBob\nCarol\n');
    fs.writeFileSync(path.join(pack, 'Extract', 'manifest.json'), JSON.stringify({
        schemaVersion: 1, format: 'rpgmv', entries: [
            {
                id: 'Actors.json#1.name', sourceFile: 'Backup/Actors.json', dataPath: '1.name', extractFile: 'Actors.txt',
                lineStart: 0, lineEnd: 1, hash: crypto.createHash('sha256').update('Alice').digest('hex'),
                encoding: 'utf8', nullTerminated: false, mv: { originFile: 'Actors.json' },
            },
            {
                id: 'Actors.json#2.name', sourceFile: 'Backup/Actors.json', dataPath: '2.name', extractFile: 'Actors.txt',
                lineStart: 1, lineEnd: 2, hash: crypto.createHash('sha256').update('Bob').digest('hex'),
                encoding: 'utf8', nullTerminated: false, mv: { originFile: 'Actors.json' },
            },
            {
                id: 'Actors.json#3.name', sourceFile: 'Backup/Actors.json', dataPath: '3.name', extractFile: 'Actors.txt',
                lineStart: 2, lineEnd: 3, hash: crypto.createHash('sha256').update('Carol').digest('hex'),
                encoding: 'utf8', nullTerminated: false, mv: { originFile: 'Actors.json' },
            },
        ],
    }));
    require('../../.build/app/src/js/rpgmv/edtool.js').write(pack, { main: {
        'Actors.json': { data: {
            '0': { origin: 'Actors.json', originText: 'Alice', val: '1.name', m: 1 },
            '1': { origin: 'Actors.json', originText: 'Bob', val: '2.name', m: 2 },
            '2': { origin: 'Actors.json', originText: 'Carol', val: '3.name', m: 3 },
        } },
    } });
    fs.writeFileSync(path.join(translations, 'Actors_trans.json'), JSON.stringify({
        'Actors.json#1.name': '앨리스',
        'Actors.json#2.name': '',
        'Actors.json#3.name': 'Carol',
        'Actors.json#99.name': 'manifest에 없음',
    }));
    const requestPath = path.join(root, 'patch.json');
    fs.writeFileSync(requestPath, JSON.stringify({
        schemaVersion: 2, operation: 'patch', format: 'auto', projectPath: pack,
        profile: 'standard', options: { translationDirectory: translations }, patches: [],
    }));
    const cli = require('node:child_process').spawnSync(process.execPath, [
        path.join(__dirname, '..', '..', '.build', 'app', 'src', 'cli', 'main.js'), 'run', '--request', requestPath,
    ], { encoding: 'utf8' });
    const result = JSON.parse(cli.stdout);
    assert.equal(cli.status, 0, JSON.stringify(result));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(fs.readFileSync(path.join(pack, 'Extract', 'Actors.txt'), 'utf8'), '앨리스\nBob\nCarol\n');
    assert.deepEqual(result.stats.dictionary, {
        files: 1,
        entries: 4,
        selected: 1,
        skippedUnknown: 1,
        skippedBlank: 1,
        skippedUnchanged: 1,
        skippedComment: 0,
    });
    assert.equal(result.stats.patched, 1);
    assert.equal(result.warnings.length, 2);
});

test('translation dictionary import rejects manifest paths outside Extract before reading them', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-rpg-dictionary-path-'));
    const extract = path.join(root, 'Extract');
    const translations = path.join(root, 'translations');
    fs.mkdirSync(extract);
    fs.mkdirSync(translations);
    fs.writeFileSync(path.join(root, 'outside.txt'), 'Alice\n');
    fs.writeFileSync(path.join(extract, 'manifest.json'), JSON.stringify({
        schemaVersion: 1, format: 'rpgmv', entries: [{
            id: 'Actors.json#1.name', sourceFile: 'Backup/Actors.json', dataPath: '1.name', extractFile: '../outside.txt',
            lineStart: 0, lineEnd: 1, hash: crypto.createHash('sha256').update('Alice').digest('hex'),
            encoding: 'utf8', nullTerminated: false, mv: { originFile: 'Actors.json' },
        }],
    }));
    fs.writeFileSync(path.join(translations, 'Actors_trans.json'), JSON.stringify({
        'Actors.json#1.name': '앨리스',
    }));
    assert.throws(
        () => require('../../.build/app/src/core/translationDictionary.js').loadRpgTranslationDictionary(extract, translations),
        (error) => error.code === 'E_MAPPING_CORRUPT' && /밖/.test(error.message),
    );
});

test('apply imports an RPG translation dictionary before building Completed', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-rpg-dictionary-apply-'));
    const pack = path.join(root, 'translated-pack');
    const translations = path.join(pack, 'translations');
    fs.mkdirSync(path.join(pack, 'Backup'), { recursive: true });
    fs.mkdirSync(path.join(pack, 'Extract'), { recursive: true });
    fs.mkdirSync(translations, { recursive: true });
    const actors = [null, { id: 1, name: 'Alice', classId: 0 }];
    fs.writeFileSync(path.join(pack, 'Backup', 'Actors.json'), JSON.stringify(actors));
    fs.writeFileSync(path.join(pack, 'Extract', 'Actors.txt'), 'Alice\n');
    fs.writeFileSync(path.join(pack, 'Extract', 'manifest.json'), JSON.stringify({
        schemaVersion: 1, format: 'rpgmv', entries: [{
            id: 'Actors.json#1.name', sourceFile: 'Backup/Actors.json', dataPath: '1.name', extractFile: 'Actors.txt',
            lineStart: 0, lineEnd: 1, hash: crypto.createHash('sha256').update('Alice').digest('hex'),
            encoding: 'utf8', nullTerminated: false, mv: { originFile: 'Actors.json' },
        }],
    }));
    require('../../.build/app/src/js/rpgmv/edtool.js').write(pack, { main: {
        'Actors.json': { data: { '0': { origin: 'Actors.json', originText: 'Alice', val: '1.name', m: 1 } } },
    } });
    fs.writeFileSync(path.join(translations, 'Actors_trans.json'), JSON.stringify({
        'Actors.json#1.name': '앨리스',
    }));
    const requestPath = path.join(root, 'apply.json');
    fs.writeFileSync(requestPath, JSON.stringify({
        schemaVersion: 2, operation: 'apply', format: 'auto', projectPath: pack,
        profile: 'standard', options: { translationDirectory: translations }, patches: [],
    }));
    const cli = spawnSync(process.execPath, [
        path.join(__dirname, '..', '..', '.build', 'app', 'src', 'cli', 'main.js'), 'run', '--request', requestPath,
    ], { encoding: 'utf8' });
    const result = JSON.parse(cli.stdout);
    assert.equal(cli.status, 0, cli.stdout || cli.stderr);
    const completed = JSON.parse(fs.readFileSync(path.join(pack, 'Completed', 'data', 'Actors.json'), 'utf8'));
    assert.equal(completed[1].name, '앨리스');
    assert.equal(result.stats.patched, 1);
    assert.equal(result.stats.dictionary.selected, 1);
});

test('recover rebuilds an RPG manifest from extracted mappings and current text', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-rpg-manifest-recover-'));
    const pack = path.join(root, 'translated-pack');
    fs.mkdirSync(path.join(pack, 'Backup'), { recursive: true });
    fs.mkdirSync(path.join(pack, 'Extract'), { recursive: true });
    const actors = [null, { id: 1, name: 'Alice', classId: 0 }];
    fs.writeFileSync(path.join(pack, 'Backup', 'Actors.json'), JSON.stringify(actors));
    fs.writeFileSync(path.join(pack, 'Extract', 'Actors.txt'), '앨리스\n');
    const originalManifest = {
        schemaVersion: 1, format: 'rpgmv', entries: [{
            id: 'Actors.json#1.name', sourceFile: 'Backup/Actors.json', dataPath: '1.name', extractFile: 'Actors.txt',
            lineStart: 0, lineEnd: 1, hash: crypto.createHash('sha256').update('Alice').digest('hex'),
            encoding: 'utf8', nullTerminated: false, mv: { originFile: 'Actors.json' },
        }],
    };
    fs.writeFileSync(path.join(pack, 'Extract', 'manifest.json'), JSON.stringify(originalManifest));
    require('../../.build/app/src/js/rpgmv/edtool.js').write(pack, { main: {
        'Actors.json': { data: { '0': { origin: 'Actors.json', originText: 'Alice', val: '1.name', m: 1 } } },
    } });
    const invoke = (name, options) => {
        const requestPath = path.join(root, `${name}.json`);
        fs.writeFileSync(requestPath, JSON.stringify({
            schemaVersion: 2, operation: 'recover', format: 'auto', projectPath: pack,
            profile: 'standard', options, patches: [],
        }));
        const cli = spawnSync(process.execPath, [
            path.join(__dirname, '..', '..', '.build', 'app', 'src', 'cli', 'main.js'), 'run', '--request', requestPath,
        ], { encoding: 'utf8' });
        return { cli, result: JSON.parse(cli.stdout) };
    };
    const manifestPath = path.join(pack, 'Extract', 'manifest.json');
    const originalRaw = fs.readFileSync(manifestPath);
    let response = invoke('recover-dry-run', { dryRun: true, conflictPolicy: 'fail-if-present' });
    assert.equal(response.cli.status, 0, response.cli.stdout || response.cli.stderr);
    assert.equal(response.result.stats.dryRun, true);
    assert.equal(response.result.stats.wouldReplaceExisting, true);
    assert.equal(response.result.stats.wouldConflict, true);
    assert.deepEqual(response.result.artifacts, []);
    assert.ok(fs.readFileSync(manifestPath).equals(originalRaw));
    assert.equal(fs.existsSync(path.join(pack, 'Extract', 'manifest.pre-recovery.json')), false);

    response = invoke('recover-conflict', { conflictPolicy: 'fail-if-present' });
    assert.equal(response.cli.status, 1);
    assert.equal(response.result.error.code, 'E_OUTPUT_CONFLICT');
    assert.ok(fs.readFileSync(manifestPath).equals(originalRaw));
    assert.equal(fs.existsSync(path.join(pack, 'Extract', 'manifest.pre-recovery.json')), false);

    response = invoke('recover', {});
    const { cli, result } = response;
    assert.equal(cli.status, 0, cli.stdout || cli.stderr);
    const recovered = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const preserved = JSON.parse(fs.readFileSync(path.join(pack, 'Extract', 'manifest.pre-recovery.json'), 'utf8'));
    assert.equal(recovered.entries[0].hash, crypto.createHash('sha256').update('앨리스').digest('hex'));
    assert.deepEqual(preserved, originalManifest);
    assert.equal(result.stats.entries, 1);
    assert.equal(result.stats.hashesUpdated, 1);
});

test('apply does not write extraction-only comment markers into RPG JSON', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-rpg-comment-apply-'));
    const pack = path.join(root, 'translated-pack');
    fs.mkdirSync(path.join(pack, 'Backup'), { recursive: true });
    fs.mkdirSync(path.join(pack, 'Extract'), { recursive: true });
    fs.writeFileSync(path.join(pack, 'Backup', 'System.json'), JSON.stringify({ gameTitle: 'Alice' }));
    fs.writeFileSync(path.join(pack, 'Extract', 'System.txt'), 'Alice\n---\n');
    fs.writeFileSync(path.join(pack, 'Extract', 'manifest.json'), JSON.stringify({
        schemaVersion: 1, format: 'rpgmv', entries: [{
            id: 'System.json#gameTitle', sourceFile: 'Backup/System.json', dataPath: 'gameTitle', extractFile: 'System.txt',
            lineStart: 0, lineEnd: 1, hash: crypto.createHash('sha256').update('Alice').digest('hex'),
            encoding: 'utf8', nullTerminated: false, mv: { originFile: 'System.json' },
        }],
    }));
    require('../../.build/app/src/js/rpgmv/edtool.js').write(pack, { main: {
        'System.json': { data: {
            '0': { origin: 'System.json', originText: 'Alice', val: 'gameTitle', m: 1 },
            '1': { origin: 'System.json', originText: '---', val: 'comment_1', m: 2, conf: { isComment: true } },
        } },
    } });
    const requestPath = path.join(root, 'apply.json');
    fs.writeFileSync(requestPath, JSON.stringify({
        schemaVersion: 2, operation: 'apply', format: 'auto', projectPath: pack,
        profile: 'standard', options: {}, patches: [],
    }));
    const cli = spawnSync(process.execPath, [
        path.join(__dirname, '..', '..', '.build', 'app', 'src', 'cli', 'main.js'), 'run', '--request', requestPath,
    ], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stdout || cli.stderr);
    const completed = JSON.parse(fs.readFileSync(path.join(pack, 'Completed', 'data', 'System.json'), 'utf8'));
    assert.equal(completed.gameTitle, 'Alice');
    assert.equal(Object.hasOwn(completed, 'comment_1'), false);
});

test('verify exposes Wolf binary mapping failures in JSON scores and the human summary', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-wolf-verify-'));
    const game = path.join(root, 'game');
    const data = path.join(game, 'Data');
    const extract = path.join(data, '_Extract');
    fs.mkdirSync(extract, { recursive: true });
    const source = Buffer.alloc(14);
    source.writeUInt32LE(7, 4);
    Buffer.from('hello\0').copy(source, 8);
    fs.writeFileSync(path.join(data, 'Map001.mps'), source);
    fs.writeFileSync(path.join(extract, 'Map001.txt'), 'hello\n');
    fs.writeFileSync(path.join(extract, '.extracteddata'), '{}');
    fs.writeFileSync(path.join(extract, 'manifest.json'), JSON.stringify({
        schemaVersion: 1,
        format: 'wolf',
        entries: [{
            id: 'Map001.mps#0', sourceFile: 'Map001.mps', extractFile: 'Map001.txt',
            encoding: 'utf8', nullTerminated: true,
            hash: crypto.createHash('sha256').update('hello').digest('hex'),
            wolf: { pos1: 4, pos2: 8, pos3: 14, len: 6 },
        }],
    }));
    const requestPath = path.join(root, 'verify.json');
    fs.writeFileSync(requestPath, JSON.stringify({
        schemaVersion: 2, operation: 'verify', format: 'auto', projectPath: game,
        profile: 'standard', options: { humanSummary: true }, patches: [],
    }));
    let stdout = '';
    let stderr = '';
    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
    process.stderr.write = (chunk) => { stderr += String(chunk); return true; };
    let status;
    try { status = await runAgent(['run', '--request', requestPath]); } finally {
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
    }
    const result = JSON.parse(stdout);
    assert.equal(status, 1);
    assert.equal(result.validation.profile, 'wolf');
    assert.equal(result.validation.invalidEntries, 1);
    assert.ok(result.validation.issues.some((issue) => issue.code === 'WOLF_LENGTH_PREFIX_MISMATCH'));
    assert.equal(result.scores.mappingIntegrity, 0);
    assert.match(stderr, /validation=wolf.*invalid=1/);
});

test('verify reports healthy Tyrano KS and TJS structure even before extraction support', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-tyrano-verify-'));
    const game = path.join(root, 'game');
    fs.mkdirSync(path.join(game, 'data', 'scenario'), { recursive: true });
    fs.mkdirSync(path.join(game, 'data', 'system'), { recursive: true });
    fs.writeFileSync(path.join(game, 'data', 'scenario', 'first.ks'), '[if exp="true"]\n본문\n[endif]\n');
    fs.writeFileSync(path.join(game, 'data', 'system', 'Config.tjs'), 'function setup() { return true; }\n');
    const requestPath = path.join(root, 'verify.json');
    fs.writeFileSync(requestPath, JSON.stringify({
        schemaVersion: 2, operation: 'verify', format: 'auto', projectPath: game,
        profile: 'standard', options: { humanSummary: true }, patches: [],
    }));
    let stdout = '';
    let stderr = '';
    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
    process.stderr.write = (chunk) => { stderr += String(chunk); return true; };
    let status;
    try { status = await runAgent(['run', '--request', requestPath]); } finally {
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
    }
    const result = JSON.parse(stdout);
    assert.equal(status, 1);
    assert.equal(result.format, 'tyrano');
    assert.equal(result.validation.profile, 'tyrano');
    assert.equal(result.validation.ok, true, JSON.stringify(result.validation.issues));
    assert.equal(result.validation.filesChecked, 2);
    assert.equal(result.validation.tokenErrors, 0);
    assert.equal(result.scores.mappingIntegrity, 100);
    assert.match(stderr, /validation=tyrano.*files=2/);
});

test('extracts a nested MZ ASAR into a sibling working directory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-extract-'));
    const source = path.join(root, 'source');
    const game = path.join(root, 'game');
    const archive = path.join(game, 'resources', 'app.asar');
    const output = path.join(root, 'game-working');
    fs.mkdirSync(path.join(source, 'project', 'data'), { recursive: true });
    fs.mkdirSync(path.join(source, 'project', 'js'), { recursive: true });
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.writeFileSync(path.join(source, 'project', 'data', 'Actors.json'), JSON.stringify([null, { name: 'Alice', profile: 'Hello' }]));
    fs.writeFileSync(path.join(source, 'project', 'js', 'rmmz_core.js'), '');
    await asar.createPackage(source, archive);
    const requestPath = path.join(root, 'request.json');
    fs.writeFileSync(requestPath, JSON.stringify({ schemaVersion: 2, operation: 'extract', format: 'auto', projectPath: game, outputPath: output, profile: 'standard', options: {}, patches: [] }));
    let stdout = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
    let status;
    try { status = await runAgent(['run', '--request', requestPath]); } finally { process.stdout.write = originalWrite; }
    const json = JSON.parse(stdout);
    assert.equal(status, 0);
    assert.equal(json.ok, true);
    assert.equal(json.container.type, 'electron-asar');
    assert.ok(fs.existsSync(path.join(output, 'project', 'data', 'Extract', 'manifest.json')));

    const directRequestPath = path.join(root, 'direct-request.json');
    fs.writeFileSync(directRequestPath, JSON.stringify({ schemaVersion: 2, operation: 'extract', format: 'auto', projectPath: archive, profile: 'standard', options: {}, patches: [] }));
    stdout = '';
    process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
    try { status = await runAgent(['run', '--request', directRequestPath]); } finally { process.stdout.write = originalWrite; }
    const directJson = JSON.parse(stdout);
    assert.equal(status, 0);
    assert.equal(directJson.ok, true);
    assert.ok(fs.existsSync(path.join(root, 'game_tsukuru', 'project', 'data', 'Extract', 'manifest.json')));
});


test('refuses raw ASAR apply and patch without touching the original archive', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-guard-'));
    const source = path.join(root, 'source');
    const game = path.join(root, 'game');
    const archive = path.join(game, 'resources', 'app.asar');
    fs.mkdirSync(path.join(source, 'project', 'data'), { recursive: true });
    fs.mkdirSync(path.join(source, 'project', 'js'), { recursive: true });
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.writeFileSync(path.join(source, 'project', 'data', 'Actors.json'), '[]');
    fs.writeFileSync(path.join(source, 'project', 'js', 'rmmz_core.js'), '');
    await asar.createPackage(source, archive);
    const hash = () => require('node:crypto').createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    const before = hash();
    for (const operation of ['apply', 'patch']) {
        const requestPath = path.join(root, `${operation}.json`);
        const patches = operation === 'patch' ? [{ id: 'unused', expectedHash: '0'.repeat(64), text: '' }] : [];
        fs.writeFileSync(requestPath, JSON.stringify({ schemaVersion: 2, operation, format: 'auto', projectPath: game, profile: 'standard', options: {}, patches }));
        let stdout = '';
        const originalWrite = process.stdout.write;
        process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
        let status;
        try { status = await runAgent(['run', '--request', requestPath]); } finally { process.stdout.write = originalWrite; }
        const json = JSON.parse(stdout);
        assert.equal(status, 1);
        assert.equal(json.error.code, 'E_NOT_IMPLEMENTED');
        assert.equal(hash(), before);
    }
});

test('applies a patched ASAR working directory into a verified runnable copy', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-repack-'));
    const source = path.join(root, 'source');
    const game = path.join(root, 'game');
    const working = path.join(root, 'game-working');
    const output = path.join(root, 'game-translated');
    const archive = path.join(game, 'resources', 'app.asar');
    const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

    fs.mkdirSync(path.join(source, 'project', 'data'), { recursive: true });
    fs.mkdirSync(path.join(source, 'project', 'js'), { recursive: true });
    fs.mkdirSync(path.join(game, 'resources', 'app.asar.unpacked'), { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ main: 'project/index.html' }));
    fs.writeFileSync(path.join(source, 'project', 'data', 'Actors.json'), JSON.stringify([null, { name: 'Alice', profile: 'Hello' }]));
    fs.writeFileSync(path.join(source, 'project', 'data', 'System.json'), JSON.stringify({ encryptionKey: '' }));
    fs.writeFileSync(path.join(source, 'project', 'js', 'rmmz_core.js'), '// protected');
    fs.copyFileSync(process.execPath, path.join(game, 'Game.exe'));
    const launcherHash = hash(path.join(game, 'Game.exe'));
    fs.writeFileSync(path.join(game, 'resources', 'license.txt'), 'keep me');
    fs.writeFileSync(path.join(game, 'resources', 'app.asar.unpacked', 'native.bin'), 'native');
    await asar.createPackage(source, archive);
    const originalHash = hash(archive);

    const extractRequest = path.join(root, 'extract.json');
    fs.writeFileSync(extractRequest, JSON.stringify({
        schemaVersion: 2, operation: 'extract', format: 'auto', projectPath: game,
        outputPath: working, profile: 'standard', options: {}, patches: [],
    }));
    let stdout = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
    let status;
    try { status = await runAgent(['run', '--request', extractRequest]); } finally { process.stdout.write = originalWrite; }
    assert.equal(status, 0);
    assert.ok(fs.existsSync(path.join(working, '.tsukuru-container.json')));

    const extractRoot = path.join(working, 'project', 'data', 'Extract');
    const manifest = JSON.parse(fs.readFileSync(path.join(extractRoot, 'manifest.json'), 'utf8'));
    const nameEntry = manifest.entries.find((entry) => entry.id.includes('name'));
    assert.ok(nameEntry, 'Actors.json name entry must exist');
    const patchRequest = path.join(root, 'patch.json');
    fs.writeFileSync(patchRequest, JSON.stringify({
        schemaVersion: 2, operation: 'patch', format: 'auto', projectPath: working,
        profile: 'standard', options: {},
        patches: [{ id: nameEntry.id, expectedHash: nameEntry.hash, text: '앨리스' }],
    }));
    stdout = '';
    process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
    try { status = await runAgent(['run', '--request', patchRequest]); } finally { process.stdout.write = originalWrite; }
    assert.equal(status, 0);

    const applyRequest = path.join(root, 'apply.json');
    fs.writeFileSync(applyRequest, JSON.stringify({
        schemaVersion: 2, operation: 'apply', format: 'auto', projectPath: working,
        outputPath: output, profile: 'standard',
        options: { containerSourcePath: game, launchProbe: true, launchTimeoutMs: 1000 }, patches: [],
    }));
    stdout = '';
    process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
    try { status = await runAgent(['run', '--request', applyRequest]); } finally { process.stdout.write = originalWrite; }
    const result = JSON.parse(stdout);
    assert.equal(status, 0, JSON.stringify(result));
    assert.equal(result.ok, true);
    assert.equal(result.runtime.blocked, false);
    assert.equal(result.runtime.fuses.status, 'unavailable');
    assert.match(result.runtime.launchProbe.status, /^(running|exited-ok)$/);

    const outputArchive = path.join(output, 'resources', 'app.asar');
    assert.ok(fs.existsSync(outputArchive));
    assert.equal(hash(archive), originalHash, 'original app.asar must remain unchanged');
    assert.equal(hash(path.join(output, 'Game.exe')), launcherHash);
    assert.equal(fs.readFileSync(path.join(output, 'resources', 'license.txt'), 'utf8'), 'keep me');
    assert.equal(fs.readFileSync(path.join(output, 'resources', 'app.asar.unpacked', 'native.bin'), 'utf8'), 'native');

    const actors = JSON.parse(asar.extractFile(outputArchive, path.join('project', 'data', 'Actors.json')).toString('utf8'));
    assert.equal(actors[1].name, '앨리스');
    const packedEntries = asar.listPackage(outputArchive).map((entry) => entry.replaceAll('\\', '/'));
    assert.ok(!packedEntries.some((entry) => /\/(Extract|Backup|Completed)(\/|$)/.test(entry)));
    assert.ok(!packedEntries.some((entry) => entry.endsWith('/.extracteddata')));
    assert.ok(!packedEntries.some((entry) => entry.endsWith('/.tsukuru-container.json')));
    assert.ok(result.artifacts.some((artifact) => path.resolve(artifact) === path.resolve(outputArchive)));
});

test('atomically imports an RPG translation dictionary while repacking an ASAR working directory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-asar-dictionary-'));
    const source = path.join(root, 'source');
    const game = path.join(root, 'game');
    const working = path.join(root, 'working');
    const output = path.join(root, 'translated-game');
    const translations = path.join(root, 'translations');
    const emptyTranslations = path.join(root, 'empty-translations');
    const preservedOutput = path.join(root, 'preserved-output');
    const archive = path.join(game, 'resources', 'app.asar');
    const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    fs.mkdirSync(path.join(source, 'project', 'data'), { recursive: true });
    fs.mkdirSync(path.join(source, 'project', 'js'), { recursive: true });
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.mkdirSync(translations);
    fs.mkdirSync(emptyTranslations);
    fs.mkdirSync(preservedOutput);
    fs.writeFileSync(path.join(preservedOutput, 'sentinel.txt'), 'preserve');
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ main: 'project/index.html' }));
    fs.writeFileSync(path.join(source, 'project', 'data', 'Actors.json'), JSON.stringify([
        null,
        { id: 1, name: 'Alice', profile: 'Hello' },
    ]));
    fs.writeFileSync(path.join(source, 'project', 'data', 'System.json'), JSON.stringify({ encryptionKey: '' }));
    fs.writeFileSync(path.join(source, 'project', 'js', 'rmmz_core.js'), '// protected');
    await asar.createPackage(source, archive);
    const sourceHash = hash(archive);

    const invoke = async (name, body) => {
        const requestPath = path.join(root, `${name}.json`);
        fs.writeFileSync(requestPath, JSON.stringify(body));
        let stdout = '';
        const originalWrite = process.stdout.write;
        process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
        let status;
        try { status = await runAgent(['run', '--request', requestPath]); } finally {
            process.stdout.write = originalWrite;
        }
        return { status, result: JSON.parse(stdout) };
    };

    let response = await invoke('extract-dictionary', {
        schemaVersion: 2, operation: 'extract', format: 'auto', projectPath: game,
        outputPath: working, profile: 'standard', options: {}, patches: [],
    });
    assert.equal(response.status, 0, JSON.stringify(response.result));
    const extractRoot = path.join(working, 'project', 'data', 'Extract');
    const manifest = JSON.parse(fs.readFileSync(path.join(extractRoot, 'manifest.json'), 'utf8'));
    const nameEntry = manifest.entries.find((entry) => entry.id.includes('.name'));
    assert.ok(nameEntry, 'Actors.json name entry must exist');
    const workingExtractBefore = fs.readFileSync(path.join(extractRoot, nameEntry.extractFile));
    fs.writeFileSync(path.join(translations, 'Actors_trans.json'), JSON.stringify({
        [nameEntry.id]: '앨리스',
    }));

    response = await invoke('apply-dictionary', {
        schemaVersion: 2, operation: 'apply', format: 'auto', projectPath: working,
        outputPath: output, profile: 'standard',
        options: { containerSourcePath: game, translationDirectory: translations }, patches: [],
    });
    assert.equal(response.status, 0, JSON.stringify(response.result));
    assert.equal(response.result.stats.patched, 1);
    assert.equal(response.result.stats.dictionary.selected, 1);
    const outputArchive = path.join(output, 'resources', 'app.asar');
    const actors = JSON.parse(asar.extractFile(outputArchive, path.join('project', 'data', 'Actors.json')).toString('utf8'));
    assert.equal(actors[1].name, '앨리스');
    assert.ok(fs.readFileSync(path.join(extractRoot, nameEntry.extractFile)).equals(workingExtractBefore));
    assert.equal(hash(archive), sourceHash);

    fs.writeFileSync(path.join(emptyTranslations, 'Actors_trans.json'), JSON.stringify({
        'Actors.json#999.name': 'manifest에 없음',
    }));
    response = await invoke('apply-empty-dictionary', {
        schemaVersion: 2, operation: 'apply', format: 'auto', projectPath: working,
        outputPath: preservedOutput, profile: 'standard',
        options: {
            containerSourcePath: game,
            translationDirectory: emptyTranslations,
            force: true,
        },
        patches: [],
    });
    assert.equal(response.status, 1);
    assert.equal(response.result.error.code, 'E_PATCH_EMPTY');
    assert.equal(fs.readFileSync(path.join(preservedOutput, 'sentinel.txt'), 'utf8'), 'preserve');
    assert.ok(fs.readFileSync(path.join(extractRoot, nameEntry.extractFile)).equals(workingExtractBefore));
    assert.equal(hash(archive), sourceHash);
});

test('round-trips Electron GDevelop while preserving runtime, ASAR unpacked files, and external resources', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-gdevelop-asar-'));
    const source = path.join(root, 'source');
    const game = path.join(root, 'game');
    const working = path.join(root, 'working');
    const output = path.join(root, 'translated-game');
    const archive = path.join(game, 'resources', 'app.asar');
    const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    fs.mkdirSync(path.join(source, 'gdjs'), { recursive: true });
    fs.mkdirSync(path.join(source, 'native'), { recursive: true });
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'fixture', main: 'index.html' }));
    fs.writeFileSync(path.join(source, 'index.html'), '<script src="gdjs/runtime.js"></script><script src="code0.js"></script><script src="data.js"></script>');
    fs.writeFileSync(path.join(source, 'gdjs', 'runtime.js'), '/* protected GDevelop runtime */');
    fs.writeFileSync(
        path.join(source, 'code0.js'),
        'for (var i = 0; i < gdjs.SceneCode.GDDialogueObjects1.length; ++i) { gdjs.SceneCode.GDDialogueObjects1[i].setString("Code hello"); }',
    );
    fs.writeFileSync(path.join(source, 'data.js'), `gdjs.projectData = ${JSON.stringify({
        layouts: [{ name: 'Scene', objects: [{ type: 'TextObject::Text', name: 'Dialogue', string: 'Hello' }] }],
    })};\ngdjs.runtimeGameOptions = {};\n`);
    fs.writeFileSync(path.join(source, 'native', 'addon.node'), 'native-addon');
    fs.writeFileSync(path.join(game, 'resources', 'extra-resource.dat'), 'external-resource');
    const stream = await asar.createPackageWithOptions(source, archive, { unpack: '*.node' });
    if (!stream.writableFinished) await finished(stream);
    const originalArchiveHash = hash(archive);
    const runtimeHash = hash(path.join(source, 'gdjs', 'runtime.js'));
    const eventHash = hash(path.join(source, 'code0.js'));

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

    let response = await invoke('gdevelop-asar-extract', request('extract', game, {
        outputPath: working,
        options: { experimentalGdevelopCodeStrings: true },
    }));
    assert.equal(response.status, 0, JSON.stringify(response.result));
    assert.equal(response.result.container.type, 'electron-asar');
    assert.equal(response.result.engine.type, 'gdevelop');
    const manifest = JSON.parse(fs.readFileSync(path.join(working, '_Extract', 'manifest.json'), 'utf8'));
    const dataEntry = manifest.entries.find((entry) => entry.gdevelop?.kind === 'project-data');
    const codeEntry = manifest.entries.find((entry) => entry.gdevelop?.kind === 'code-literal');
    assert.equal(response.result.stats.codeEntries, 1);
    response = await invoke('gdevelop-asar-patch', request('patch', working, {
        patches: [
            { id: dataEntry.id, expectedHash: dataEntry.hash, text: 'Electron 번역' },
            { id: codeEntry.id, expectedHash: codeEntry.hash, text: 'Electron 코드 번역' },
        ],
    }));
    assert.equal(response.status, 0, JSON.stringify(response.result));
    response = await invoke('gdevelop-asar-apply', request('apply', working, {
        outputPath: output,
        options: { containerSourcePath: game, experimentalGdevelopCodeStrings: true },
    }));
    assert.equal(response.status, 0, JSON.stringify(response.result));
    assert.equal(response.result.validation.ok, true);
    assert.equal(response.result.change.protectedScriptDamage, 0);
    assert.equal(hash(archive), originalArchiveHash);
    assert.equal(fs.readFileSync(path.join(output, 'resources', 'extra-resource.dat'), 'utf8'), 'external-resource');
    assert.equal(fs.readFileSync(path.join(output, 'resources', 'app.asar.unpacked', 'native', 'addon.node'), 'utf8'), 'native-addon');

    const outputArchive = path.join(output, 'resources', 'app.asar');
    assert.equal(asar.statFile(outputArchive, path.join('native', 'addon.node'), false).unpacked, true);
    assert.equal(crypto.createHash('sha256').update(asar.extractFile(outputArchive, path.join('gdjs', 'runtime.js'))).digest('hex'), runtimeHash);
    const outputCode = asar.extractFile(outputArchive, 'code0.js').toString('utf8');
    assert.match(outputCode, /setString\("Electron 코드 번역"\)/);
    assert.notEqual(crypto.createHash('sha256').update(outputCode).digest('hex'), eventHash);
    const outputData = asar.extractFile(outputArchive, 'data.js').toString('utf8');
    const marker = 'gdjs.projectData = ';
    const start = outputData.indexOf(marker) + marker.length;
    const end = outputData.indexOf(';\ngdjs.runtimeGameOptions', start);
    assert.equal(JSON.parse(outputData.slice(start, end)).layouts[0].objects[0].string, 'Electron 번역');

    fs.writeFileSync(path.join(working, 'code0.js'), '/* tampered generated events */');
    const blockedOutput = path.join(root, 'blocked-game');
    response = await invoke('gdevelop-asar-protected-block', request('apply', working, {
        outputPath: blockedOutput,
        options: { containerSourcePath: game, experimentalGdevelopCodeStrings: true },
    }));
    assert.equal(response.status, 1);
    assert.equal(response.result.error.code, 'E_VERIFY_FAILED');
    assert.equal(fs.existsSync(blockedOutput), false);
    assert.equal(hash(archive), originalArchiveHash);
});

test('malformed-metadata Electron ASAR extraction is diagnostic but repack requires opt-in', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-malformed-asar-'));
    const source = path.join(root, 'source');
    const cleanArchive = path.join(root, 'clean.asar');
    const game = path.join(root, 'game');
    const archive = path.join(game, 'resources', 'app.asar');
    const working = path.join(root, 'working');
    const blockedOutput = path.join(root, 'blocked-output');
    const optedOutput = path.join(root, 'opted-output');
    fs.mkdirSync(path.join(source, 'gdjs'), { recursive: true });
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ main: 'index.html' }));
    fs.writeFileSync(path.join(source, 'index.html'), '<script src="gdjs/runtime.js"></script><script src="data.js"></script>');
    fs.writeFileSync(path.join(source, 'gdjs', 'runtime.js'), '/* runtime */');
    fs.writeFileSync(path.join(source, 'data.js'), `gdjs.projectData = ${JSON.stringify({
        layouts: [{ name: 'Scene', objects: [{ type: 'TextObject::Text', name: 'Dialogue', string: 'Hello' }] }],
    })};\ngdjs.runtimeGameOptions = {};\n`);
    await asar.createPackage(source, cleanArchive);
    addInvalidAsarEntry(cleanArchive, archive);
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

    let response = await invoke('malformed-extract', request('extract', game, { outputPath: working }));
    assert.equal(response.status, 0, JSON.stringify(response.result));
    assert.equal(response.result.container.invalidEntryCount, 1);
    assert.ok(response.result.warnings.some((warning) => warning.includes('비정상')));

    response = await invoke('malformed-apply-blocked', request('apply', working, {
        outputPath: blockedOutput,
        options: { containerSourcePath: game },
    }));
    assert.equal(response.status, 1);
    assert.equal(response.result.error.code, 'E_EXPERIMENTAL_FEATURE_DISABLED');
    assert.equal(fs.existsSync(blockedOutput), false);

    response = await invoke('malformed-apply-opted', request('apply', working, {
        outputPath: optedOutput,
        options: { containerSourcePath: game, experimentalMalformedAsarRepack: true },
    }));
    assert.equal(response.status, 0, JSON.stringify(response.result));
    assert.equal(response.result.container.invalidEntryCount, 0);
    assert.ok(response.result.warnings.some((warning) => warning.includes('1개')));
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), sourceHash);
});

test('ASAR apply rejects changed sources, protected scripts, unsafe outputs, and corrupt provenance', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-v25-safety-'));
    const source = path.join(root, 'source');
    const game = path.join(root, 'game');
    const working = path.join(root, 'working');
    const archive = path.join(game, 'resources', 'app.asar');
    fs.mkdirSync(path.join(source, 'project', 'data'), { recursive: true });
    fs.mkdirSync(path.join(source, 'project', 'js'), { recursive: true });
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.writeFileSync(path.join(source, 'project', 'data', 'Actors.json'), JSON.stringify([null, { name: 'Alice' }]));
    fs.writeFileSync(path.join(source, 'project', 'data', 'System.json'), JSON.stringify({ encryptionKey: '' }));
    fs.writeFileSync(path.join(source, 'project', 'js', 'rmmz_core.js'), '// protected');
    await asar.createPackage(source, archive);
    const originalHash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');

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

    let response = await invoke('extract-safety', {
        schemaVersion: 2, operation: 'extract', format: 'auto', projectPath: game,
        outputPath: working, profile: 'standard', options: {}, patches: [],
    });
    assert.equal(response.status, 0);

    const insideOutput = path.join(game, 'translated');
    response = await invoke('unsafe-output', {
        schemaVersion: 2, operation: 'apply', format: 'auto', projectPath: working,
        outputPath: insideOutput, profile: 'standard',
        options: { containerSourcePath: game, force: true }, patches: [],
    });
    assert.equal(response.result.error.code, 'E_OUTPUT_CONFLICT');
    assert.ok(fs.existsSync(archive));
    assert.ok(!fs.existsSync(insideOutput));

    const existingOutput = path.join(root, 'existing-output');
    fs.mkdirSync(existingOutput);
    fs.writeFileSync(path.join(existingOutput, 'sentinel.txt'), 'preserve');
    response = await invoke('existing-output', {
        schemaVersion: 2, operation: 'apply', format: 'auto', projectPath: working,
        outputPath: existingOutput, profile: 'standard',
        options: { containerSourcePath: game }, patches: [],
    });
    assert.equal(response.result.error.code, 'E_OUTPUT_CONFLICT');
    assert.equal(fs.readFileSync(path.join(existingOutput, 'sentinel.txt'), 'utf8'), 'preserve');

    const otherSource = path.join(root, 'other-source');
    const otherGame = path.join(root, 'other-game');
    const otherArchive = path.join(otherGame, 'resources', 'app.asar');
    fs.cpSync(source, otherSource, { recursive: true });
    fs.writeFileSync(path.join(otherSource, 'project', 'data', 'Actors.json'), JSON.stringify([null, { name: 'Mallory' }]));
    fs.mkdirSync(path.dirname(otherArchive), { recursive: true });
    await asar.createPackage(otherSource, otherArchive);
    const mismatchOutput = path.join(root, 'mismatch-output');
    response = await invoke('mismatched-source', {
        schemaVersion: 2, operation: 'apply', format: 'auto', projectPath: working,
        outputPath: mismatchOutput, profile: 'standard',
        options: { containerSourcePath: otherGame }, patches: [],
    });
    assert.equal(response.result.error.code, 'E_SOURCE_CHANGED');
    assert.ok(!fs.existsSync(mismatchOutput));

    fs.writeFileSync(path.join(working, 'project', 'js', 'rmmz_core.js'), '// tampered');
    const protectedOutput = path.join(root, 'protected-output');
    response = await invoke('protected-script', {
        schemaVersion: 2, operation: 'apply', format: 'auto', projectPath: working,
        outputPath: protectedOutput, profile: 'standard',
        options: { containerSourcePath: game }, patches: [],
    });
    assert.equal(response.result.error.code, 'E_VERIFY_FAILED');
    assert.ok(!fs.existsSync(protectedOutput));

    const provenancePath = path.join(working, '.tsukuru-container.json');
    const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
    provenance.archiveFiles[0] = '../escape';
    fs.writeFileSync(provenancePath, JSON.stringify(provenance));
    const corruptOutput = path.join(root, 'corrupt-output');
    response = await invoke('corrupt-provenance', {
        schemaVersion: 2, operation: 'apply', format: 'auto', projectPath: working,
        outputPath: corruptOutput, profile: 'standard',
        options: { containerSourcePath: game }, patches: [],
    });
    assert.equal(response.result.error.code, 'E_CONTAINER_PROVENANCE_INVALID');
    assert.ok(!fs.existsSync(corruptOutput));
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), originalHash);
});
