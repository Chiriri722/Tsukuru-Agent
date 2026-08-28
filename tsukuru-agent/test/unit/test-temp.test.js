const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createTestTempRoot, orderTestFiles, removeTestTempRoot } = require('../../scripts/run-tests.js');

test('test temp roots are isolated under the OS temp directory and fully removed', () => {
  const root = createTestTempRoot();
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.match(path.basename(root), /^tsukuru-test-run-/);
  fs.mkdirSync(path.join(root, 'nested'));
  fs.writeFileSync(path.join(root, 'nested', 'artifact.txt'), 'temporary');

  removeTestTempRoot(root);

  assert.equal(fs.existsSync(root), false);
});

test('test temp cleanup refuses paths outside its exact generated namespace', () => {
  assert.throws(() => removeTestTempRoot(path.resolve(os.tmpdir())), /unsafe test temp cleanup/);
  assert.throws(() => removeTestTempRoot(path.join(os.tmpdir(), 'unrelated')), /unsafe test temp cleanup/);
});

test('test file ordering is deterministic for a replayable seed', () => {
  const files = ['a.test.js', 'b.test.js', 'c.test.js', 'd.test.js', 'e.test.js'];
  const first = orderTestFiles(files, 1414747474);
  const second = orderTestFiles(files, 1414747474);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, files);
  assert.deepEqual(files, ['a.test.js', 'b.test.js', 'c.test.js', 'd.test.js', 'e.test.js']);
});

test('test file ordering remains unchanged when no seed is requested', () => {
  const files = ['a.test.js', 'b.test.js'];
  assert.deepEqual(orderTestFiles(files), files);
});
