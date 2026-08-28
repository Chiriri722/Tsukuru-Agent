const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(appRoot, 'scripts', 'check-style-drift.js');
const api = fs.existsSync(scriptPath) ? require(scriptPath) : null;

test('style drift checker is present', () => {
  assert.ok(api, 'scripts/check-style-drift.js is missing');
});

test('tracked CSS exactly matches its SCSS source', { skip: !api }, () => {
  assert.deepEqual(api.collectStyleDriftIssues(), []);
});

test('style drift checker reports a stale generated CSS file', { skip: !api }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-style-drift-'));
  try {
    const scssPath = path.join(root, 'sample.scss');
    const cssPath = path.join(root, 'sample.css');
    fs.writeFileSync(scssPath, '.sample { color: red; }\n');
    fs.writeFileSync(cssPath, '.sample { color: blue; }\n');
    assert.deepEqual(api.collectStyleDriftIssues([{ scssPath, cssPath }]), [cssPath]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
