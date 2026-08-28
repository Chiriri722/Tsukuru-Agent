const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(appRoot, '..');
const catalogPath = path.join(repoRoot, 'fixtures', 'catalog.json');

function hashTree(root) {
  const records = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else {
        const relative = path.relative(root, fullPath).split(path.sep).join('/');
        const hash = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
        records.push(`${relative}\0${hash}`);
      }
    }
  };
  visit(root);
  return crypto.createHash('sha256').update(records.join('\n')).digest('hex');
}

test('fixture catalog covers every supported engine and wrapper with deterministic recipes', () => {
  assert.equal(fs.existsSync(catalogPath), true, 'fixtures/catalog.json must exist');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  assert.equal(catalog.schemaVersion, 1);
  assert.deepEqual(catalog.fixtures.map((entry) => entry.id).sort(), [
    'electron-asar-rpgmz',
    'gdevelop-strict',
    'nwjs-package-nw',
    'rpgmv-basic',
    'rpgmz-basic',
    'tyrano-shift-jis',
    'tyrano-utf8',
    'wolf-map-v3',
  ]);

  for (const fixture of catalog.fixtures) {
    assert.deepEqual(fixture.coverage, ['detect', 'extract', 'patch', 'verify', 'apply']);
    assert.equal(fs.existsSync(path.join(repoRoot, fixture.testFile)), true, `${fixture.id} test file is missing`);
    if (fixture.kind === 'tracked-directory') {
      const fixturePath = path.join(repoRoot, fixture.path);
      assert.match(fixture.sha256, /^[0-9a-f]{64}$/);
      assert.equal(hashTree(fixturePath), fixture.sha256, `${fixture.id} fixture hash drifted`);
    } else {
      assert.equal(fixture.kind, 'generated');
      assert.match(fixture.recipe, /test\(/);
    }
  }
});
