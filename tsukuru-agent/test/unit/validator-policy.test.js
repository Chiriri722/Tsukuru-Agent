const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..', '..');
const stageRoot = path.join(appRoot, '.build', 'app');
const { calculateVerificationScore } = require(path.join(stageRoot, 'src', 'core', 'validation', 'scoring.js'));
const {
  issueRegistry,
  finalizeValidationReport,
} = require(path.join(stageRoot, 'src', 'core', 'validation', 'reportPolicy.js'));
const {
  matchesProtectedPath,
  protectedPathProfiles,
} = require(path.join(stageRoot, 'src', 'core', 'validation', 'protectedPaths.js'));

test('verification scoring is isolated and preserves the weighted risk policy', () => {
  const score = calculateVerificationScore({
    extractionCoverage: 100,
    mappingIntegrity: 100,
    reinsertionValidity: 50,
    protectedScriptIntegrity: 100,
    containerIntegrity: 100,
  });
  assert.equal(score.total, 85);
  assert.equal(score.risk, 'medium');
  assert.equal(score.ok, true);
  assert.equal(calculateVerificationScore({
    extractionCoverage: 100,
    mappingIntegrity: 100,
    reinsertionValidity: 100,
    protectedScriptIntegrity: 100,
    containerIntegrity: 100,
    critical: ['damage'],
  }).risk, 'critical');
});

test('every structural issue literal is registered with one canonical severity', () => {
  const engineRoot = path.join(appRoot, 'src', 'core', 'validation', 'engines');
  const source = fs.readdirSync(engineRoot)
    .filter((file) => file.endsWith('.ts'))
    .sort()
    .map((file) => fs.readFileSync(path.join(engineRoot, file), 'utf8'))
    .join('\n');
  const codes = [...source.matchAll(/'((?:RPG|WOLF|TYRANO)_[A-Z0-9_]+)'/g)]
    .map((match) => match[1]);
  assert.ok(codes.length > 20);
  for (const code of new Set(codes)) {
    assert.ok(issueRegistry[code], `unregistered issue code: ${code}`);
    assert.match(issueRegistry[code].severity, /^(critical|error|warning)$/);
  }
});

test('report policy canonicalizes severity and sorts issues deterministically', () => {
  const report = finalizeValidationReport({
    profile: 'rpgmv', ok: false, filesChecked: 1, entriesChecked: 1,
    validEntries: 0, invalidEntries: 1,
    encodingCounts: { utf8: 1, shiftJis: 0, unknown: 0 },
    encodingWarnings: 0, tokenErrors: 2,
    issues: [
      { code: 'RPG_REFERENCE_MISSING', severity: 'critical', file: 'B.json', message: 'b' },
      { code: 'RPG_JSON_PARSE_ERROR', severity: 'warning', file: 'A.json', message: 'a' },
    ],
  });
  assert.deepEqual(report.issues.map((issue) => [issue.code, issue.severity]), [
    ['RPG_JSON_PARSE_ERROR', 'critical'],
    ['RPG_REFERENCE_MISSING', 'error'],
  ]);
});

test('protected path policy is grouped by engine and container profile', () => {
  assert.deepEqual(Object.keys(protectedPathProfiles), ['electron-rpg', 'gdevelop']);
  assert.equal(matchesProtectedPath('package.json'), true);
  assert.equal(matchesProtectedPath('js/rmmz_core.js'), true);
  assert.equal(matchesProtectedPath('gdjs/runtimegame.js'), true);
  assert.equal(matchesProtectedPath('data/Actors.json'), false);
  assert.equal(matchesProtectedPath('gdjs/runtimegame.js', ['electron-rpg']), false);
});
