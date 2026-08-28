const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { enumerateRegularFilesWithoutLinks } = require('../../.build/app/src/core/pathSafety.js');
const { isWithinPath: isWithinArchivePath } = require('../../.build/app/src/core/container/archivePolicy.js');
const { isWithinPath: isWithinWorkspacePath } = require('../../.build/app/src/cli/workspacePathPolicy.js');

test('path containment helpers do not classify an immediate parent as a child', () => {
  const parent = path.join(os.tmpdir(), 'tsukuru-containment-parent', 'child');
  const immediateParent = path.dirname(parent);
  for (const isWithinPath of [isWithinArchivePath, isWithinWorkspacePath]) {
    assert.equal(isWithinPath(parent, immediateParent), false);
    assert.equal(isWithinPath(parent, parent), true);
    assert.equal(isWithinPath(parent, path.join(parent, 'nested')), true);
  }
});

test('safe file enumeration includes extensionless and dot files in deterministic order', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-path-enumerate-'));
  fs.mkdirSync(path.join(root, 'nested'));
  fs.writeFileSync(path.join(root, 'z.txt'), 'z');
  fs.writeFileSync(path.join(root, 'README'), 'readme');
  fs.writeFileSync(path.join(root, '.metadata'), 'hidden');
  fs.writeFileSync(path.join(root, 'nested', 'a.json'), '{}');

  assert.equal(typeof enumerateRegularFilesWithoutLinks, 'function');
  assert.deepEqual(
    enumerateRegularFilesWithoutLinks(root).map((file) => path.relative(root, file).replaceAll('\\', '/')),
    ['.metadata', 'README', 'nested/a.json', 'z.txt'],
  );
});

test('safe file enumeration rejects a directory junction instead of following it', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-path-link-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-path-link-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside');
  const linked = path.join(root, 'linked');
  try {
    fs.symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) {
      t.skip(`junction creation is unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  assert.equal(typeof enumerateRegularFilesWithoutLinks, 'function');
  assert.throws(
    () => enumerateRegularFilesWithoutLinks(root),
    /symbolic link|junction/i,
  );
});
