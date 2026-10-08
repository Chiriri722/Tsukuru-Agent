const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

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

test('container copies handle Unicode paths, overwrite policy, exclusions and linked destinations', t => {
  const { copyTreeWithoutLinks } = require(path.join(stageRoot, 'src/core/container/fileSystemPolicy.js'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-copy-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, '원본');
  const target = path.join(root, '복사본');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'text.txt'), 'original');
  fs.writeFileSync(path.join(source, 'skip.txt'), 'excluded');
  copyTreeWithoutLinks(source, target, { filter: file => !file.endsWith('skip.txt'), preserveTimestamps: true });
  assert.deepEqual(fs.readdirSync(target), ['text.txt']);
  fs.writeFileSync(path.join(target, 'text.txt'), 'previous');
  copyTreeWithoutLinks(source, target, { force: false });
  assert.equal(fs.readFileSync(path.join(target, 'text.txt'), 'utf8'), 'previous');
  assert.throws(() => copyTreeWithoutLinks(source, target, { force: false, errorOnExist: true }));
  copyTreeWithoutLinks(source, target);
  assert.equal(fs.readFileSync(path.join(target, 'text.txt'), 'utf8'), 'original');
  assert.throws(() => copyTreeWithoutLinks(source, path.join(source, 'nested')));
  const linked = path.join(root, 'linked');
  fs.symlinkSync(source, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => copyTreeWithoutLinks(source, linked));
  const missing = path.join(root, 'missing');
  const dangling = path.join(target, 'text.txt');
  fs.unlinkSync(dangling);
  fs.symlinkSync(missing, dangling, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => copyTreeWithoutLinks(source, target));
  assert.equal(fs.existsSync(missing), false);
  assert.equal(fs.readFileSync(path.join(source, 'text.txt'), 'utf8'), 'original');
});
