const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');
const AdmZipFile = require('adm-zip/zipFile');
const AdmZipUtils = require('adm-zip/util');

const ROOT = path.resolve(__dirname, '..');
const FIXED_TIMESTAMP = '2000-01-01T00:00:00';

function fixedZipDate() {
  // ZIP stores a timezone-free DOS date. Constructing local midnight keeps the
  // encoded fields identical in every timezone instead of shifting through UTC.
  return new Date(2000, 0, 1, 0, 0, 0, 0);
}

function isFixedZipDate(value) {
  return value.getFullYear() === 2000
    && value.getMonth() === 0
    && value.getDate() === 1
    && value.getHours() === 0
    && value.getMinutes() === 0
    && value.getSeconds() === 0;
}

function entryOrder(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function windowsCollisionKey(name) {
  return name
    .replaceAll('\\', '/')
    .normalize('NFC')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map((segment) => segment.replace(/[ .]+$/u, '').toLowerCase())
    .join('/');
}

function sha256(target) {
  return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function readZip(target) {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) throw new Error(`release ZIP does not exist: ${resolved}`);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`release ZIP must be a regular non-link file: ${resolved}`);
  }
  return { resolved, stat, zip: new AdmZip(resolved) };
}

function inspectDeterministicZip(target) {
  const { resolved, zip } = readZip(target);
  const entries = zip.getEntries();
  const names = entries.map((entry) => entry.entryName);
  const collisionKeys = names.map(windowsCollisionKey);
  if (new Set(collisionKeys).size !== collisionKeys.length) {
    throw new Error('release ZIP contains duplicate or Windows-colliding entry names');
  }
  const sorted = [...names].sort(entryOrder);
  if (!names.every((name, index) => name === sorted[index])) {
    throw new Error('release ZIP entries are not in deterministic name order');
  }
  const nonDeterministic = entries
    .filter((entry) => !isFixedZipDate(entry.header.time))
    .map((entry) => entry.entryName);
  if (nonDeterministic.length > 0) {
    throw new Error(`release ZIP contains non-deterministic timestamps: ${nonDeterministic.slice(0, 5).join(', ')}`);
  }
  if (zip.comment) throw new Error('release ZIP contains a non-deterministic archive comment');
  const metadataEntries = entries
    .filter((entry) => entry.extra.length > 0 || entry.comment !== '')
    .map((entry) => entry.entryName);
  if (metadataEntries.length > 0) {
    throw new Error(`release ZIP contains non-deterministic extra fields or comments: ${metadataEntries.slice(0, 5).join(', ')}`);
  }
  return {
    entries: entries.length,
    fixedTimestamp: FIXED_TIMESTAMP,
    sha256: sha256(resolved),
  };
}

function normalizeReleaseZip(target) {
  const { resolved, stat } = readZip(target);
  const zip = new AdmZipFile(fs.readFileSync(resolved), {
    noSort: true,
    decoder: AdmZipUtils.decoder,
  });
  const fixed = fixedZipDate();
  const entries = zip.entries;
  for (const entry of entries) {
    entry.header.time = fixed;
    // electron-builder records per-build NTFS mtimes in ZIP extra field 0x000a.
    // They do not affect extracted content, so canonical packages omit all
    // entry extras and comments rather than preserving volatile metadata.
    entry.extra = Buffer.alloc(0);
    entry.comment = '';
  }
  zip.comment = '';

  const sortedEntries = [...entries].sort((left, right) => entryOrder(left.entryName, right.entryName));
  for (const entry of entries) zip.deleteEntry(entry.entryName);
  for (const entry of sortedEntries) zip.setEntry(entry);

  const suffix = `${process.pid}-${crypto.randomUUID()}`;
  const temporary = path.join(path.dirname(resolved), `.${path.basename(resolved)}.normalize-${suffix}`);
  const backup = path.join(path.dirname(resolved), `.${path.basename(resolved)}.backup-${suffix}`);
  try {
    fs.writeFileSync(temporary, zip.compressToBuffer());
    fs.chmodSync(temporary, stat.mode);
    inspectDeterministicZip(temporary);
    fs.renameSync(resolved, backup);
    try {
      fs.renameSync(temporary, resolved);
    } catch (error) {
      if (!fs.existsSync(resolved) && fs.existsSync(backup)) fs.renameSync(backup, resolved);
      throw error;
    }
    fs.rmSync(backup, { force: true });
    return inspectDeterministicZip(resolved);
  } finally {
    fs.rmSync(temporary, { force: true });
    if (fs.existsSync(backup) && fs.existsSync(resolved)) fs.rmSync(backup, { force: true });
  }
}

function defaultArtifactPath() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return path.join(ROOT, 'dist-cli', `tsukuru-agent-${pkg.version}-win.zip`);
}

function main(argv = process.argv.slice(2)) {
  const targets = argv.length > 0 ? argv : [defaultArtifactPath()];
  for (const target of targets) {
    const result = normalizeReleaseZip(target);
    process.stdout.write(
      `deterministic ZIP normalized: ${path.basename(target)}, ${result.entries} entries, ${result.sha256}\n`,
    );
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  FIXED_TIMESTAMP,
  inspectDeterministicZip,
  normalizeReleaseZip,
};
