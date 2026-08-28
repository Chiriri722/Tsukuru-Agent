const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { recoverRpgManifest } = require('../../.build/app/src/cli/manifestRecovery.js');

function recoveryPack(lines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-recover-edge-'));
  fs.mkdirSync(path.join(root, 'Backup'));
  fs.mkdirSync(path.join(root, 'Extract'));
  const actors = [null, ...lines.map((text, index) => ({ id: index + 1, name: text }))];
  fs.writeFileSync(path.join(root, 'Backup', 'Actors.json'), JSON.stringify(actors));
  fs.writeFileSync(path.join(root, 'Extract', 'Actors.txt'), `${lines.join('\n')}\n`);
  return root;
}

function extractedMain(lines) {
  return {
    'Actors.json': {
      data: Object.fromEntries(lines.map((text, index) => [String(index), {
        origin: 'Actors.json',
        originText: text,
        val: `${index + 1}.name`,
        m: index + 1,
      }])),
    },
  };
}

test('manifest recovery rejects an empty extracted mapping', () => {
  const root = recoveryPack(['Alice']);
  assert.throws(
    () => recoverRpgManifest(root, {}),
    (error) => error.code === 'E_MAPPING_CORRUPT' && /복구할 manifest 항목/.test(error.message),
  );
});

test('manifest recovery rejects duplicate generated IDs', () => {
  const root = recoveryPack(['Alice', 'Bob']);
  const mapping = extractedMain(['Alice', 'Bob']);
  mapping['Actors.json'].data['1'].val = '1.name';
  assert.throws(
    () => recoverRpgManifest(root, mapping),
    (error) => error.code === 'E_MAPPING_CORRUPT' && /중복 ID/.test(error.message),
  );
});

test('manifest recovery rejects a Backup origin that is not a regular file', () => {
  const root = recoveryPack(['Alice']);
  fs.rmSync(path.join(root, 'Backup', 'Actors.json'));
  fs.mkdirSync(path.join(root, 'Backup', 'Actors.json'));

  assert.throws(
    () => recoverRpgManifest(root, extractedMain(['Alice'])),
    (error) => error.code === 'E_MAPPING_CORRUPT' && /일반 파일/.test(error.message),
  );
  assert.equal(fs.existsSync(path.join(root, 'Extract', 'manifest.json')), false);
});

test('manifest recovery rejects malformed Backup JSON before writing a manifest', () => {
  const root = recoveryPack(['Alice']);
  fs.writeFileSync(path.join(root, 'Backup', 'Actors.json'), '{ malformed json', 'utf8');

  assert.throws(
    () => recoverRpgManifest(root, extractedMain(['Alice'])),
    (error) => error.code === 'E_MAPPING_CORRUPT' && /Backup|JSON|파싱/i.test(error.message),
  );
  assert.equal(fs.existsSync(path.join(root, 'Extract', 'manifest.json')), false);
});

test('manifest recovery rejects prototype-bearing RPG data paths', () => {
  const root = recoveryPack(['Alice']);
  const mapping = extractedMain(['Alice']);
  mapping['Actors.json'].data['0'].val = '__proto__.polluted';

  assert.throws(
    () => recoverRpgManifest(root, mapping),
    (error) => error.code === 'E_MAPPING_CORRUPT' && /prototype|경로|data path/i.test(error.message),
  );
  assert.equal(fs.existsSync(path.join(root, 'Extract', 'manifest.json')), false);
});

test('manifest recovery rejects a data path missing from its Backup JSON', () => {
  const root = recoveryPack(['Alice']);
  const mapping = extractedMain(['Alice']);
  mapping['Actors.json'].data['0'].val = '99.name';

  assert.throws(
    () => recoverRpgManifest(root, mapping),
    (error) => error.code === 'E_MAPPING_CORRUPT' && /Backup|data path|대상|경로/i.test(error.message),
  );
  assert.equal(fs.existsSync(path.join(root, 'Extract', 'manifest.json')), false);
});

test('manifest recovery rejects a non-string Backup target', () => {
  const root = recoveryPack(['Alice']);
  const actorsPath = path.join(root, 'Backup', 'Actors.json');
  const actors = JSON.parse(fs.readFileSync(actorsPath, 'utf8'));
  actors[1].name = { nested: 'not text' };
  fs.writeFileSync(actorsPath, JSON.stringify(actors));

  assert.throws(
    () => recoverRpgManifest(root, extractedMain(['Alice'])),
    (error) => error.code === 'E_MAPPING_CORRUPT' && /문자열|string|대상/i.test(error.message),
  );
  assert.equal(fs.existsSync(path.join(root, 'Extract', 'manifest.json')), false);
});

test('manifest recovery handles a deterministic large mapping without dropping entries', () => {
  const lines = Array.from({ length: 2000 }, (_, index) => `Actor ${index + 1}`);
  const root = recoveryPack(lines);
  const outcome = recoverRpgManifest(root, extractedMain(lines));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'Extract', 'manifest.json'), 'utf8'));

  assert.equal(outcome.entries, 2000);
  assert.equal(outcome.files, 1);
  assert.equal(manifest.entries.length, 2000);
  assert.equal(new Set(manifest.entries.map((entry) => entry.id)).size, 2000);
});

test('manifest recovery preserves the install error when backup cleanup also fails', () => {
  const root = recoveryPack(['Alice']);
  const manifestPath = path.join(root, 'Extract', 'manifest.json');
  const backupPath = path.join(root, 'Extract', 'manifest.pre-recovery.json');
  const oldManifest = JSON.stringify({ schemaVersion: 1, format: 'rpgmv', entries: [] });
  fs.writeFileSync(manifestPath, oldManifest, 'utf8');
  const originalRename = fs.renameSync;
  const originalRemove = fs.rmSync;
  fs.renameSync = (source, destination) => {
    if (path.resolve(destination) === path.resolve(manifestPath)
      && path.basename(String(source)).includes('.manifest.json.tmp-')) {
      throw new Error('simulated recovered manifest install failure');
    }
    return originalRename(source, destination);
  };
  fs.rmSync = (candidate, options) => {
    if (path.resolve(candidate) === path.resolve(backupPath)) {
      throw new Error('simulated recovery backup cleanup failure');
    }
    return originalRemove(candidate, options);
  };
  try {
    assert.throws(
      () => recoverRpgManifest(root, extractedMain(['Alice'])),
      /recovered manifest install failure/,
    );
  } finally {
    fs.renameSync = originalRename;
    fs.rmSync = originalRemove;
  }
  try {
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), oldManifest);
    assert.equal(fs.readFileSync(backupPath, 'utf8'), oldManifest);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
