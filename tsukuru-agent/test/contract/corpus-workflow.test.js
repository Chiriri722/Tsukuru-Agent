const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(appRoot, '..');

test('compatibility corpus is an explicit manual workflow outside normal CI', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['compat:corpus'], 'node scripts/run-compat-corpus.js');
  assert.equal(fs.existsSync(path.join(appRoot, 'scripts', 'run-compat-corpus.js')), true);

  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'compatibility-corpus.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /self-hosted/);
  assert.match(workflow, /Windows/);
  assert.match(workflow, /tsukuru-corpus/);
  assert.match(workflow, /run: npm run compat:corpus/);
  assert.match(workflow, /TSUKURU_CORPUS_CATALOG:/);
  assert.match(workflow, /TSUKURU_CORPUS_OUTPUT:/);
  assert.doesNotMatch(workflow, /npm run compat:corpus --/);
  assert.match(workflow, /uses: actions\/checkout@v7/);
  assert.match(workflow, /uses: actions\/setup-node@v7/);
  assert.match(workflow, /uses: actions\/upload-artifact@v7/);
  assert.doesNotMatch(workflow, /pull_request:/);
});

test('public corpus records exclude local paths and separate structural from playtest evidence', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs', 'compatibility-corpus.schema.json'), 'utf8'));
  const example = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs', 'compatibility-corpus.example.json'), 'utf8'));
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.required.includes('records'));
  assert.ok(example.records.length > 0);
  for (const record of example.records) {
    assert.equal(Object.hasOwn(record, 'path'), false);
    assert.match(record.sourceSha256, /^[0-9a-f]{64}$/);
    assert.ok(['passed', 'failed', 'not-run'].includes(record.structural.status));
    assert.ok(['passed', 'failed', 'not-run'].includes(record.playtest.status));
  }
  const ignore = fs.readFileSync(path.join(appRoot, '.gitignore'), 'utf8');
  assert.match(ignore, /^compatibility-corpus\.private\.json$/m);
});
