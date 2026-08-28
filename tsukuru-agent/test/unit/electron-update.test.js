const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../.build/app/src/electron/updatePolicy.js');

test('update policy accepts only canonical numeric semantic versions', () => {
  const { compareVersions, parseVersion } = require(modulePath);
  assert.deepEqual(parseVersion('2.5.0'), [2, 5, 0]);
  assert.equal(compareVersions('2.5.0', '2.5.1'), -1);
  assert.equal(compareVersions('2.5.0', '2.5.0'), 0);
  assert.equal(compareVersions('3.0.0', '2.99.99'), 1);
  for (const invalid of ['v2.5.0', '2.5', '2.5.0-beta', '2.05.0', '', 250]) {
    assert.throws(() => parseVersion(invalid), /version/i);
  }
});

test('update policy reports an available release from a valid response', async () => {
  const { checkForUpdate, UPDATE_MANIFEST_URL } = require(modulePath);
  const calls = [];
  const result = await checkForUpdate('2.5.0', async (url, options) => {
    calls.push({ url, options });
    return { status: 200, data: { version: '2.6.0' } };
  });
  assert.deepEqual(result, {
    status: 'update-available',
    currentVersion: '2.5.0',
    latestVersion: '2.6.0',
  });
  assert.equal(calls[0].url, UPDATE_MANIFEST_URL);
  assert.equal(calls[0].options.timeout, 5000);
  assert.equal(calls[0].options.maxRedirects, 0);
});

test('update policy reports current without treating it as an error', async () => {
  const { checkForUpdate } = require(modulePath);
  assert.deepEqual(await checkForUpdate('2.5.0', async () => ({
    status: 200,
    data: { version: '2.5.0' },
  })), {
    status: 'current',
    currentVersion: '2.5.0',
    latestVersion: '2.5.0',
  });
});

test('update policy distinguishes invalid responses from offline failures', async () => {
  const { checkForUpdate } = require(modulePath);
  assert.deepEqual(await checkForUpdate('2.5.0', async () => ({ status: 200, data: { version: '../bad' } })), {
    status: 'invalid-response',
    currentVersion: '2.5.0',
  });
  assert.deepEqual(await checkForUpdate('2.5.0', async () => { throw new Error('offline C:\\private\\path'); }), {
    status: 'offline',
    currentVersion: '2.5.0',
  });
});

test('GUI error messages omit stacks and sensitive absolute paths', () => {
  const { publicErrorMessage } = require(path.resolve(__dirname, '../../.build/app/src/core/publicError.js'));
  const error = new Error('failed at C:\\Users\\Private\\secret.txt');
  error.stack = 'Error: failed\n    at C:\\Users\\Private\\source.ts:10:2';
  const message = publicErrorMessage(error);
  assert.match(message, /failed at \[path\]/);
  assert.doesNotMatch(message, /Private|source\.ts|stack|\n/);
  assert.equal(publicErrorMessage({ secret: 'C:\\private' }), 'The GUI operation failed.');
});
