const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..', '..');
const modulePath = path.join(appRoot, '.build', 'app', 'src', 'core', 'externalBinaryPolicy.js');

test('bundled external binaries are accepted only when size and SHA-256 match inventory', () => {
  const policy = require(modulePath);
  const verified = policy.resolveVerifiedBundledBinary(appRoot, 'eztrans-server');
  assert.equal(verified, path.join(appRoot, 'exfiles', 'eztrans', 'EztransServer.exe'));

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-binary-policy-'));
  try {
    const tampered = path.join(tempRoot, 'EztransServer.exe');
    fs.copyFileSync(verified, tampered);
    const handle = fs.openSync(tampered, 'r+');
    try {
      const first = Buffer.alloc(1);
      fs.readSync(handle, first, 0, 1, 0);
      first[0] ^= 0xff;
      fs.writeSync(handle, first, 0, 1, 0);
    } finally {
      fs.closeSync(handle);
    }
    assert.throws(
      () => policy.verifyExternalBinary('eztrans-server', tampered),
      (error) => error?.code === 'E_EXTERNAL_BINARY_INTEGRITY' && /SHA-256 mismatch/.test(error.message),
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
