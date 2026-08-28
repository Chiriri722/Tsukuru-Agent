const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const AdmZip = require('adm-zip');

const {
  inspectDeterministicZip,
  normalizeReleaseZip,
} = require('../../scripts/normalize-release-zip.js');

const sha256 = (target) => crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');

function writeFixture(target, date, reversed = false) {
  const zip = new AdmZip({ noSort: true });
  zip.comment = `build-${date.getFullYear()}`;
  const entries = [
    ['z-last.txt', Buffer.from('last')],
    ['alpha/', Buffer.alloc(0)],
    ['alpha/first.txt', Buffer.from('first')],
  ];
  for (const [name, data] of reversed ? entries.toReversed() : entries) {
    const entry = zip.addFile(name, data, '', name.endsWith('/') ? 0o755 : 0o644);
    entry.header.time = date;
    entry.extra = Buffer.from(`feca0400${date.getFullYear().toString(16).padStart(8, '0')}`, 'hex');
    entry.comment = `entry-${date.getFullYear()}`;
  }
  zip.writeZip(target);
}

test('normalizes release ZIP timestamps and order into an idempotent byte stream', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-release-zip-'));
  const first = path.join(root, 'first.zip');
  const second = path.join(root, 'second.zip');
  writeFixture(first, new Date(2025, 1, 2, 3, 4, 6));
  writeFixture(second, new Date(2026, 2, 3, 4, 5, 8), true);
  assert.notEqual(sha256(first), sha256(second));

  const firstResult = normalizeReleaseZip(first);
  const secondResult = normalizeReleaseZip(second);
  assert.equal(sha256(first), sha256(second));
  assert.deepEqual(firstResult, secondResult);
  assert.equal(firstResult.entries, 3);
  assert.equal(firstResult.fixedTimestamp, '2000-01-01T00:00:00');
  assert.deepEqual(new AdmZip(first).getEntries().map((entry) => entry.entryName), [
    'alpha/',
    'alpha/first.txt',
    'z-last.txt',
  ]);
  assert.equal(new AdmZip(first).comment ?? '', '');
  assert.ok(new AdmZip(first).getEntries().every((entry) => entry.extra.length === 0 && entry.comment === ''));
  assert.equal(new AdmZip(first).readAsText('alpha/first.txt'), 'first');
  const once = sha256(first);
  normalizeReleaseZip(first);
  assert.equal(sha256(first), once);
  assert.deepEqual(inspectDeterministicZip(first), firstResult);

  const tampered = path.join(root, 'tampered-extra.zip');
  const tamperedZip = new AdmZip(first);
  tamperedZip.getEntries()[0].extra = Buffer.from('feca040001020304', 'hex');
  tamperedZip.writeZip(tampered);
  assert.throws(() => inspectDeterministicZip(tampered), /extra fields or comments/);

  const aliasCollision = path.join(root, 'alias-collision.zip');
  const aliasZip = new AdmZip({ noSort: true });
  for (const name of ['ALPHA.TXT.', 'alpha.txt']) {
    const entry = aliasZip.addFile(name, Buffer.from(name), '', 0o644);
    entry.header.time = new Date(2000, 0, 1, 0, 0, 0, 0);
  }
  aliasZip.writeZip(aliasCollision);
  assert.throws(() => inspectDeterministicZip(aliasCollision), /colliding entry names/);
});

test('CLI distribution build always runs deterministic ZIP normalization', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  assert.match(pkg.scripts['build:cli'], /normalize:cli-zip/);
  assert.equal(pkg.scripts['normalize:cli-zip'], 'node scripts/normalize-release-zip.js');
});
