const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyPatches } = require('../../.build/app/src/cli/patcher.js');
const { sha256Text } = require('../../.build/app/src/core/manifest.js');
const { parseExtractManifest } = require('../../.build/app/src/core/contracts/manifestContract.js');
const { executeAgentRequest } = require('../../.build/app/src/cli/run.js');

function fixture(t, texts = ['first', 'second', 'third']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-patch-mappings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const extract = path.join(root, 'Extract');
  fs.mkdirSync(extract);
  fs.writeFileSync(path.join(root, 'source.ks'), texts.join('\n'));
  fs.writeFileSync(path.join(extract, 'story.txt'), texts.join('\n'));
  const manifest = {
    schemaVersion: 1, format: 'tyrano',
    entries: texts.map((text, index) => ({
      id: `entry#${index}`, extractFile: 'story.txt',
      lineStart: index, lineEnd: index + 1, hash: sha256Text(text),
    })),
  };
  const manifestPath = path.join(extract, 'manifest.json');
  const save = () => fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const patch = (index = 0, text = 'translated\nextra') => ({
    id: `entry#${index}`, expectedHash: sha256Text(texts[index]), text,
  });
  save();
  return { root, extract, manifest, manifestPath, save, patch };
}

function snapshot(root) {
  const files = {};
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else files[path.relative(root, full)] = fs.readFileSync(full).toString('base64');
    }
  };
  visit(root);
  return files;
}

function rejectsUnchanged(f, patches, code = 'E_MAPPING_CORRUPT') {
  f.save();
  const before = snapshot(f.root);
  assert.throws(() => applyPatches(f.extract, 'tyrano', patches), error => error?.code === code);
  assert.deepEqual(snapshot(f.root), before);
}

test('patch rejects absent coordinates on targets and recalculated neighbors without writes', t => {
  for (const index of [0, 1]) {
    for (const missing of [['lineStart'], ['lineEnd'], ['lineStart', 'lineEnd']]) {
      const f = fixture(t);
      for (const key of missing) delete f.manifest.entries[index][key];
      rejectsUnchanged(f, [f.patch()]);
    }
  }
});

test('patch validates unpatched neighbor bounds and retains schema errors for invalid coordinate types', t => {
  for (const range of [{ lineStart: 1, lineEnd: 1 }, { lineStart: 2, lineEnd: 1 }, { lineStart: 1, lineEnd: 99 }]) {
    const f = fixture(t);
    Object.assign(f.manifest.entries[1], range);
    rejectsUnchanged(f, [f.patch()]);
  }
  for (const value of [null, '1', 0.5, -1]) {
    const f = fixture(t);
    f.manifest.entries[1].lineStart = value;
    rejectsUnchanged(f, [f.patch()], 'E_MANIFEST_CORRUPT');
  }
});

test('patch rejects overlaps with unpatched ranges including equal starts and contained intervals', t => {
  for (const range of [{ lineStart: 0, lineEnd: 1 }, { lineStart: 0, lineEnd: 2 }, { lineStart: 1, lineEnd: 3 }]) {
    const f = fixture(t);
    Object.assign(f.manifest.entries[1], range);
    f.manifest.entries.reverse();
    rejectsUnchanged(f, [f.patch()]);
  }
});

test('patch rejects alternate spellings that hide an affected file neighbor', t => {
  const aliases = ['./story.txt', 'nested/../story.txt', 'absolute'];
  if (process.platform === 'win32') aliases.push('STORY.txt', 'story.txt::$DATA', 'namespaced', 'device');
  for (const alias of aliases) {
    for (const both of [false, true]) {
      const f = fixture(t);
      f.manifest.entries[1].extractFile = alias === 'absolute' ? path.join(f.extract, 'story.txt') : alias;
      if (alias === 'namespaced') f.manifest.entries[1].extractFile = path.toNamespacedPath(path.join(f.extract, 'story.txt'));
      if (alias === 'device') f.manifest.entries[1].extractFile = '\\\\.\\' + path.join(f.extract, 'story.txt');
      rejectsUnchanged(f, both ? [f.patch(), f.patch(1)] : [f.patch()]);
    }
  }
});

test('patch preserves adjacent and gapped unordered mappings and minimal v1 reads in untouched files', t => {
  const f = fixture(t, ['first', 'gap', 'third']);
  f.manifest.entries.splice(1, 1);
  f.manifest.entries.reverse();
  f.manifest.entries.push({ id: 'legacy', extractFile: 'untouched.txt', hash: sha256Text('legacy') });
  assert.equal(parseExtractManifest(f.manifest).entries.length, 3);
  f.save();
  assert.deepEqual(applyPatches(f.extract, 'tyrano', [f.patch()]), { patched: 1, files: 1 });
  const after = JSON.parse(fs.readFileSync(f.manifestPath, 'utf8'));
  assert.deepEqual(after.entries.find(entry => entry.id === 'entry#2'), {
    id: 'entry#2', extractFile: 'story.txt', lineStart: 3, lineEnd: 4, hash: sha256Text('third'),
  });
  assert.deepEqual(after.entries.find(entry => entry.id === 'legacy'), f.manifest.entries[2]);
  assert.equal(fs.readFileSync(path.join(f.extract, 'story.txt'), 'utf8'), 'translated\nextra\ngap\nthird');
  const adjacent = fixture(t);
  assert.deepEqual(applyPatches(adjacent.extract, 'tyrano', [adjacent.patch()]), { patched: 1, files: 1 });
});

test('agent patch rejects a missing coordinate after real extraction and preserves the complete workspace', async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'data/scenario'), { recursive: true });
  fs.writeFileSync(path.join(f.root, 'data/scenario/first.ks'), 'Original[l]\n');
  const request = { schemaVersion: 2, format: 'tyrano', projectPath: f.root, profile: 'standard', options: {}, patches: [] };
  const extracted = await executeAgentRequest({ ...request, operation: 'extract' });
  assert.equal(extracted.ok, true, JSON.stringify(extracted.error));
  const manifestPath = path.join(f.root, 'data/_Extract/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.schemaVersion = 1;
  delete manifest.entries[0].lineStart;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const before = snapshot(f.root);
  const result = await executeAgentRequest({ ...request, operation: 'patch', patches: [{
    id: manifest.entries[0].id, expectedHash: manifest.entries[0].hash, text: 'Translated',
  }] });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'E_MAPPING_CORRUPT');
  assert.deepEqual(snapshot(f.root), before);
});

test('patch never probes an unrelated absolute or escaping legacy path', t => {
  for (const file of [path.resolve(os.tmpdir(), 'unrelated-legacy.txt'), '../unrelated-legacy.txt', ...(process.platform === 'win32' ? ['\\\\unused-review-host.invalid\\share\\x'] : [])]) {
    const f = fixture(t);
    f.manifest.entries.push({ id: 'legacy', extractFile: file, hash: sha256Text('legacy') });
    f.save();
    const target = path.resolve(f.extract, file);
    for (const [owner, key] of [[fs, 'existsSync'], [fs, 'lstatSync'], [fs.realpathSync, 'native']]) {
      const original = owner[key];
      t.mock.method(owner, key, (...args) => {
        assert.notEqual(String(args[0]), target, 'unrelated path must not reach a filesystem probe');
        return original(...args);
      });
    }
    try {
      assert.deepEqual(applyPatches(f.extract, 'tyrano', [f.patch()]), { patched: 1, files: 1 });
    } finally {
      t.mock.restoreAll();
    }
  }
});

test('patch preserves distinct NFC and NFD files when only one is affected', t => {
  const f = fixture(t);
  const names = ['caf\u00e9.txt', 'cafe\u0301.txt'];
  fs.renameSync(path.join(f.extract, 'story.txt'), path.join(f.extract, names[0]));
  fs.writeFileSync(path.join(f.extract, names[1]), 'untouched');
  if (!names.every(name => fs.readdirSync(f.extract).includes(name))) {
    t.skip('filesystem normalizes Unicode names');
    return;
  }
  for (const entry of f.manifest.entries) entry.extractFile = names[0];
  f.manifest.entries.push({ id: 'unicode', extractFile: names[1], hash: sha256Text('untouched') });
  f.save();
  assert.deepEqual(applyPatches(f.extract, 'tyrano', [f.patch()]), { patched: 1, files: 1 });
  assert.equal(fs.readFileSync(path.join(f.extract, names[1]), 'utf8'), 'untouched');
});
