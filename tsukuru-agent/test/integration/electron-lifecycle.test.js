const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');

const modulePath = path.resolve(__dirname, '../../.build/app/src/core/processRegistry.js');

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('Electron lifecycle registry terminates a tracked child process tree', async () => {
  const registry = require(modulePath);
  const childScript = [
    "const {spawn}=require('node:child_process')",
    "const nested=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'})",
    "process.stdout.write(String(nested.pid)+'\\n')",
    "setInterval(()=>{},1000)",
  ].join(';');
  const parent = registry.spawnTracked(process.execPath, ['-e', childScript], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let nestedPid;
  try {
    const [chunk] = await once(parent.stdout, 'data');
    nestedPid = Number(String(chunk).trim());
    assert.equal(registry.trackedProcessCount(), 1);
    assert.equal(alive(parent.pid), true);
    assert.equal(alive(nestedPid), true);

    registry.terminateTrackedProcesses();
    await Promise.race([
      once(parent, 'close'),
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('tracked process did not close')), 5000);
        timer.unref();
      }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(registry.trackedProcessCount(), 0);
    assert.equal(alive(parent.pid), false);
    assert.equal(alive(nestedPid), false);
  } finally {
    registry.terminateTrackedProcesses();
    if (nestedPid && alive(nestedPid)) {
      try { process.kill(nestedPid, 'SIGKILL'); } catch {}
    }
  }
});

test('Electron lifecycle registry enforces a bounded process timeout', async () => {
  const registry = require(modulePath);
  const child = registry.spawnTracked(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    stdio: 'ignore',
    timeoutMs: 100,
  });
  try {
    await Promise.race([
      once(child, 'close'),
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('timed process did not close')), 5000);
        timer.unref();
      }),
    ]);
    assert.equal(registry.trackedProcessCount(), 0);
    assert.equal(alive(child.pid), false);
  } finally {
    registry.terminateTrackedProcesses();
    if (child.pid && alive(child.pid)) {
      try { process.kill(child.pid, 'SIGKILL'); } catch {}
    }
  }
});

test('Electron lifecycle registry reports worker-owned child process state', async () => {
  const registry = require(modulePath);
  const events = [];
  registry.setTrackedProcessObserver((event) => events.push(event));
  const child = registry.spawnTracked(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    stdio: 'ignore',
  });
  try {
    assert.deepEqual(events, [{ state: 'spawn', pid: child.pid }]);
    registry.terminateTrackedProcesses();
    await Promise.race([
      once(child, 'close'),
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('observed process did not close')), 5000);
        timer.unref();
      }),
    ]);
    assert.deepEqual(events.at(-1), { state: 'close', pid: child.pid });
  } finally {
    registry.setTrackedProcessObserver(undefined);
    registry.terminateTrackedProcesses();
  }
});
