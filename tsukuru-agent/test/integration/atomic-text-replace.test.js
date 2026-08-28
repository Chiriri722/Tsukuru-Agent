const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { replaceAllStringsAtomic } = require('../../.build/app/src/electron/atomicTextReplace.js');
const { portVersionTranslationsAtomic } = require('../../.build/app/src/electron/versionPort.js');

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-atomic-replace-'));
  fs.mkdirSync(path.join(root, 'Extract', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Extract', 'a.txt'), 'old / old\n', 'utf8');
  fs.writeFileSync(path.join(root, 'Extract', 'nested', 'b.json'), '{"text":"old"}\n', 'utf8');
  fs.writeFileSync(path.join(root, 'Extract', 'binary.bin'), Buffer.from([0, 255, 1, 2]));
  return root;
}

function withOneBackupCleanupFailure(callback) {
  const originalRmSync = fs.rmSync;
  let injected = false;
  fs.rmSync = function patchedRmSync(target, options) {
    if (!injected && path.basename(String(target)).includes('backup')) {
      injected = true;
      const error = new Error('simulated backup cleanup failure');
      error.code = 'EACCES';
      throw error;
    }
    return originalRmSync.call(fs, target, options);
  };
  try {
    const result = callback();
    assert.equal(injected, true, 'the backup cleanup failure must be exercised');
    return result;
  } finally {
    fs.rmSync = originalRmSync;
  }
}

test('atomic text replacement commits a complete tree and preserves binary files', () => {
  const root = makeRoot();
  try {
    const beforeBinary = fs.readFileSync(path.join(root, 'Extract', 'binary.bin'));
    const result = replaceAllStringsAtomic(root, 'old', 'new');
    assert.deepEqual(result, { filesScanned: 3, filesChanged: 2, replacements: 3 });
    assert.equal(fs.readFileSync(path.join(root, 'Extract', 'a.txt'), 'utf8'), 'new / new\n');
    assert.equal(fs.readFileSync(path.join(root, 'Extract', 'nested', 'b.json'), 'utf8'), '{"text":"new"}\n');
    assert.deepEqual(fs.readFileSync(path.join(root, 'Extract', 'binary.bin')), beforeBinary);
    assert.deepEqual(fs.readdirSync(root).sort(), ['Extract']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('atomic text replacement reports success when only old-backup cleanup fails', () => {
  const root = makeRoot();
  try {
    const result = withOneBackupCleanupFailure(() => replaceAllStringsAtomic(root, 'old', 'new'));
    assert.deepEqual(result, { filesScanned: 3, filesChanged: 2, replacements: 3 });
    assert.equal(fs.readFileSync(path.join(root, 'Extract', 'a.txt'), 'utf8'), 'new / new\n');
    assert.deepEqual(fs.readdirSync(root).sort(), ['Extract']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('atomic text replacement rejects invalid requests before mutation', () => {
  const root = makeRoot();
  try {
    const before = fs.readFileSync(path.join(root, 'Extract', 'a.txt'), 'utf8');
    assert.throws(() => replaceAllStringsAtomic(root, '', 'new'), /search string/i);
    assert.throws(() => replaceAllStringsAtomic(root, 'old', 'old'), /different/i);
    assert.equal(fs.readFileSync(path.join(root, 'Extract', 'a.txt'), 'utf8'), before);
    assert.deepEqual(fs.readdirSync(root).sort(), ['Extract']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('atomic text replacement rejects a missing Extract workspace without leftovers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-atomic-replace-missing-'));
  try {
    assert.throws(() => replaceAllStringsAtomic(root, 'old', 'new'), /Extract directory/i);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('atomic text replacement cancellation rolls back the staged tree', () => {
  const root = makeRoot();
  const controller = new AbortController();
  try {
    const before = fs.readFileSync(path.join(root, 'Extract', 'a.txt'), 'utf8');
    assert.throws(
      () => replaceAllStringsAtomic(root, 'old', 'new', {
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
      (error) => error && error.code === 'E_OPERATION_CANCELLED',
    );
    assert.equal(fs.readFileSync(path.join(root, 'Extract', 'a.txt'), 'utf8'), before);
    assert.deepEqual(fs.readdirSync(root).sort(), ['Extract']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('atomic text replacement rejects a link inserted after its preflight scan', (t) => {
  const root = makeRoot();
  const extract = path.join(root, 'Extract');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-atomic-replace-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  const originalCpSync = fs.cpSync;
  let injected = false;
  let skipped = false;
  fs.cpSync = function patchedCpSync(source, target, options) {
    if (!injected && path.resolve(String(source)) === path.resolve(extract)) {
      try {
        fs.symlinkSync(outside, path.join(extract, 'late-link'), process.platform === 'win32' ? 'junction' : 'dir');
      } catch (error) {
        error.linkCreationUnavailable = true;
        throw error;
      }
      injected = true;
    }
    return originalCpSync.call(fs, source, target, options);
  };
  try {
    assert.throws(
      () => replaceAllStringsAtomic(root, 'old', 'new'),
      (error) => {
        if (error?.linkCreationUnavailable) {
          skipped = true;
          t.skip(`symlink/junction creation unavailable: ${error.code}`);
          return true;
        }
        return /symbolic links|junction|심볼릭|정션/i.test(error?.message ?? '');
      },
    );
    if (skipped) return;
    assert.equal(injected, true);
    assert.equal(fs.readFileSync(path.join(extract, 'a.txt'), 'utf8'), 'old / old\n');
    assert.deepEqual(fs.readdirSync(root).sort(), ['Extract']);
  } finally {
    fs.cpSync = originalCpSync;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

function makeVersionPortRoots() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-version-port-'));
  const translatedRoot = path.join(root, 'translated');
  const oldRoot = path.join(root, 'old');
  const newRoot = path.join(root, 'new');
  for (const workspace of [translatedRoot, oldRoot, newRoot]) {
    fs.mkdirSync(path.join(workspace, 'Extract'), { recursive: true });
  }
  fs.writeFileSync(path.join(oldRoot, 'Extract', 'Actors.txt'), 'hello\nworld\nhello\n', 'utf8');
  fs.writeFileSync(path.join(translatedRoot, 'Extract', 'Actors.txt'), '안녕\n세계\n안녕\n', 'utf8');
  fs.writeFileSync(path.join(newRoot, 'Extract', 'Actors.txt'), 'prefix\nhello\nworld\nhello\nsuffix\n', 'utf8');
  fs.writeFileSync(path.join(newRoot, 'Extract', 'binary.bin'), Buffer.from([0, 255, 1]));
  return { root, translatedRoot, oldRoot, newRoot };
}

test('version translation port commits the complete new Extract tree atomically', () => {
  const roots = makeVersionPortRoots();
  const progress = [];
  try {
    const binaryBefore = fs.readFileSync(path.join(roots.newRoot, 'Extract', 'binary.bin'));
    const result = portVersionTranslationsAtomic({
      translatedRoot: roots.translatedRoot,
      oldRoot: roots.oldRoot,
      newRoot: roots.newRoot,
      onProgress: (value) => progress.push(value),
    });
    assert.deepEqual(result, { filesScanned: 1, filesChanged: 1, replacements: 3 });
    assert.equal(
      fs.readFileSync(path.join(roots.newRoot, 'Extract', 'Actors.txt'), 'utf8'),
      'prefix\n안녕\n세계\n안녕\nsuffix\n',
    );
    assert.deepEqual(fs.readFileSync(path.join(roots.newRoot, 'Extract', 'binary.bin')), binaryBefore);
    assert.deepEqual(progress, [100]);
    assert.deepEqual(fs.readdirSync(roots.newRoot).sort(), ['Extract']);
  } finally {
    fs.rmSync(roots.root, { recursive: true, force: true });
  }
});

test('version translation port reports success when only old-backup cleanup fails', () => {
  const roots = makeVersionPortRoots();
  try {
    const result = withOneBackupCleanupFailure(() => portVersionTranslationsAtomic(roots));
    assert.deepEqual(result, { filesScanned: 1, filesChanged: 1, replacements: 3 });
    assert.equal(
      fs.readFileSync(path.join(roots.newRoot, 'Extract', 'Actors.txt'), 'utf8'),
      'prefix\n안녕\n세계\n안녕\nsuffix\n',
    );
    assert.deepEqual(fs.readdirSync(roots.newRoot).sort(), ['Extract']);
  } finally {
    fs.rmSync(roots.root, { recursive: true, force: true });
  }
});

test('version translation port rejects incomplete mappings before mutating the new Extract tree', () => {
  const roots = makeVersionPortRoots();
  try {
    fs.rmSync(path.join(roots.translatedRoot, 'Extract', 'Actors.txt'));
    const before = fs.readFileSync(path.join(roots.newRoot, 'Extract', 'Actors.txt'), 'utf8');
    assert.throws(
      () => portVersionTranslationsAtomic(roots),
      /translated Extract file is missing/i,
    );
    assert.equal(fs.readFileSync(path.join(roots.newRoot, 'Extract', 'Actors.txt'), 'utf8'), before);
    assert.deepEqual(fs.readdirSync(roots.newRoot).sort(), ['Extract']);
  } finally {
    fs.rmSync(roots.root, { recursive: true, force: true });
  }
});

test('version translation port rejects overlapping workspaces', () => {
  const roots = makeVersionPortRoots();
  try {
    assert.throws(
      () => portVersionTranslationsAtomic({
        translatedRoot: roots.translatedRoot,
        oldRoot: roots.oldRoot,
        newRoot: roots.oldRoot,
      }),
      /distinct/i,
    );
  } finally {
    fs.rmSync(roots.root, { recursive: true, force: true });
  }
});

test('version translation port cancellation leaves the new workspace unchanged', () => {
  const roots = makeVersionPortRoots();
  const controller = new AbortController();
  try {
    const before = fs.readFileSync(path.join(roots.newRoot, 'Extract', 'Actors.txt'), 'utf8');
    assert.throws(
      () => portVersionTranslationsAtomic({
        ...roots,
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
      (error) => error && error.code === 'E_OPERATION_CANCELLED',
    );
    assert.equal(fs.readFileSync(path.join(roots.newRoot, 'Extract', 'Actors.txt'), 'utf8'), before);
    assert.deepEqual(fs.readdirSync(roots.newRoot).sort(), ['Extract']);
  } finally {
    fs.rmSync(roots.root, { recursive: true, force: true });
  }
});

test('version translation port rejects a link inserted after its preflight scan', (t) => {
  const roots = makeVersionPortRoots();
  const newExtract = path.join(roots.newRoot, 'Extract');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-version-port-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  const originalCpSync = fs.cpSync;
  let injected = false;
  let skipped = false;
  fs.cpSync = function patchedCpSync(source, target, options) {
    if (!injected && path.resolve(String(source)) === path.resolve(newExtract)) {
      try {
        fs.symlinkSync(outside, path.join(newExtract, 'late-link'), process.platform === 'win32' ? 'junction' : 'dir');
      } catch (error) {
        error.linkCreationUnavailable = true;
        throw error;
      }
      injected = true;
    }
    return originalCpSync.call(fs, source, target, options);
  };
  try {
    assert.throws(
      () => portVersionTranslationsAtomic(roots),
      (error) => {
        if (error?.linkCreationUnavailable) {
          skipped = true;
          t.skip(`symlink/junction creation unavailable: ${error.code}`);
          return true;
        }
        return /symbolic links|junction|심볼릭|정션/i.test(error?.message ?? '');
      },
    );
    if (skipped) return;
    assert.equal(injected, true);
    assert.equal(
      fs.readFileSync(path.join(newExtract, 'Actors.txt'), 'utf8'),
      'prefix\nhello\nworld\nhello\nsuffix\n',
    );
    assert.deepEqual(fs.readdirSync(roots.newRoot).sort(), ['Extract']);
  } finally {
    fs.cpSync = originalCpSync;
    fs.rmSync(roots.root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
