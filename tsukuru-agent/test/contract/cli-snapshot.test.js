const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { redactSensitivePaths } = require('../../.build/app/src/core/diagnostics.js');

const appRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(appRoot, '..');
const cliPath = path.join(appRoot, '.build', 'app', 'src', 'cli', 'main.js');
const snapshotPath = path.join(appRoot, 'test', 'helpers', 'cli-contract.snapshot.json');

function request(operation, projectPath, extra = {}) {
  return {
    schemaVersion: 2,
    operation,
    format: 'auto',
    projectPath,
    profile: 'standard',
    options: {},
    patches: [],
    ...extra,
  };
}

function runRequest(body) {
  const child = spawnSync(process.execPath, [cliPath, 'run', '--request', '-'], {
    cwd: appRoot,
    input: JSON.stringify(body),
    encoding: 'utf8',
  });
  assert.notEqual(child.status, null, child.error?.message);
  assert.doesNotThrow(() => JSON.parse(child.stdout), `stdout must contain exactly one JSON document: ${child.stdout}`);
  const result = JSON.parse(child.stdout);
  const performance = result.stats?.performance;
  assert.deepEqual(Object.keys(performance || {}).sort(), ['elapsedMs', 'operationId', 'stageTimings']);
  assert.match(performance.operationId, /^[0-9a-f-]{36}$/i);
  assert.equal(Number.isFinite(performance.elapsedMs) && performance.elapsedMs >= 0, true);
  assert.equal(Object.keys(performance.stageTimings).length > 0, true);
  assert.equal(Object.values(performance.stageTimings).every((value) => Number.isFinite(value) && value >= 0), true);
  const resources = result.stats?.resources;
  assert.deepEqual(Object.keys(resources || {}).sort(), [
    'estimatedTempBytes', 'files', 'freeSpaceChecked', 'freeTempBytes', 'inputBytes',
  ]);
  assert.equal(Number.isSafeInteger(resources.files) && resources.files >= 0, true);
  assert.equal(Number.isSafeInteger(resources.inputBytes) && resources.inputBytes >= 0, true);
  const structuredEvents = child.stderr.split(/\r?\n/)
    .filter((line) => line.startsWith('[progress-event] '))
    .map((line) => JSON.parse(line.slice('[progress-event] '.length)));
  assert.equal(structuredEvents.length >= 2, true);
  for (const event of structuredEvents) {
    assert.deepEqual(Object.keys(event).sort(), ['completed', 'operationId', 'stage', 'total', 'unit']);
    assert.equal(event.operationId, performance.operationId);
  }
  return { exitCode: child.status, stderr: child.stderr, result };
}

function normalizeRequest(body) {
  const optionKeys = Object.keys(body.options || {}).sort().join(',') || '-';
  return `schema=${body.schemaVersion} operation=${body.operation} format=${body.format} profile=${body.profile} options=${optionKeys} patches=${(body.patches || []).length}`;
}

function normalizeRun(body, run) {
  const result = run.result;
  return {
    request: normalizeRequest(body),
    exitCode: run.exitCode,
    stderrHasProgress: /\[progress\]/.test(run.stderr),
    result: {
      keys: Object.keys(result).sort(),
      ok: result.ok,
      format: result.format,
      artifactNames: (result.artifacts || []).map((entry) => path.basename(entry)).sort(),
      statKeys: Object.keys(result.stats || {}).sort(),
      warnings: (result.warnings || []).map((warning) => (
        redactSensitivePaths(warning, [{ path: body.projectPath, label: 'project' }]).replace(/\\/g, '/')
      )),
      errorCode: result.error?.code ?? null,
      errorDetailKeys: Object.keys(result.error?.details || {}).sort(),
    },
  };
}

test('all five CLI operations keep deterministic success and failure snapshots', () => {
  const expected = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-cli-contract-'));
  try {
    const gameRoot = path.join(tempRoot, 'game');
    fs.cpSync(path.join(repoRoot, 'fixtures', 'rpgmv-basic'), gameRoot, { recursive: true });
    const dataRoot = path.join(gameRoot, 'www', 'data');
    const observed = {};

    let body = request('verify', gameRoot);
    observed.verifyFailure = normalizeRun(body, runRequest(body));

    body = request('apply', gameRoot);
    observed.applyFailure = normalizeRun(body, runRequest(body));

    body = request('recover', gameRoot);
    observed.recoverFailure = normalizeRun(body, runRequest(body));

    body = request('extract', gameRoot);
    observed.extractSuccess = normalizeRun(body, runRequest(body));
    observed.extractFailure = normalizeRun(body, runRequest(body));

    body = request('verify', gameRoot);
    observed.verifySuccess = normalizeRun(body, runRequest(body));

    const manifestPath = path.join(dataRoot, 'Extract', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const entry = manifest.entries.find((candidate) => candidate.id === 'Actors.json#1.name');
    body = request('patch', gameRoot, {
      patches: [{ id: entry.id, expectedHash: entry.hash, text: '계약 스냅샷' }],
    });
    observed.patchSuccess = normalizeRun(body, runRequest(body));
    observed.patchFailure = normalizeRun(body, runRequest(body));

    body = request('apply', gameRoot);
    observed.applySuccess = normalizeRun(body, runRequest(body));

    fs.rmSync(manifestPath);
    body = request('recover', gameRoot);
    observed.recoverSuccess = normalizeRun(body, runRequest(body));

    assert.deepEqual(observed, expected);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
