const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  parseArgs,
  redactPublicRecord,
  runCorpus,
  sha256Source,
  summarizeWarnings,
  validateCatalog,
} = require('../../scripts/run-compat-corpus.js');

const appRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(appRoot, '..');

test('corpus CLI accepts equals arguments and npm environment fallbacks', () => {
  assert.deepEqual(
    parseArgs(['--catalog=private.json', '--output=public.json']),
    { catalog: 'private.json', output: 'public.json' },
  );
  assert.deepEqual(
    parseArgs([], {
      TSUKURU_CORPUS_CATALOG: 'private-from-env.json',
      TSUKURU_CORPUS_OUTPUT: 'public-from-env.json',
    }),
    { catalog: 'private-from-env.json', output: 'public-from-env.json' },
  );
});

test('public corpus warnings retain counts without repeating identical messages', () => {
  assert.deepEqual(
    summarizeWarnings(['same warning', 'other warning', 'same warning', 'same warning']),
    ['same warning (×3)', 'other warning'],
  );
});

test('public corpus records redact Windows and POSIX spellings of a private source root', () => {
  const source = String.raw`C:\Games\Private Title`;
  const record = {
    warnings: [source, source.replaceAll('\\', '/')],
    relative: 'data/Actors.json',
    [source]: 'private key',
  };
  assert.deepEqual(redactPublicRecord(record, source), {
    warnings: ['<source>', '<source>'],
    relative: 'data/Actors.json',
    '<source>': 'private key',
  });
});

test('private corpus validation rejects duplicate fixture IDs', () => {
  const entry = { id: 'same', path: 'x', engine: 'rpgmv', wrapper: 'directory' };
  assert.throws(
    () => validateCatalog({ schemaVersion: 1, entries: [entry, entry] }),
    /duplicate corpus id/,
  );
});

test('directory corpus hashes are deterministic and content-sensitive', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-corpus-hash-'));
  fs.mkdirSync(path.join(root, 'nested'));
  fs.writeFileSync(path.join(root, 'nested', 'a.txt'), 'one');
  const first = sha256Source(root);
  const second = sha256Source(root);
  fs.writeFileSync(path.join(root, 'nested', 'a.txt'), 'two');
  assert.equal(first, second);
  assert.notEqual(sha256Source(root), first);
});

test('public corpus output strips the private source path from keys and messages', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-corpus-runner-'));
  const source = path.join(repoRoot, 'fixtures', 'rpgmv-basic');
  const catalogPath = path.join(root, 'private.json');
  const outputPath = path.join(root, 'public.json');
  fs.writeFileSync(catalogPath, JSON.stringify({
    schemaVersion: 1,
    entries: [{
      id: 'rpgmv-private-001',
      path: source,
      engine: 'rpgmv',
      wrapper: 'directory',
      playtest: { status: 'not-run', notes: '' },
    }],
  }));

  const summary = runCorpus(catalogPath, outputPath);
  const output = fs.readFileSync(outputPath, 'utf8');
  const report = JSON.parse(output);
  assert.deepEqual(summary, { total: 1, failed: 1 });
  assert.equal(output.includes(source), false);
  assert.equal(output.includes(source.replace(/\\/g, '/')), false);
  assert.equal(Object.hasOwn(report.records[0], 'path'), false);
  assert.equal(report.records[0].sourceSha256, sha256Source(source));
  assert.equal(report.records[0].structural.status, 'failed');
  assert.equal(report.records[0].playtest.status, 'not-run');
});
