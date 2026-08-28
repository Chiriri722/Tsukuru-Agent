const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..', '..');
const stageRoot = path.join(appRoot, '.build', 'app');

test('container registry exposes one immutable adapter per supported container type', () => {
  const { containerAdapterRegistry } = require(path.join(stageRoot, 'src', 'core', 'container', 'registry.js'));
  assert.deepEqual(Object.keys(containerAdapterRegistry), ['directory', 'electron-asar', 'nwjs-package']);
  assert.equal(Object.isFrozen(containerAdapterRegistry), true);
  for (const [type, adapter] of Object.entries(containerAdapterRegistry)) {
    assert.equal(adapter.type, type);
    assert.equal(typeof adapter.assertExtractable, 'function');
    assert.equal(typeof adapter.extract, 'function');
    assert.equal(typeof adapter.pack, 'function');
  }
});

test('common archive policy owns normalization, collisions, and unsafe path decisions', () => {
  const {
    archiveEntryCollisionKey,
    isUnsafeArchiveEntry,
    normalizeArchiveEntry,
  } = require(path.join(stageRoot, 'src', 'core', 'container', 'archivePolicy.js'));
  assert.equal(normalizeArchiveEntry('\\project\\data\\Actors.json/'), 'project/data/Actors.json');
  assert.equal(archiveEntryCollisionKey('Data/Foo. '), 'data/foo');
  assert.equal(isUnsafeArchiveEntry('../escape'), true);
  assert.equal(isUnsafeArchiveEntry('data/Actors.json'), false);
});

test('legacy container API is a thin compatibility barrel over focused modules', () => {
  const source = fs.readFileSync(path.join(appRoot, 'src', 'core', 'container.ts'), 'utf8');
  assert.doesNotMatch(source, /@electron\/asar|adm-zip|createPackageFromStreams|getEntries\(\)/);
  assert.match(source, /container\/registry/);
  assert.ok(source.split(/\r?\n/).length < 80, 'container.ts should remain a thin compatibility API');
});
