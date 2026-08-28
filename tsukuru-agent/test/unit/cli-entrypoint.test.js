const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..', '..');
const stageRoot = path.join(appRoot, '.build', 'app');
const { parseArgs, runCli } = require(path.join(stageRoot, 'src', 'cli', 'entrypoint.js'));
const { formatHumanSummary, serializeAgentResult } = require(path.join(stageRoot, 'src', 'cli', 'presenter.js'));

function makeIo(requestText = '{}') {
  const stdout = [];
  return {
    stdout,
    io: {
      readRequest: () => requestText,
      writeStdout: (text) => stdout.push(text),
      redirectLegacyConsole: () => {},
    },
  };
}

test('CLI entrypoint owns argument/request/output concerns outside run.ts', () => {
  const runSource = fs.readFileSync(path.join(appRoot, 'src', 'cli', 'run.ts'), 'utf8');
  const entrypointSource = fs.readFileSync(path.join(appRoot, 'src', 'cli', 'entrypoint.ts'), 'utf8');
  assert.doesNotMatch(runSource, /fs\.readFileSync\(0/);
  assert.doesNotMatch(runSource, /process\.stdout\.write/);
  assert.doesNotMatch(runSource, /console\.log\s*=\s*console\.error/);
  assert.match(entrypointSource, /export async function runCli/);
});

test('CLI argument parser accepts one request source and rejects malformed commands', () => {
  assert.equal(parseArgs(['run', '--request', '-']), '-');
  assert.throws(() => parseArgs(['verify']), /지원하지 않는 명령/);
  assert.throws(() => parseArgs(['run']), /--request/);
});

test('CLI entrypoint serializes exactly one injected application result', async () => {
  const harness = makeIo('{"hello":"world"}');
  const expected = {
    schemaVersion: 2,
    ok: true,
    operation: 'verify',
    format: 'rpgmz',
    artifacts: [],
    stats: { entries: 1 },
    warnings: [],
  };
  const status = await runCli(['run', '--request', 'request.json'], async (raw) => {
    assert.deepEqual(raw, { hello: 'world' });
    return expected;
  }, harness.io);
  assert.equal(status, 0);
  assert.deepEqual(harness.stdout, [serializeAgentResult(expected)]);
  assert.deepEqual(JSON.parse(harness.stdout[0]), expected);
});

test('CLI entrypoint converts request and application failures to the stable error result', async () => {
  const malformed = makeIo('{');
  assert.equal(await runCli(['run', '--request', '-'], async () => assert.fail('must not execute'), malformed.io), 1);
  assert.equal(JSON.parse(malformed.stdout[0]).error.code, 'E_REQUEST_INVALID');

  const failed = makeIo('{}');
  assert.equal(await runCli(['run', '--request', '-'], async () => {
    const error = new Error('boom at C:\\Users\\Private\\source.ts');
    error.stack = 'Error: boom\n    at C:\\Users\\Private\\source.ts:10:2';
    throw error;
  }, failed.io), 1);
  const failure = JSON.parse(failed.stdout[0]);
  assert.equal(failure.error.code, 'E_INTERNAL');
  assert.equal(failure.error.message, '내부 오류가 발생했습니다');
  assert.equal(failure.error.details, undefined);
  assert.doesNotMatch(failed.stdout[0], /Private|source\.ts|stack/i);
  assert.equal(failed.stdout.length, 1);
});

test('human summary presenter formats score, damage, runtime, and validation deterministically', () => {
  const summary = formatHumanSummary({
    ok: false,
    format: 'rpgmz',
    artifacts: [],
    stats: {},
    warnings: [],
    error: null,
    container: { type: 'electron-asar' },
    engine: { type: 'rpgmz', wrapper: 'electron', features: [], confidence: 100 },
    scores: {
      total: 83,
      extractionCoverage: 100,
      mappingIntegrity: 100,
      reinsertionValidity: 50,
      protectedScriptIntegrity: 100,
      containerIntegrity: 100,
      risk: 'medium',
    },
    change: { protectedScriptDamage: 0 },
    runtime: {
      risk: 'low',
      fuses: { embeddedAsarIntegrityValidation: false },
      asarIntegrity: { status: 'absent' },
      signature: { status: 'not-signed' },
    },
    validation: {
      profile: 'rpg', filesChecked: 4, entriesChecked: 10, invalidEntries: 1,
      tokenErrors: 0, encodingWarnings: 0,
    },
  }, { protectedMetric: 'damage', damageAssessed: false });

  assert.equal(summary, [
    '[Tsukuru Agent] container=electron-asar engine=rpgmz wrapper=electron',
    '[Tsukuru Agent] score=83/100 risk=medium',
    '[Tsukuru Agent] extraction=100% reinsert=50% protected-script-damage=unassessed',
    '[Tsukuru Agent] runtime-risk=low fuse=false asar-integrity=absent signature=not-signed',
    '[Tsukuru Agent] validation=rpg files=4 entries=10 invalid=1 token-errors=0 encoding-warnings=0',
    '',
  ].join('\n'));
});

test('application orchestration delegates stderr formatting to the presenter', () => {
  const runSource = fs.readFileSync(path.join(appRoot, 'src', 'cli', 'run.ts'), 'utf8');
  const verifyRoot = path.join(appRoot, 'src', 'cli', 'operations', 'verify');
  const verifySource = [fs.readFileSync(path.join(appRoot, 'src', 'cli', 'operations', 'verify.ts'), 'utf8')]
    .concat(fs.readdirSync(verifyRoot).sort().map((file) => fs.readFileSync(path.join(verifyRoot, file), 'utf8')))
    .join('\n');
  assert.doesNotMatch(runSource, /process\.stderr\.write/);
  assert.doesNotMatch(runSource, /writeHumanSummary/);
  assert.match(verifySource, /writeHumanSummary/);
});
