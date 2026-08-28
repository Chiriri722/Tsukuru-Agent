const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.dirname(appRoot);

test('performance harness covers every engine and archive container with resource metrics', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.prebenchmark, 'npm run compile');
  assert.equal(pkg.scripts.benchmark, 'node scripts/run-benchmarks.js --profile baseline');
  assert.equal(pkg.scripts['benchmark:check'], 'node scripts/run-benchmarks.js --profile ci --check');

  const run = spawnSync(process.execPath, ['scripts/run-benchmarks.js', '--profile', 'smoke'], {
    cwd: appRoot,
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const report = JSON.parse(run.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.profile, 'smoke');
  assert.equal(typeof report.environment.node, 'string');
  assert.deepEqual(report.cases.map((entry) => entry.id).sort(), [
    'asar', 'gdevelop', 'nwjs', 'rpgmv', 'tyrano', 'wolf',
  ]);
  for (const entry of report.cases) {
    assert.ok(entry.elapsedMs >= 0, entry.id);
    assert.ok(entry.peakRssBytes > 0, entry.id);
    assert.ok(entry.metrics.files > 0, entry.id);
    assert.ok(entry.metrics.totalBytes > 0, entry.id);
    assert.ok(entry.metrics.textEntries >= 0, entry.id);
    assert.ok(entry.metrics.tempBytes > 0, entry.id);
    assert.deepEqual(Object.keys(entry.stageTimingsMs).sort(), ['fixture', 'hashing', 'packing', 'parsing']);
    for (const value of Object.values(entry.stageTimingsMs)) assert.ok(value >= 0, entry.id);
  }
});

test('performance baseline and manual regression workflow are explicit', () => {
  const baselinePath = path.join(appRoot, 'docs', 'performance', 'baseline.json');
  const guidePath = path.join(appRoot, 'docs', 'performance', 'large-workspaces.md');
  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'performance.yml');
  for (const target of [baselinePath, guidePath, workflowPath]) assert.equal(fs.existsSync(target), true, target);
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  assert.equal(baseline.schemaVersion, 1);
  assert.equal(baseline.profile, 'ci');
  assert.deepEqual(Object.keys(baseline.cases).sort(), ['asar', 'gdevelop', 'nwjs', 'rpgmv', 'tyrano', 'wolf']);
  for (const value of Object.values(baseline.cases)) {
    assert.ok(value.maxElapsedMs > 0);
    assert.ok(value.maxPeakRssBytes > 0);
    assert.ok(value.expectedFiles > 0);
    assert.ok(value.expectedTotalBytes > 0);
  }
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /npm run benchmark:check/);
  assert.match(workflow, /windows-latest/);
  assert.doesNotMatch(workflow, /pull_request:/);
});

test('I/O boundary review records worker, stream, and bounded-buffer decisions', () => {
  const reviewPath = path.join(appRoot, 'docs', 'performance', 'io-boundaries.md');
  const review = fs.readFileSync(reviewPath, 'utf8');
  for (const term of [
    'GUI worker',
    'stream',
    'bounded buffer',
    'archive adapter',
    'project conversion',
    'translation service',
  ]) {
    assert.match(review, new RegExp(term, 'i'));
  }
});
