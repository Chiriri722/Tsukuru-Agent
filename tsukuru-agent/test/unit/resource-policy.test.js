const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { inspectResourcePreflight } = require('../../.build/app/src/core/resourcePolicy.js');
const { executeAgentRequest } = require('../../.build/app/src/cli/run.js');

test('resource preflight measures input and conservative temp demand without following links', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-resource-'));
  try {
    fs.mkdirSync(path.join(root, 'nested'));
    fs.writeFileSync(path.join(root, 'a.txt'), '1234');
    fs.writeFileSync(path.join(root, 'nested', 'b.txt'), '123456');
    const report = inspectResourcePreflight(root, 'extract', {}, { freeSpaceBytes: () => 1000 });
    assert.deepEqual(report, {
      files: 2,
      inputBytes: 10,
      estimatedTempBytes: 20,
      freeTempBytes: 1000,
      freeSpaceChecked: true,
    });
    assert.throws(
      () => inspectResourcePreflight(root, 'extract', { maxInputBytes: 9 }),
      (error) => error && error.code === 'E_RESOURCE_LIMIT_EXCEEDED',
    );
    assert.throws(
      () => inspectResourcePreflight(root, 'extract', { maxFiles: 1 }),
      (error) => error && error.code === 'E_RESOURCE_LIMIT_EXCEEDED',
    );
    assert.throws(
      () => inspectResourcePreflight(root, 'extract', { maxTempBytes: 19 }),
      (error) => error && error.code === 'E_RESOURCE_LIMIT_EXCEEDED',
    );
    assert.throws(
      () => inspectResourcePreflight(root, 'extract', { minFreeTempBytes: 990 }, { freeSpaceBytes: () => 1000 }),
      (error) => error && error.code === 'E_TEMP_SPACE_INSUFFICIENT',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('v2 resource limits fail before operation dispatch and preserve timing diagnostics', async () => {
  const projectPath = path.resolve(__dirname, '..', '..', '..', 'fixtures', 'rpgmv-basic');
  const result = await executeAgentRequest({
    schemaVersion: 2,
    operation: 'verify',
    format: 'auto',
    projectPath,
    profile: 'standard',
    options: { resourceLimits: { maxInputBytes: 1 } },
    patches: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'E_RESOURCE_LIMIT_EXCEEDED');
  assert.equal(typeof result.stats.performance.stageTimings.preflight, 'number');
  assert.equal(result.stats.performance.stageTimings.verify, undefined);
});

test('container detection reports file-count limits with the resource error contract', async () => {
  const projectPath = path.resolve(__dirname, '..', '..', '..', 'fixtures', 'rpgmv-basic');
  const result = await executeAgentRequest({
    schemaVersion: 2,
    operation: 'verify',
    format: 'auto',
    projectPath,
    profile: 'standard',
    options: { resourceLimits: { maxFiles: 1 } },
    patches: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'E_RESOURCE_LIMIT_EXCEEDED');
  assert.equal(result.error.details, undefined);
  assert.doesNotMatch(JSON.stringify(result.error), new RegExp(projectPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  assert.equal(typeof result.stats.performance.stageTimings.detection, 'number');
  assert.equal(result.stats.performance.stageTimings.preflight, undefined);
});
