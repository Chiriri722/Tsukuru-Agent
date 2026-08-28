const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { parentPort, workerData } = require('node:worker_threads');

const cancelled = new Int32Array(workerData.cancelBuffer);
const staging = path.join(workerData.request.root, '.worker-staging');
let child;

function waitForChildClose(target) {
  if (target.exitCode !== null || target.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let timer;
    const finish = () => {
      if (timer) clearTimeout(timer);
      resolve();
    };
    target.once('close', finish);
    target.once('error', finish);
    timer = setTimeout(finish, 5000);
    timer.unref?.();
  });
}

async function main() {
  let response;
  try {
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(staging, 'partial.txt'), 'partial');
    if (workerData.request.spawnChild) {
      child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      fs.writeFileSync(path.join(workerData.request.root, 'child.pid'), String(child.pid));
      parentPort.postMessage({ type: 'child-process', state: 'spawn', pid: child.pid });
    }
    parentPort.postMessage({ type: 'progress', percent: 1 });
    const deadline = Date.now() + workerData.request.durationMs;
    while (Date.now() < deadline) {
      if (Atomics.load(cancelled, 0) === 1) {
        const error = new Error('cancelled');
        error.code = 'E_OPERATION_CANCELLED';
        throw error;
      }
    }
    response = { type: 'result', result: { ok: true } };
  } catch (error) {
    response = {
      type: 'error',
      error: { code: error.code || 'E_INTERNAL', message: error.message },
    };
  } finally {
    if (child?.pid) {
      const childClosed = waitForChildClose(child);
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } else {
        try { child.kill('SIGKILL'); } catch {}
      }
      await childClosed;
      parentPort.postMessage({ type: 'child-process', state: 'close', pid: child.pid });
    }
    fs.rmSync(staging, { recursive: true, force: true });
  }
  parentPort.postMessage(response);
}

void main();
