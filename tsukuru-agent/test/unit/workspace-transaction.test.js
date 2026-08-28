const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..', '..');
const stageRoot = path.join(appRoot, '.build', 'app');
const { WorkspaceTransaction } = require(path.join(stageRoot, 'src', 'core', 'workspaceTransaction.js'));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-workspace-tx-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function leftovers(root) {
  return fs.readdirSync(root).filter((name) => name.includes('.tsukuru-'));
}

test('workspace transaction keeps a new final path invisible until commit', (t) => {
  const root = fixture(t);
  const output = path.join(root, 'Completed');
  const transaction = new WorkspaceTransaction({ outputPath: output });
  try {
    assert.equal(fs.existsSync(output), false);
    fs.writeFileSync(path.join(transaction.stagingPath, 'result.txt'), 'complete');
    assert.equal(fs.existsSync(output), false);
    transaction.commit();
    assert.equal(fs.readFileSync(path.join(output, 'result.txt'), 'utf8'), 'complete');
  } finally {
    transaction.dispose();
  }
  assert.deepEqual(leftovers(root), []);
});

test('force replacement preserves the previous output until atomic commit', (t) => {
  const root = fixture(t);
  const output = path.join(root, 'Completed');
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'state.txt'), 'old');
  const transaction = new WorkspaceTransaction({ outputPath: output, force: true });
  try {
    fs.writeFileSync(path.join(transaction.stagingPath, 'state.txt'), 'new');
    assert.equal(fs.readFileSync(path.join(output, 'state.txt'), 'utf8'), 'old');
    transaction.commit();
    assert.equal(fs.readFileSync(path.join(output, 'state.txt'), 'utf8'), 'new');
  } finally {
    transaction.dispose();
  }
  assert.deepEqual(leftovers(root), []);
});

test('successful commit is not reported as failed when old-backup cleanup fails', (t) => {
  const root = fixture(t);
  const output = path.join(root, 'Completed');
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'state.txt'), 'old');
  const transaction = new WorkspaceTransaction({ outputPath: output, force: true });
  fs.writeFileSync(path.join(transaction.stagingPath, 'state.txt'), 'new');
  const originalRemove = fs.rmSync;
  fs.rmSync = (candidate, options) => {
    if (path.resolve(candidate) === path.resolve(transaction.backupPath)) {
      throw new Error('simulated workspace backup cleanup failure');
    }
    return originalRemove(candidate, options);
  };
  try {
    assert.doesNotThrow(() => transaction.commit());
  } finally {
    fs.rmSync = originalRemove;
    transaction.dispose();
  }
  assert.equal(fs.readFileSync(path.join(output, 'state.txt'), 'utf8'), 'new');
  assert.deepEqual(leftovers(root), []);
});

test('workspace transaction dispose never masks an operation with staging cleanup failure', (t) => {
  const root = fixture(t);
  const output = path.join(root, 'Completed');
  const transaction = new WorkspaceTransaction({ outputPath: output });
  fs.writeFileSync(path.join(transaction.stagingPath, 'partial.txt'), 'partial');
  const originalRemove = fs.rmSync;
  fs.rmSync = (candidate, options) => {
    if (path.resolve(candidate) === path.resolve(transaction.stagingPath)) {
      throw new Error('simulated workspace staging cleanup failure');
    }
    return originalRemove(candidate, options);
  };
  try {
    assert.doesNotThrow(() => transaction.dispose());
  } finally {
    fs.rmSync = originalRemove;
  }
  assert.equal(fs.existsSync(output), false);
  fs.rmSync(transaction.stagingPath, { recursive: true, force: true });
});

test('rollback preserves an existing output and removes incomplete staging', (t) => {
  const root = fixture(t);
  const output = path.join(root, 'Completed');
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'state.txt'), 'old');
  const transaction = new WorkspaceTransaction({ outputPath: output, force: true });
  fs.writeFileSync(path.join(transaction.stagingPath, 'state.txt'), 'partial');
  transaction.rollback();
  transaction.dispose();
  assert.equal(fs.readFileSync(path.join(output, 'state.txt'), 'utf8'), 'old');
  assert.deepEqual(leftovers(root), []);
});

test('failed commit restores the previous output and leaves no backup', (t) => {
  const root = fixture(t);
  const output = path.join(root, 'Completed');
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'state.txt'), 'old');
  const transaction = new WorkspaceTransaction({ outputPath: output, force: true });
  fs.rmSync(transaction.stagingPath, { recursive: true, force: true });
  assert.throws(() => transaction.commit(), /staging/i);
  transaction.dispose();
  assert.equal(fs.readFileSync(path.join(output, 'state.txt'), 'utf8'), 'old');
  assert.deepEqual(leftovers(root), []);
});

test('failed commit preserves the install error when immediate backup restoration also fails', (t) => {
  const root = fixture(t);
  const output = path.join(root, 'Completed');
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'state.txt'), 'old');
  const transaction = new WorkspaceTransaction({ outputPath: output, force: true });
  fs.writeFileSync(path.join(transaction.stagingPath, 'state.txt'), 'new');
  const installError = new Error('simulated workspace install failure');
  const recoveryError = new Error('simulated workspace recovery failure');
  const originalRename = fs.renameSync;
  fs.renameSync = (source, destination) => {
    if (path.resolve(source) === path.resolve(transaction.stagingPath)
        && path.resolve(destination) === path.resolve(output)) {
      throw installError;
    }
    if (path.resolve(source) === path.resolve(transaction.backupPath)
        && path.resolve(destination) === path.resolve(output)) {
      throw recoveryError;
    }
    return originalRename(source, destination);
  };
  let thrown;
  try {
    transaction.commit();
  } catch (error) {
    thrown = error;
  } finally {
    fs.renameSync = originalRename;
  }

  assert.equal(thrown, installError);
  assert.equal(thrown.recoveryError, recoveryError);
  assert.equal(fs.existsSync(output), false);
  assert.equal(fs.readFileSync(path.join(transaction.backupPath, 'state.txt'), 'utf8'), 'old');
  transaction.dispose();
  assert.equal(fs.readFileSync(path.join(output, 'state.txt'), 'utf8'), 'old');
  assert.deepEqual(leftovers(root), []);
});

test('workspace transaction rejects output parents reached through a junction', (t) => {
  const root = fixture(t);
  const outside = path.join(root, 'outside');
  const linked = path.join(root, 'linked-parent');
  fs.mkdirSync(outside);
  try {
    fs.symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`symlink/junction creation unavailable: ${error.code}`);
    return;
  }
  assert.throws(
    () => new WorkspaceTransaction({ outputPath: path.join(linked, 'Completed'), force: true }),
    (error) => error?.code === 'E_OUTPUT_CONFLICT' && /link|junction|심볼릭|정션/i.test(error.message),
  );
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('workspace transaction never replaces an existing regular file with a directory', (t) => {
  const root = fixture(t);
  const output = path.join(root, 'game.exe');
  fs.writeFileSync(output, 'original');
  assert.throws(
    () => new WorkspaceTransaction({ outputPath: output, force: true }),
    (error) => error?.code === 'E_OUTPUT_CONFLICT' && /file|파일|directory|디렉터리/i.test(error.message),
  );
  assert.equal(fs.readFileSync(output, 'utf8'), 'original');
  assert.deepEqual(leftovers(root), []);
});
