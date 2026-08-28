const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { applyPatches } = require('../../.build/app/src/cli/patcher.js');
const { loadRpgTranslationDictionary } = require('../../.build/app/src/core/translationDictionary.js');

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function fixture(entries = [{ id: 'Actors.json#1.name', text: 'Alice' }]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-dictionary-edge-'));
  const extract = path.join(root, 'Extract');
  const translations = path.join(root, 'translations');
  fs.mkdirSync(extract);
  fs.mkdirSync(translations);
  fs.writeFileSync(path.join(extract, 'Actors.txt'), `${entries.map((entry) => entry.text).join('\n')}\n`);
  fs.writeFileSync(path.join(extract, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    format: 'rpgmv',
    entries: entries.map((entry, index) => ({
      id: entry.id,
      sourceFile: 'Backup/Actors.json',
      dataPath: `${index + 1}.name`,
      extractFile: 'Actors.txt',
      lineStart: index,
      lineEnd: index + 1,
      hash: sha256(entry.hashText ?? entry.text),
      encoding: 'utf8',
      nullTerminated: false,
      mv: { originFile: 'Actors.json', conf: entry.comment ? { isComment: true } : undefined },
    })),
  }));
  return { root, extract, translations };
}

test('translation dictionaries reject duplicate IDs across sorted files', () => {
  const { extract, translations } = fixture();
  fs.writeFileSync(path.join(translations, 'B_trans.json'), JSON.stringify({ 'Actors.json#1.name': '둘' }));
  fs.writeFileSync(path.join(translations, 'A_trans.json'), JSON.stringify({ 'Actors.json#1.name': '하나' }));

  assert.throws(
    () => loadRpgTranslationDictionary(extract, translations),
    (error) => error.code === 'E_PATCH_DUPLICATE_ID',
  );
});

test('translation dictionaries reject oversized files before parsing', () => {
  const { extract, translations } = fixture();
  const dictionaryPath = path.join(translations, 'Actors_trans.json');
  const descriptor = fs.openSync(dictionaryPath, 'w');
  try {
    fs.ftruncateSync(descriptor, (64 * 1024 * 1024) + 1);
  } finally {
    fs.closeSync(descriptor);
  }

  assert.throws(
    () => loadRpgTranslationDictionary(extract, translations),
    (error) => error.code === 'E_REQUEST_INVALID' && /너무 큽니다/.test(error.message),
  );
});

test('stale manifest hashes fail before a dictionary patch mutates text', () => {
  const { extract, translations } = fixture([{ id: 'Actors.json#1.name', text: 'changed', hashText: 'Alice' }]);
  const textPath = path.join(extract, 'Actors.txt');
  fs.writeFileSync(path.join(translations, 'Actors_trans.json'), JSON.stringify({ 'Actors.json#1.name': '앨리스' }));
  const outcome = loadRpgTranslationDictionary(extract, translations);

  assert.throws(
    () => applyPatches(extract, 'rpgmv', outcome.patches),
    (error) => error.code === 'E_PATCH_HASH_MISMATCH',
  );
  assert.equal(fs.readFileSync(textPath, 'utf8'), 'changed\n');
});

test('blank, unknown, unchanged, and comment entries are skipped in deterministic order', () => {
  const { extract, translations } = fixture([
    { id: 'Actors.json#1.name', text: 'Alice' },
    { id: 'Actors.json#2.name', text: 'Bob' },
    { id: 'Actors.json#3.note', text: 'memo', comment: true },
  ]);
  fs.writeFileSync(path.join(translations, 'Actors_trans.json'), JSON.stringify({
    'Actors.json#1.name': 'Alice',
    'Actors.json#2.name': '',
    'Actors.json#3.note': '번역 주석',
    'Actors.json#99.name': 'unknown',
  }));

  const first = loadRpgTranslationDictionary(extract, translations);
  const second = loadRpgTranslationDictionary(extract, translations);
  assert.deepEqual(first.patches, []);
  assert.deepEqual(first.stats, {
    files: 1,
    entries: 4,
    selected: 0,
    skippedUnknown: 1,
    skippedBlank: 1,
    skippedUnchanged: 1,
    skippedComment: 1,
  });
  assert.deepEqual(first.warnings, [
    'manifest에 없는 번역 사전 항목 1개를 건너뛰었습니다',
    '빈 번역 사전 항목 1개를 건너뛰었습니다',
    '주석 번역 사전 항목 1개를 건너뛰었습니다',
  ]);
  assert.deepEqual(second, first);
});

test('translation dictionaries reject an Extract workspace reached through a junction', (t) => {
  const { root, extract, translations } = fixture();
  const outsideExtract = path.join(root, 'outside-extract');
  fs.writeFileSync(path.join(translations, 'Actors_trans.json'), JSON.stringify({
    'Actors.json#1.name': '앨리스',
  }));
  fs.cpSync(extract, outsideExtract, { recursive: true });
  fs.rmSync(extract, { recursive: true, force: true });
  try {
    fs.symlinkSync(outsideExtract, extract, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`symlink/junction creation unavailable: ${error.code}`);
    return;
  }

  assert.throws(
    () => loadRpgTranslationDictionary(extract, translations),
    (error) => error?.code === 'E_MAPPING_CORRUPT' && /link|junction|심볼릭|정션/i.test(error.message),
  );
});

test('translation dictionaries reject an extracted text file reached through a junction', (t) => {
  const { root, extract, translations } = fixture();
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'Actors.txt'), 'Alice\n');
  try {
    fs.symlinkSync(outside, path.join(extract, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`symlink/junction creation unavailable: ${error.code}`);
    return;
  }
  const manifestPath = path.join(extract, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.entries[0].extractFile = 'linked/Actors.txt';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  fs.writeFileSync(path.join(translations, 'Actors_trans.json'), JSON.stringify({
    'Actors.json#1.name': '앨리스',
  }));

  assert.throws(
    () => loadRpgTranslationDictionary(extract, translations),
    (error) => error?.code === 'E_MAPPING_CORRUPT' && /link|junction|심볼릭|정션/i.test(error.message),
  );
});
