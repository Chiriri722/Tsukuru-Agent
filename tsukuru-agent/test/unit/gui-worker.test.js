const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { GuiWorkerExecutor } = require('../../.build/app/src/electron/guiWorkerExecutor.js');

const workerPath = path.resolve(__dirname, '..', 'helpers', 'blocking-operation-worker.js');

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('GUI worker keeps the main event loop responsive during synchronous work', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-gui-worker-'));
  const executor = new GuiWorkerExecutor(workerPath);
  try {
    let timerFired = false;
    setTimeout(() => { timerFired = true; }, 20);
    const result = await executor.run({ root, durationMs: 150 });
    assert.deepEqual(result, { ok: true });
    assert.equal(timerFired, true);
    assert.equal(executor.activeCount(), 0);
    assert.equal(fs.existsSync(path.join(root, '.worker-staging')), false);
  } finally {
    await executor.terminate();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('GUI worker cancellation is visible inside a blocking loop and cleans staging', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-gui-worker-cancel-'));
  const executor = new GuiWorkerExecutor(workerPath);
  try {
    let started;
    const ready = new Promise((resolve) => { started = resolve; });
    const operation = executor.run({ root, durationMs: 5000 }, {
      onProgress(percent) { if (percent === 1) started(); },
    });
    await ready;
    assert.equal(executor.cancel(), true);
    await assert.rejects(operation, (error) => error && error.code === 'E_OPERATION_CANCELLED');
    assert.equal(executor.activeCount(), 0);
    assert.equal(fs.existsSync(path.join(root, '.worker-staging')), false);
  } finally {
    await executor.terminate();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('GUI worker termination waits for staging and child-process cleanup', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-gui-worker-terminate-'));
  const executor = new GuiWorkerExecutor(workerPath);
  let childPid;
  try {
    let started;
    const ready = new Promise((resolve) => { started = resolve; });
    const operation = executor.run({ root, durationMs: 5000, spawnChild: true }, {
      onProgress(percent) { if (percent === 1) started(); },
    });
    await ready;
    childPid = Number(fs.readFileSync(path.join(root, 'child.pid'), 'utf8'));
    assert.equal(alive(childPid), true);

    const rejected = assert.rejects(operation, (error) => error && error.code === 'E_OPERATION_CANCELLED');
    await executor.terminate();
    await rejected;
    assert.equal(executor.activeCount(), 0);
    assert.equal(fs.existsSync(path.join(root, '.worker-staging')), false);
    assert.equal(alive(childPid), false);
  } finally {
    await executor.terminate();
    if (childPid && alive(childPid)) {
      try { process.kill(childPid, 'SIGKILL'); } catch {}
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('production GUI adapters route long transforms through the worker boundary', () => {
  const appRoot = path.resolve(__dirname, '..', '..');
  const main = fs.readFileSync(path.join(appRoot, 'main.ts'), 'utf8');
  const rpgApply = fs.readFileSync(path.join(appRoot, 'src', 'js', 'rpgmv', 'apply.ts'), 'utf8');
  const wolfMain = fs.readFileSync(path.join(appRoot, 'src', 'js', 'wolf', 'main.ts'), 'utf8');
  const worker = fs.readFileSync(path.join(appRoot, 'src', 'electron', 'guiOperationWorker.ts'), 'utf8');
  for (const source of [main, rpgApply, wolfMain]) assert.match(source, /runGuiOperation\s*\(/);
  for (const operation of [
    'rpg-extract',
    'rpg-apply',
    'wolf-extract',
    'wolf-apply',
    'change-all-strings',
    'version-port',
  ]) {
    assert.match(worker, new RegExp(`['\"]${operation}['\"]`));
  }
  assert.doesNotMatch(main, /replaceAllStringsAtomic|portVersionTranslationsAtomic/);
  assert.match(worker, /setTrackedProcessObserver/);
  assert.match(worker, /setInterval[\s\S]*terminateTrackedProcesses/);
});
