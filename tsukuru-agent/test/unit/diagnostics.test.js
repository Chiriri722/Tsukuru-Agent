const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  redactSensitivePaths,
  writeDiagnosticReport,
} = require('../../.build/app/src/core/diagnostics.js');
const { executeAgentRequest } = require('../../.build/app/src/cli/run.js');

test('diagnostic redaction replaces exact sensitive roots without hiding relative paths', () => {
  for (const project of [String.raw`C:\Games\Private Title`, '/srv/games/Private Title']) {
    const alternate = project.includes('\\') ? project.replaceAll('\\', '/') : project.replaceAll('/', '\\');
    const text = `${project} ${alternate} data/Actors.json`;
    assert.equal(
      redactSensitivePaths(text, [{ path: project, label: 'project' }]),
      '<project> <project> data/Actors.json',
      project,
    );
  }
});

test('diagnostic reports are atomic, redacted, and never overwrite an existing file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-diagnostics-'));
  const project = path.join(root, 'private-game');
  const reportPath = path.join(root, 'reports', 'diagnostics.json');
  fs.mkdirSync(project);
  try {
    writeDiagnosticReport(reportPath, {
      source: project,
      nested: { output: path.join(project, 'Completed') },
      [path.join(project, 'sensitive-key')]: 'redact object keys too',
    }, {
      protectedRoots: [{ path: project, label: 'project' }],
      forbiddenRoot: project,
    });
    const report = fs.readFileSync(reportPath, 'utf8');
    assert.doesNotMatch(report, /private-game/i);
    assert.match(report, /<project>/);
    assert.throws(
      () => writeDiagnosticReport(reportPath, { second: true }, { forbiddenRoot: project }),
      (error) => error && error.code === 'E_OUTPUT_CONFLICT',
    );
    assert.throws(
      () => writeDiagnosticReport(path.join(project, 'diagnostics.json'), {}, { forbiddenRoot: project }),
      (error) => error && error.code === 'E_REQUEST_INVALID',
    );
    assert.equal(fs.readdirSync(path.dirname(reportPath)).some((name) => name.includes('.tmp-')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('diagnostic report success is preserved when only temporary cleanup fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-diagnostics-cleanup-'));
  const reportPath = path.join(root, 'diagnostics.json');
  const originalRemove = fs.rmSync;
  let injected = false;
  fs.rmSync = (candidate, options) => {
    if (!injected && path.basename(String(candidate)).includes('.tmp-')) {
      injected = true;
      throw new Error('simulated diagnostic cleanup failure');
    }
    return originalRemove(candidate, options);
  };
  try {
    assert.equal(writeDiagnosticReport(reportPath, { ok: true }), reportPath);
  } finally {
    fs.rmSync = originalRemove;
  }
  try {
    assert.equal(injected, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, 'utf8')), { ok: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('v2 requests can opt in to a redacted diagnostic report artifact', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-diagnostics-request-'));
  const reportPath = path.join(root, 'diagnostics.json');
  const projectPath = path.resolve(__dirname, '..', '..', '..', 'fixtures', 'rpgmv-basic');
  try {
    const result = await executeAgentRequest({
      schemaVersion: 2,
      operation: 'verify',
      format: 'auto',
      projectPath,
      profile: 'standard',
      options: { diagnosticReportPath: reportPath },
      patches: [],
    });
    assert.equal(fs.existsSync(reportPath), true);
    assert.equal(result.artifacts.includes(reportPath), true);
    const reportText = fs.readFileSync(reportPath, 'utf8');
    const report = JSON.parse(reportText);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.request.projectPath, '<project>');
    assert.equal(report.result.stats.performance.operationId, result.stats.performance.operationId);
    assert.equal(reportText.includes(projectPath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
