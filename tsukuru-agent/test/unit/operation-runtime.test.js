const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createOperationRuntime,
  disposeOperationRuntime,
  getOperationTelemetry,
  runOperationStage,
  throwIfOperationAborted,
} = require('../../.build/app/src/core/operationRuntime.js');
const { WorkspaceTransaction } = require('../../.build/app/src/core/workspaceTransaction.js');
const { executeAgentRequest } = require('../../.build/app/src/cli/run.js');

const sink = { set() {}, done() {} };
const logger = { info() {}, warn() {}, error() {}, debug() {} };

test('operation runtime exposes explicit dependencies and external cancellation', () => {
  const controller = new AbortController();
  const runtime = createOperationRuntime({ progress: sink, logger, signal: controller.signal });
  assert.equal(typeof runtime.clock.now, 'function');
  assert.equal(typeof runtime.filesystem.existsSync, 'function');
  assert.equal(typeof runtime.tempDirectories.create, 'function');
  controller.abort();
  assert.throws(
    () => throwIfOperationAborted(runtime, 'before-dispatch'),
    (error) => error && error.code === 'E_OPERATION_CANCELLED',
  );
  disposeOperationRuntime(runtime);
});

test('operation timeout aborts through the same runtime contract', async () => {
  const runtime = createOperationRuntime({ progress: sink, logger, timeoutMs: 10 });
  try {
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.throws(
      () => throwIfOperationAborted(runtime, 'slow-stage'),
      (error) => error && error.code === 'E_OPERATION_TIMEOUT',
    );
  } finally {
    disposeOperationRuntime(runtime);
  }
});

test('operation stages emit structured progress and deterministic timing telemetry', async () => {
  const timestamps = [100, 110, 145, 150];
  const progressEvents = [];
  const runtime = createOperationRuntime({
    progress: { ...sink, report(event) { progressEvents.push(event); } },
    logger,
    clock: { now() { return timestamps.shift(); } },
  });
  try {
    const value = await runOperationStage(runtime, 'detection', () => Promise.resolve(7));
    assert.equal(value, 7);
    assert.deepEqual(progressEvents, [
      { stage: 'detection', completed: 0, total: 1, unit: 'stage', operationId: runtime.operationId },
      { stage: 'detection', completed: 1, total: 1, unit: 'stage', operationId: runtime.operationId },
    ]);
    assert.deepEqual(getOperationTelemetry(runtime), {
      operationId: runtime.operationId,
      elapsedMs: 50,
      stageTimings: { detection: 35 },
    });
  } finally {
    disposeOperationRuntime(runtime);
  }
});

test('an aborted transaction cannot publish or replace final output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-runtime-transaction-'));
  const output = path.join(root, 'output');
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'sentinel.txt'), 'preserve');
  const controller = new AbortController();
  const transaction = new WorkspaceTransaction({ outputPath: output, force: true, signal: controller.signal });
  try {
    fs.writeFileSync(path.join(transaction.stagingPath, 'replacement.txt'), 'new');
    controller.abort();
    assert.throws(
      () => transaction.commit(),
      (error) => error && error.code === 'E_OPERATION_CANCELLED',
    );
  } finally {
    transaction.dispose();
  }
  assert.equal(fs.readFileSync(path.join(output, 'sentinel.txt'), 'utf8'), 'preserve');
  assert.equal(fs.existsSync(path.join(output, 'replacement.txt')), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('application rejects an externally aborted request before an operation starts', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await executeAgentRequest({
    schemaVersion: 2,
    operation: 'verify',
    format: 'auto',
    projectPath: path.resolve(__dirname, '..', '..', '..', 'fixtures', 'rpgmv-basic'),
    profile: 'standard',
    options: {},
    patches: [],
  }, { signal: controller.signal });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'E_OPERATION_CANCELLED');
  assert.equal(typeof result.stats.performance.operationId, 'string');
  assert.equal(typeof result.stats.performance.elapsedMs, 'number');
  assert.equal(typeof result.stats.performance.stageTimings.detection, 'number');
});
