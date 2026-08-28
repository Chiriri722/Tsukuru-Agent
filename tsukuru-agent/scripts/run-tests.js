const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { collectInventory } = require('./check-test-inventory.js');

const appRoot = path.resolve(__dirname, '..');

function createTestTempRoot() {
  const systemTemp = path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(path.join(systemTemp, 'tsukuru-test-run-'));
  if (path.dirname(path.resolve(root)) !== systemTemp) {
    throw new Error(`refusing unexpected test temp root: ${root}`);
  }
  return root;
}

function removeTestTempRoot(root) {
  const systemTemp = path.resolve(os.tmpdir());
  if (path.dirname(path.resolve(root)) !== systemTemp || !path.basename(root).startsWith('tsukuru-test-run-')) {
    throw new Error(`refusing unsafe test temp cleanup: ${root}`);
  }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  if (fs.existsSync(root)) throw new Error(`test temp root remains after cleanup: ${root}`);
}

function orderTestFiles(files, seed) {
  const ordered = [...files];
  if (seed === undefined) return ordered;
  let state = seed >>> 0;
  const random = () => {
    state = ((state * 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let index = ordered.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [ordered[index], ordered[swapIndex]] = [ordered[swapIndex], ordered[index]];
  }
  return ordered;
}

function runTests(argv = []) {
  const unknown = argv.filter((argument) =>
    argument !== '--coverage' && argument !== '--coverage-core' && !argument.startsWith('--order-seed='));
  if (unknown.length > 0) throw new Error(`unknown test runner argument: ${unknown[0]}`);
  const coverageCore = argv.includes('--coverage-core');
  const coverage = argv.includes('--coverage') || coverageCore;
  if (coverageCore && argv.includes('--coverage')) throw new Error('choose either --coverage or --coverage-core');
  const seedArguments = argv.filter((argument) => argument.startsWith('--order-seed='));
  if (seedArguments.length > 1) throw new Error('--order-seed may be provided only once');
  const seedText = seedArguments[0]?.slice('--order-seed='.length);
  const orderSeed = seedText === undefined ? undefined : Number(seedText);
  if (orderSeed !== undefined && (!Number.isInteger(orderSeed) || orderSeed < 0 || orderSeed > 0xffffffff)) {
    throw new Error('--order-seed must be an unsigned 32-bit integer');
  }
  const tempRoot = createTestTempRoot();
  let child;
  let cleanupError;
  try {
    const files = orderTestFiles(collectInventory().files, orderSeed);
    const nodeArguments = ['--test', '--test-concurrency=1'];
    if (coverage) nodeArguments.push('--experimental-test-coverage');
    if (coverageCore) {
      nodeArguments.push(
        '--test-coverage-include=.build/app/src/core/schema.js',
        '--test-coverage-include=.build/app/src/core/atomic.js',
        '--test-coverage-include=.build/app/src/electron/ipcPolicy.js',
        '--test-coverage-include=.build/app/src/electron/atomicTextReplace.js',
        '--test-coverage-include=.build/app/src/electron/versionPort.js',
        '--test-coverage-lines=70',
        '--test-coverage-branches=50',
        '--test-coverage-functions=85',
      );
    }
    child = spawnSync(process.execPath, [...nodeArguments, ...files], {
      cwd: appRoot,
      env: { ...process.env, TEMP: tempRoot, TMP: tempRoot, TMPDIR: tempRoot },
      stdio: 'inherit',
    });
  } finally {
    try {
      removeTestTempRoot(tempRoot);
    } catch (error) {
      cleanupError = error;
    }
  }
  if (child?.error) throw child.error;
  if (cleanupError) throw cleanupError;
  return child?.status ?? 1;
}

if (require.main === module) {
  try {
    process.exitCode = runTests(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`test runner failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { createTestTempRoot, orderTestFiles, removeTestTempRoot, runTests };
