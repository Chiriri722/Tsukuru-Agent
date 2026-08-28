const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(appRoot, 'scripts', 'css-rule-diff.js');
const api = fs.existsSync(scriptPath) ? require(scriptPath) : null;

test('CSS rule reconciliation utility is present', () => {
  assert.ok(api, 'scripts/css-rule-diff.js is missing');
});

test('CSS parser ignores formatting and declaration order', { skip: !api }, () => {
  const baseline = '.button, .link { color: red; padding: 0 1px; }';
  const candidate = '.button,.link{padding:0 1px;color:red}';
  assert.deepEqual(api.compareCssRules(baseline, candidate), {
    missing: [],
    added: [],
    changed: [],
    relocated: [],
  });
});

test('CSS comparison reports missing, added, and changed rules inside media blocks', { skip: !api }, () => {
  const baseline = `
    .kept { color: red; }
    .missing { opacity: 0; }
    @media (hover: hover) { .target:hover { color: blue; } }
  `;
  const candidate = `
    .kept { color: green; }
    .added { opacity: 1; }
    @media (hover: hover) { .target:hover { color: blue; } }
  `;
  const result = api.compareCssRules(baseline, candidate);
  assert.deepEqual(result.missing, ['.missing']);
  assert.deepEqual(result.added, ['.added']);
  assert.deepEqual(result.changed, ['.kept']);
  assert.deepEqual(result.relocated, []);
});

test('CSS comparison recognizes a selector moved behind an input-capability gate', { skip: !api }, () => {
  const baseline = '.target:hover { color: blue; }';
  const candidate = '@media (hover: hover) and (pointer: fine) { .target:hover { color: blue; } }';
  const result = api.compareCssRules(baseline, candidate);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.relocated, [
    '.target:hover -> @media(hover:hover)and(pointer:fine) :: .target:hover',
  ]);
});
