const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const AdmZip = require('adm-zip');

const {
  archiveEntryCollisionKey,
  inspectContainer,
  isUnsafeArchiveEntry,
} = require('../../.build/app/src/core/container.js');
const {
  normalizeAsarListedEntry,
} = require('../../.build/app/src/core/container/adapters/asar.js');

test('ASAR package-list prefixes are normalized without hiding absolute or UNC entries', () => {
  assert.equal(normalizeAsarListedEntry('/project/data/Actors.json'), 'project/data/Actors.json');
  assert.equal(normalizeAsarListedEntry('\\project\\data\\Actors.json'), 'project\\data\\Actors.json');
  assert.equal(normalizeAsarListedEntry('//server/share/file.txt'), '/server/share/file.txt');
  assert.equal(normalizeAsarListedEntry('\\\\server\\share\\file.txt'), '\\server\\share\\file.txt');
});

test('archive entry validation rejects traversal, platform aliases, NUL, and excessive paths', () => {
  for (const unsafe of [
    '',
    '/absolute/file.txt',
    'C:/drive/file.txt',
    'C:\\drive\\file.txt',
    '../escape.txt',
    'safe/../escape.txt',
    'safe\\..\\escape.txt',
    'safe\0hidden.txt',
    'safe/./alias.txt',
    `${'x'.repeat(256)}/file.txt`,
    `${'x'.repeat(4097)}.txt`,
  ]) {
    assert.equal(isUnsafeArchiveEntry(unsafe), true, unsafe);
  }
  assert.equal(isUnsafeArchiveEntry('한글/日本語/valid file.txt'), false);
});

test('archive collision keys model Windows case, Unicode, and trailing-dot aliases', () => {
  assert.equal(archiveEntryCollisionKey('Data/Actors.json'), archiveEntryCollisionKey('data/actors.JSON'));
  assert.equal(archiveEntryCollisionKey('café.txt'), archiveEntryCollisionKey('cafe\u0301.txt'));
  assert.equal(archiveEntryCollisionKey('data/name.'), archiveEntryCollisionKey('data/name'));
});

test('package.nw inspection rejects a case-colliding duplicate before extraction', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-nw-collision-'));
  const archive = path.join(root, 'package.nw');
  const zip = new AdmZip();
  zip.addFile('Data/Actors.json', Buffer.from('first'));
  zip.addFile('data/actors.JSON', Buffer.from('second'));
  zip.writeZip(archive);

  const inspected = inspectContainer(archive);
  assert.equal(inspected.archive.invalidEntryCount, 1);
  assert.equal(inspected.archive.fileCount, 1);
});
