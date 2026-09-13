const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { RpgMakerService } = require('../../.build/app/src/js/rpgmv/RpgMakerService.js');
const { createOperationContext, createRpgState } = require('../../.build/app/src/core/context.js');
const { CapturingProgressSink, CapturingLogger } = require('../../.build/app/src/core/sinks.js');
const { settings } = require('../../.build/app/src/js/rpgmv/datas.js');
const { executeAgentRequest } = require('../../.build/app/src/cli/run.js');
const { applyPatches } = require('../../.build/app/src/cli/patcher.js');

const FIXTURE = path.resolve(__dirname, '../../../fixtures/rpgmv-basic');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function snapshot(root) {
  const result = {};
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file);
      else result[path.relative(root, file)] = hash(fs.readFileSync(file));
    }
  }
  walk(root);
  return result;
}

async function fixture(t, names = ['Source A', 'Source B'], prepare, rpgSettings = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-rpg-validation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(FIXTURE, root, { recursive: true });
  const data = path.join(root, 'www/data');
  const actorsPath = path.join(data, 'Actors.json');
  const actors = JSON.parse(fs.readFileSync(actorsPath, 'utf8'));
  actors[1].name = names[0];
  actors[2].name = names[1];
  fs.writeFileSync(actorsPath, JSON.stringify(actors));
  if (prepare) prepare(data);
  const context = createOperationContext(new CapturingProgressSink(), new CapturingLogger(), {
    rpg: createRpgState({ ...settings, ...rpgSettings }),
  });
  const service = new RpgMakerService(context);
  await service.extract({ dir: data, ext_note: true, ...rpgSettings.extractOptions });
  const extract = path.join(data, 'Extract');
  const manifest = JSON.parse(fs.readFileSync(path.join(extract, 'manifest.json'), 'utf8'));
  return { root, data, extract, manifest, service, context };
}

function dictionary(f) {
  const dir = path.join(f.root, 'translations');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'Actors_trans.json'), JSON.stringify({ 'Actors.json#1.name': '번역 A' }));
  return dir;
}

function applyRequest(f, translations, output) {
  return { schemaVersion: 2, operation: 'apply', format: 'rpgmv', projectPath: f.data,
    ...(output ? { outputPath: output } : {}), profile: 'standard',
    options: { translationDirectory: translations, force: true }, patches: [] };
}

function patchFor(f, id, text) {
  const entry = f.manifest.entries.find(e => e.id === id);
  assert.ok(entry, id);
  return { id, expectedHash: entry.hash, text };
}

test('dictionary apply preserves all workspace bytes after a later Backup failure', async t => {
  const f = await fixture(t);
  const translations = dictionary(f);
  fs.mkdirSync(path.join(f.data, 'Completed'));
  fs.writeFileSync(path.join(f.data, 'Completed/sentinel.txt'), 'previous output');
  fs.writeFileSync(path.join(f.data, 'Backup/Actors.json'), '{invalid');
  const before = snapshot(f.root);
  const result = await executeAgentRequest(applyRequest(f, translations));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'E_MAPPING_CORRUPT');
  assert.deepEqual(snapshot(f.root), before);
});

test('dictionary apply rolls back workspace and custom output if final installation fails', async t => {
  const f = await fixture(t);
  const translations = dictionary(f);
  const output = path.join(f.root, 'custom-output');
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'sentinel.txt'), 'previous custom output');
  const before = snapshot(f.root);
  const rename = fs.renameSync;
  let fault = false;
  fs.renameSync = (source, destination) => {
    if (!fault && path.resolve(destination) === output && !String(source).includes('backup') && !String(source).includes('.old-')) {
      fault = true;
      const error = new Error('injected output install failure');
      error.code = 'EIO';
      throw error;
    }
    return rename(source, destination);
  };
  let result;
  try { result = await executeAgentRequest(applyRequest(f, translations, output)); }
  finally { fs.renameSync = rename; }
  assert.equal(fault, true);
  assert.equal(result.ok, false);
  assert.deepEqual(snapshot(f.root), before);
});

test('dictionary success commits workspace and custom output together while preserving source and Backup', async t => {
  const f = await fixture(t);
  const translations = dictionary(f);
  const output = path.join(f.root, 'custom-output');
  const original = hash(fs.readFileSync(path.join(f.data, 'Actors.json')));
  const backup = snapshot(path.join(f.data, 'Backup'));
  const result = await executeAgentRequest(applyRequest(f, translations, output));
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.stats.patched, 1);
  assert.equal(result.stats.dictionary.selected, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'data/Actors.json'), 'utf8'))[1].name, '번역 A');
  assert.ok(fs.readFileSync(path.join(f.extract, 'Actors.txt'), 'utf8').includes('번역 A'));
  assert.equal(hash(fs.readFileSync(path.join(f.data, 'Actors.json'))), original);
  assert.deepEqual(snapshot(path.join(f.data, 'Backup')), backup);
});

test('cancellation after dictionary preparation leaves workspace and old output intact', async t => {
  const f = await fixture(t);
  const translations = dictionary(f);
  const controller = new AbortController();
  const originalApply = RpgMakerService.prototype.apply;
  const before = snapshot(f.root);
  RpgMakerService.prototype.apply = function (...args) {
    controller.abort();
    return originalApply.apply(this, args);
  };
  let result;
  try { result = await executeAgentRequest(applyRequest(f, translations), { signal: controller.signal }); }
  finally { RpgMakerService.prototype.apply = originalApply; }
  assert.equal(result.ok, false);
  assert.match(result.error.code, /CANCELLED/);
  assert.deepEqual(snapshot(f.root), before);
});

const damagedTranslations = [
  ['\\FF[1]原文', '\\F[1]번역'],
  ['\\F[1]原文', '\\\\F[1]번역'],
  ['\\V[1]原文', '\\V[2]번역'],
  ['%1 {name} 原文', '%2 {name} 번역'],
  ['Original', ''],
  ['Original', '  \t'],
  ['Original', '번역\uFFFD'],
];

test('RPG direct patch rejects introduced token, placeholder, blank and replacement-character damage before writing', async t => {
  for (const [source, translated] of damagedTranslations) {
    const f = await fixture(t, [source, 'Source B']);
    const before = snapshot(f.root);
    assert.throws(() => applyPatches(f.extract, 'rpgmv', [patchFor(f, 'Actors.json#1.name', translated)]),
      error => error.code === 'E_TRANSLATION_LINT' && error.details.quality.mechanical === 'fail');
    assert.deepEqual(snapshot(f.root), before);
  }
});

test('manual Extract and manifest-free GUI apply share the source-bound lint', async t => {
  for (const [source, translated] of damagedTranslations) {
    const f = await fixture(t, [source, 'Source B']);
    const entry = f.manifest.entries.find(e => e.id === 'Actors.json#1.name');
    const file = path.join(f.extract, entry.extractFile);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines[entry.lineStart] = translated;
    fs.writeFileSync(file, lines.join('\n'));
    fs.unlinkSync(path.join(f.extract, 'manifest.json'));
    const before = snapshot(f.root);
    await assert.rejects(f.service.apply({ dir: f.data }), error => error.code === 'E_TRANSLATION_LINT');
    assert.deepEqual(snapshot(f.root), before);
  }
});

test('RPG lint preserves valid escapes, named placeholder reordering and unchanged source defects', async t => {
  const sources = ['\\FF[1]原文\\\\ %1 {name}', '원문\uFFFD'];
  const f = await fixture(t, sources);
  applyPatches(f.extract, 'rpgmv', [patchFor(f, 'Actors.json#1.name', '{name} %1 \\FF[1]번역\\\\')]);
  const result = await f.service.apply({ dir: f.data });
  assert.equal(result.translationQuality.mechanical, 'pass');
  assert.equal(result.translationQuality.semantics, 'not-run');
  const actors = JSON.parse(fs.readFileSync(path.join(f.data, 'Completed/data/Actors.json'), 'utf8'));
  assert.equal(actors[1].name, '{name} %1 \\FF[1]번역\\\\');
  assert.equal(actors[2].name, sources[1]);
});

test('external message expansion preserves its CSV source and validates expanded control codes', async t => {
  const f = await fixture(t, ['\\M[greeting]', 'Source B'], data => {
    fs.writeFileSync(path.join(data, 'ExternMessage.csv'), 'greeting,"\\FF[1]Original, message"\n');
  }, { ExternMsgJson: false, extractOptions: { exJson: true } });
  const savedCsv = path.join(f.data, 'Backup/ExternMessage.csv');
  assert.equal(fs.readFileSync(savedCsv, 'utf8'), fs.readFileSync(path.join(f.data, 'ExternMessage.csv'), 'utf8'));
  applyPatches(f.extract, 'rpgmv', [patchFor(f, 'Actors.json#1.name', '\\FF[1]번역 메시지')]);
  const result = await f.service.apply({ dir: f.data });
  assert.equal(result.translationQuality.mechanical, 'pass');
  const actors = JSON.parse(fs.readFileSync(path.join(f.data, 'Completed/data/Actors.json'), 'utf8'));
  assert.equal(actors[1].name, '\\FF[1]번역 메시지');
});

test('post-apply readback rejects wrong values and changes outside mapped paths for JSON and YAML', async t => {
  for (const useYaml of [false, true]) for (const field of ['name', 'classId']) {
    const f = await fixture(t);
    applyPatches(f.extract, 'rpgmv', [patchFor(f, 'Actors.json#1.name', '번역 A')]);
    const before = snapshot(f.root);
    const write = fs.writeFileSync;
    let changed = false;
    fs.writeFileSync = (file, data, ...args) => {
      if (String(file).endsWith(useYaml ? 'Actors.json.yaml' : 'Actors.json') && String(file).includes('.tsukuru-stage-')) {
        const yaml = require('js-yaml');
        const value = useYaml ? yaml.load(String(data)) : JSON.parse(String(data));
        value[1][field] = field === 'name' ? 'wrong output' : 999;
        data = useYaml ? yaml.dump(value) : JSON.stringify(value);
        changed = true;
      }
      return write(file, data, ...args);
    };
    try { await assert.rejects(f.service.apply({ dir: f.data, useYaml }), error => error.code === 'E_VERIFY_FAILED'); }
    finally { fs.writeFileSync = write; }
    assert.equal(changed, true);
    assert.deepEqual(snapshot(f.root), before);
  }
});

test('portable partial output receives merged structural validation and baseline reference warnings', async t => {
  const f = await fixture(t, undefined, data => {
    const actorsPath = path.join(data, 'Actors.json');
    const actors = JSON.parse(fs.readFileSync(actorsPath, 'utf8'));
    actors[1].classId = 999;
    fs.writeFileSync(actorsPath, JSON.stringify(actors));
  });
  // This extra Backup file has no extracted strings, but belongs in final structural validation.
  fs.writeFileSync(path.join(f.data, 'Backup/Items.json'), '[null]');
  for (const name of fs.readdirSync(f.data).filter(name => name.endsWith('.json'))) fs.unlinkSync(path.join(f.data, name));
  const result = await f.service.apply({ dir: f.data });
  assert.equal(result.validation.ok, true);
  assert.ok(result.validation.filesChecked >= 5);
  assert.ok(result.validation.issues.some(issue => issue.code.endsWith('_BASELINE') && issue.severity === 'warning'));
  assert.equal(result.translationQuality.semantics, 'not-run');
});

test('legacy instant apply keeps original text unchanged if later asset encryption fails', async t => {
  const f = await fixture(t);
  applyPatches(f.extract, 'rpgmv', [patchFor(f, 'Actors.json#1.name', '번역 A')]);
  fs.mkdirSync(path.join(f.data, 'Extract_img'));
  fs.writeFileSync(path.join(f.data, 'Extract_img/image.png'), 'test image');
  const sys = path.join(f.data, 'System.json');
  const system = JSON.parse(fs.readFileSync(sys, 'utf8'));
  system.encryptionKey = 'invalid';
  fs.writeFileSync(sys, JSON.stringify(system));
  const before = snapshot(f.root);
  await assert.rejects(f.service.apply({ dir: f.data, instantapply: true }), error => error.code === 'E_MAPPING_CORRUPT');
  assert.deepEqual(snapshot(f.root), before);
});

test('plugin and external-message output are parsed back and preserve legitimate translations', async t => {
  for (const kind of ['plugin', 'csv']) {
    const f = await fixture(t, undefined, data => {
      if (kind === 'plugin') {
        fs.mkdirSync(path.join(path.dirname(data), 'js'));
        fs.writeFileSync(path.join(path.dirname(data), 'js/plugins.js'),
          '// fixture\nvar $plugins = [{"name":"Sample","status":true,"description":"info","parameters":{"message":"Original"}}];\n');
      } else fs.writeFileSync(path.join(data, 'ExternMessage.csv'), 'greeting,"Original, message"\n');
    }, { extractOptions: { exJson: true, ext_plugin: kind === 'plugin' } });
    const id = kind === 'plugin' ? 'ext_plugins.json#0.parameters.message' : 'ExternMsgcsv.json#greeting';
    applyPatches(f.extract, 'rpgmv', [patchFor(f, id, '번역, "메시지"\n다음 줄')]);
    const result = await f.service.apply({ dir: f.data });
    assert.equal(result.validation.ok, true);
    const output = path.join(f.data, 'Completed', kind === 'plugin' ? 'js/plugins.js' : 'data/ExternMessage.csv');
    assert.ok(fs.readFileSync(output, 'utf8').includes('번역'));
    const before = snapshot(f.root);
    const writer = fs.writeFileSync;
    const ext = require('../../.build/app/src/js/rpgmv/extract.js');
    const pack = ext.pack_externMsg;
    let tampered = false;
    if (kind === 'plugin') fs.writeFileSync = (file, data, ...args) => {
      if (String(file).endsWith('plugins.js') && String(file).includes('.tsukuru-stage-')) {
        data += '\nglobalThis.unapproved = true;'; tampered = true;
      }
      return writer(file, data, ...args);
    };
    else ext.pack_externMsg = async (file, data) => {
      await pack(file, data);
      writer(file, 'greeting,wrong output\n'); tampered = true;
    };
    try { await assert.rejects(f.service.apply({ dir: f.data }), error => error.code === 'E_VERIFY_FAILED'); }
    finally { fs.writeFileSync = writer; ext.pack_externMsg = pack; }
    assert.equal(tampered, true);
    assert.deepEqual(snapshot(f.root), before);
  }
});

test('legacy instant apply preserves its JSON/YAML replacement behavior after validation', async t => {
  const f = await fixture(t);
  const backup = snapshot(path.join(f.data, 'Backup'));
  applyPatches(f.extract, 'rpgmv', [patchFor(f, 'Actors.json#1.name', '번역 A')]);
  const yamlResult = await f.service.apply({ dir: f.data, instantapply: true, useYaml: true });
  assert.equal(yamlResult.validation.ok, true);
  assert.equal(fs.existsSync(path.join(f.data, 'Actors.json')), false);
  assert.equal(require('js-yaml').load(fs.readFileSync(path.join(f.data, 'Actors.json.yaml'), 'utf8'))[1].name, '번역 A');
  const jsonResult = await f.service.apply({ dir: f.data, instantapply: true });
  assert.equal(jsonResult.validation.ok, true);
  assert.equal(fs.existsSync(path.join(f.data, 'Actors.json.yaml')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.data, 'Actors.json'), 'utf8'))[1].name, '번역 A');
  assert.deepEqual(snapshot(path.join(f.data, 'Backup')), backup);
});

test('all selected stale hashes are counted with deterministic bounded details before dictionary mutation', async t => {
  const f = await fixture(t, undefined, data => {
    const file = path.join(data, 'Actors.json');
    const actors = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (let id = 3; id <= 105; id++) actors.push({ id, name: `Source ${id}`, nickname: '', profile: '' });
    fs.writeFileSync(file, JSON.stringify(actors));
  });
  const selected = f.manifest.entries.filter(e => /^Actors.json#\d+\.name$/.test(e.id));
  assert.equal(selected.length, 105);
  const file = path.join(f.extract, 'Actors.txt');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (const entry of selected) lines[entry.lineStart] = 'locally edited';
  fs.writeFileSync(file, lines.join('\n'));
  const translations = dictionary(f);
  fs.writeFileSync(path.join(translations, 'Actors_trans.json'), JSON.stringify(Object.fromEntries(selected.map(e => [e.id, '번역']))));
  const before = snapshot(f.root);
  const result = await executeAgentRequest(applyRequest(f, translations));
  assert.equal(result.error.code, 'E_PATCH_HASH_MISMATCH');
  assert.equal(result.error.details.totalConflicts, 105);
  assert.equal(result.error.details.conflicts.length, 100);
  assert.equal(result.error.details.omittedCount, 5);
  assert.equal(result.error.details.id, result.error.details.conflicts[0].id);
  assert.deepEqual(snapshot(f.root), before);
});

test('message quote diagnostics keep 101/401 blocks separate and flag residual Japanese for review', async t => {
  const f = await fixture(t, undefined, data => {
    const file = path.join(data, 'Map001.json');
    const map = JSON.parse(fs.readFileSync(file, 'utf8'));
    map.events[1].pages[0].list = [
      { code: 101, indent: 0, parameters: ['', 0, 0, 2] },
      { code: 401, indent: 0, parameters: ['「First'] },
      { code: 401, indent: 0, parameters: ['continuation」'] },
      { code: 101, indent: 0, parameters: ['', 0, 0, 2] },
      { code: 401, indent: 0, parameters: ['「Separate block」'] },
      { code: 0, indent: 0, parameters: [] },
    ];
    fs.writeFileSync(file, JSON.stringify(map));
  });
  const entries = f.manifest.entries.filter(e => e.mv?.originFile === 'Map001.json' && e.mv?.conf?.code === 401);
  const texts = ['「번역」', '이어짐こんにちは」', '"독립 블록"'];
  const outcome = applyPatches(f.extract, 'rpgmv', entries.map((e, i) => ({ id: e.id, expectedHash: e.hash, text: texts[i] })));
  assert.equal(outcome.translationQuality.mechanical, 'pass');
  assert.equal(outcome.translationQuality.context, 'needs-review');
  assert.equal(outcome.translationQuality.language, 'needs-review');
  assert.equal(outcome.translationQuality.semantics, 'not-run');
  assert.equal(outcome.translationQuality.issues.filter(i => i.code === 'RPG_MESSAGE_QUOTES').length, 1);
  assert.ok(outcome.translationQuality.issues.some(i => i.code === 'RPG_MESSAGE_QUOTE_STYLE' && i.reason));
  const applied = await f.service.apply({ dir: f.data });
  assert.equal(applied.translationQuality.context, 'needs-review');
});

test('AppleDouble JSON and YAML candidates are ignored without removing originals or failing verification', async t => {
  const f = await fixture(t, undefined, data => {
    fs.writeFileSync(path.join(data, '._Actors.json'), Buffer.from([0, 5, 22, 7]));
    fs.writeFileSync(path.join(data, '._Unused.json.yaml'), ': : : invalid');
  });
  fs.writeFileSync(path.join(f.data, 'Backup/._Other.json'), Buffer.from([0, 5, 22, 7]));
  const before = snapshot(f.root);
  const { inspectRpgProject } = require('../../.build/app/src/core/validation/engines/rpg.js');
  const result = inspectRpgProject(f.data, f.manifest);
  assert.equal(result.ok, true);
  assert.equal(result.issues.some(i => i.file?.includes('._')), false);
  assert.deepEqual(snapshot(f.root), before);
  assert.equal(fs.readFileSync(path.join(f.data, '._Actors.json')).length, 4);
});

test('fatal Backup errors provide only verified relative file and entry context, without parser excerpts', async t => {
  const f = await fixture(t);
  const file = path.join(f.data, 'Backup/Actors.json');
  const backup = fs.readFileSync(file);
  fs.writeFileSync(file, 'PRIVATE');
  await assert.rejects(f.service.apply({ dir: f.data }), error => {
    assert.equal(error.code, 'E_MAPPING_CORRUPT');
    assert.equal(error.details.fileName, 'Actors.json');
    assert.equal(JSON.stringify(error.toJSON()).includes('PRIVATE'), false);
    assert.equal(error.details.entryId, undefined);
    return true;
  });
  const actors = JSON.parse(backup.toString()); delete actors[1].name;
  fs.writeFileSync(file, JSON.stringify(actors));
  await assert.rejects(f.service.apply({ dir: f.data }), error => {
    assert.equal(error.details.file, 'Actors.json');
    assert.equal(error.details.bucket, 'Actors.json');
    assert.equal(error.details.entryId, 'Actors.json#1.name');
    assert.equal(error.details.dataPath, '1.name');
    return true;
  });
});

test('dictionary staging does not overwrite workspace edits made while apply is running', async t => {
  const f = await fixture(t);
  const translations = dictionary(f);
  const originalApply = RpgMakerService.prototype.apply;
  const textFile = path.join(f.extract, 'Actors.txt');
  let expected;
  RpgMakerService.prototype.apply = async function (...args) {
    const result = await originalApply.apply(this, args);
    fs.appendFileSync(textFile, '\nconcurrent user edit');
    expected = fs.readFileSync(textFile, 'utf8');
    return result;
  };
  let result;
  try { result = await executeAgentRequest(applyRequest(f, translations)); }
  finally { RpgMakerService.prototype.apply = originalApply; }
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'E_SOURCE_CHANGED');
  assert.equal(fs.readFileSync(textFile, 'utf8'), expected);
  assert.equal(fs.existsSync(path.join(f.data, 'Completed')), false);
});

test('read-only verify distinguishes recovered hashes from source-bound translation integrity', async t => {
  const f = await fixture(t, ['\\FF[1]Original', 'Source B']);
  const file = path.join(f.extract, 'Actors.txt');
  const entry = f.manifest.entries.find(e => e.id === 'Actors.json#1.name');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines[entry.lineStart] = '\\F[1]번역';
  fs.writeFileSync(file, lines.join('\n'));
  const recovered = await executeAgentRequest({ schemaVersion: 2, operation: 'recover', format: 'rpgmv',
    projectPath: f.data, options: {}, patches: [] });
  assert.equal(recovered.ok, true, JSON.stringify(recovered.error));
  const before = snapshot(f.root);
  const result = await executeAgentRequest({ schemaVersion: 2, operation: 'verify', format: 'rpgmv',
    projectPath: f.data, options: {}, patches: [] });
  assert.equal(result.validation.ok, true);
  assert.equal(result.ok, false);
  assert.equal(result.translationQuality.mechanical, 'fail');
  assert.equal(result.translationQuality.semantics, 'not-run');
  assert.deepEqual(snapshot(f.root), before);
});

test('custom output cannot replace edited image or audio inputs through service or dictionary apply', async t => {
  const f = await fixture(t);
  const systemPath = path.join(f.data, 'System.json');
  const system = JSON.parse(fs.readFileSync(systemPath, 'utf8'));
  system.encryptionKey = '00112233445566778899aabbccddeeff';
  fs.writeFileSync(systemPath, JSON.stringify(system));
  const translations = dictionary(f);
  for (const area of ['Extract_img', 'Extract_audio']) {
    const input = path.join(f.data, area);
    fs.mkdirSync(input);
    fs.writeFileSync(path.join(input, 'sentinel.txt'), 'edited asset');
    for (const output of [input, path.join(input, 'nested')]) {
      const before = snapshot(f.root);
      await assert.rejects(f.service.apply({ dir: f.data, outputDir: output, force: true }), error => error.code === 'E_OUTPUT_CONFLICT');
      assert.deepEqual(snapshot(f.root), before);
      const result = await executeAgentRequest(applyRequest(f, translations, output));
      assert.equal(result.error.code, 'E_OUTPUT_CONFLICT');
      assert.deepEqual(snapshot(f.root), before);
    }
  }
});

test('legacy instant apply rolls back already installed files and format removals on install failure', async t => {
  const f = await fixture(t);
  applyPatches(f.extract, 'rpgmv', [patchFor(f, 'Actors.json#1.name', '번역 A')]);
  const before = snapshot(f.root);
  const rename = fs.renameSync;
  let installations = 0;
  fs.renameSync = (source, destination) => {
    if (String(destination).endsWith('.json.yaml') && ++installations === 2) {
      const error = new Error('injected legacy installation failure');
      error.code = 'EIO';
      throw error;
    }
    return rename(source, destination);
  };
  try { await assert.rejects(f.service.apply({ dir: f.data, instantapply: true, useYaml: true })); }
  finally { fs.renameSync = rename; }
  assert.ok(installations >= 2);
  assert.deepEqual(snapshot(f.root), before);
});

test('merged output validation omits parser excerpts from unused Backup files', async t => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.data, 'Backup/Unused.json'), 'PRIVATE_REDACTION_MARKER');
  const before = snapshot(f.root);
  const result = await executeAgentRequest({ schemaVersion: 2, operation: 'apply', format: 'rpgmv',
    projectPath: f.data, options: {}, patches: [] });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'E_VERIFY_FAILED');
  assert.ok(result.error.details.validation.issues.some(issue => issue.code === 'RPG_JSON_PARSE_ERROR' && issue.file === 'Unused.json'));
  assert.equal(JSON.stringify(result).includes('PRIVATE_RE'), false);
  assert.deepEqual(snapshot(f.root), before);
});

test('custom service and dictionary outputs preserve original runtime and media directories', async t => {
  const f = await fixture(t);
  const translations = dictionary(f);
  for (const name of ['js', 'img', 'audio', 'fonts', 'movies']) {
    const output = path.join(path.dirname(f.data), name);
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'original.bin'), 'original game asset');
    const before = snapshot(f.root);
    await assert.rejects(f.service.apply({ dir: f.data, outputDir: output, force: true }), error => error.code === 'E_OUTPUT_CONFLICT');
    const result = await executeAgentRequest(applyRequest(f, translations, output));
    assert.equal(result.error.code, 'E_OUTPUT_CONFLICT');
    assert.deepEqual(snapshot(f.root), before);
  }
});

test('legacy instant plugin translations can be restored to the immutable Backup value', async t => {
  const f = await fixture(t, undefined, data => {
    fs.mkdirSync(path.join(path.dirname(data), 'js'));
    fs.writeFileSync(path.join(path.dirname(data), 'js/plugins.js'),
      'var $plugins = [{"name":"Sample","status":true,"description":"info","parameters":{"message":"Original"}}];');
  }, { extractOptions: { ext_plugin: true } });
  const id = 'ext_plugins.json#0.parameters.message';
  applyPatches(f.extract, 'rpgmv', [patchFor(f, id, 'Translated')]);
  await f.service.apply({ dir: f.data, instantapply: true });
  f.manifest = JSON.parse(fs.readFileSync(path.join(f.extract, 'manifest.json'), 'utf8'));
  applyPatches(f.extract, 'rpgmv', [patchFor(f, id, 'Original')]);
  const result = await f.service.apply({ dir: f.data, instantapply: true });
  assert.equal(result.validation.ok, true);
  assert.ok(fs.readFileSync(path.join(path.dirname(f.data), 'js/plugins.js'), 'utf8').includes('"message":"Original"'));
});

test('CSV readback agrees with the runtime parser on whitespace before a quoted field', async t => {
  const f = await fixture(t, undefined, data => fs.writeFileSync(path.join(data, 'ExternMessage.csv'), 'greeting,Original\n'),
    { extractOptions: { exJson: true } });
  applyPatches(f.extract, 'rpgmv', [patchFor(f, 'ExternMsgcsv.json#greeting', ' "Translated"')]);
  const ext = require('../../.build/app/src/js/rpgmv/extract.js');
  const pack = ext.pack_externMsg;
  const before = snapshot(f.root);
  ext.pack_externMsg = async file => fs.writeFileSync(file, 'greeting, "Translated"\n');
  try { await assert.rejects(f.service.apply({ dir: f.data }), error => error.code === 'E_VERIFY_FAILED'); }
  finally { ext.pack_externMsg = pack; }
  assert.deepEqual(snapshot(f.root), before);
  const result = await f.service.apply({ dir: f.data });
  assert.equal(result.validation.ok, true);
  const rows = await ext.parse_externMsg(path.join(f.data, 'Completed/data/ExternMessage.csv'), false);
  assert.equal(rows.greeting, ' "Translated"');
});
