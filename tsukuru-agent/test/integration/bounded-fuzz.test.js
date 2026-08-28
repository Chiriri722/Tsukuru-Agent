const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { applyPatches } = require('../../.build/app/src/cli/patcher.js');
const { sha256Text } = require('../../.build/app/src/core/manifest.js');
const { inspectWolfBinaryMappings } = require('../../.build/app/src/core/validator.js');

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = ((state * 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test('bounded fuzz keeps line mappings and hashes coherent after variable-length patches', () => {
  const random = seededRandom(0x5453554b);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-line-fuzz-'));
  for (let iteration = 0; iteration < 32; iteration++) {
    const extract = path.join(root, String(iteration));
    fs.mkdirSync(extract);
    const originals = Array.from({ length: 12 }, (_, index) => `line-${iteration}-${index}`);
    const entries = originals.map((text, index) => ({
      id: `scenario.ks#${index}`,
      sourceFile: 'data/scenario.ks',
      dataPath: String(index),
      extractFile: 'scenario.txt',
      lineStart: index,
      lineEnd: index + 1,
      hash: sha256Text(text),
      encoding: 'utf8',
      nullTerminated: false,
    }));
    fs.writeFileSync(path.join(extract, 'scenario.txt'), `${originals.join('\n')}\n`);
    fs.writeFileSync(path.join(extract, 'manifest.json'), JSON.stringify({ schemaVersion: 1, format: 'tyrano', entries }));

    const patches = entries
      .filter(() => random() < 0.55)
      .map((entry) => ({
        id: entry.id,
        expectedHash: entry.hash,
        text: Array.from({ length: 1 + Math.floor(random() * 4) }, (_, index) => `${entry.id}-translated-${index}`).join('\n'),
      }));
    if (patches.length === 0) patches.push({ id: entries[0].id, expectedHash: entries[0].hash, text: 'fallback' });

    applyPatches(extract, 'tyrano', patches);

    const manifest = JSON.parse(fs.readFileSync(path.join(extract, 'manifest.json'), 'utf8'));
    const lines = fs.readFileSync(path.join(extract, 'scenario.txt'), 'utf8').split('\n');
    let previousEnd = 0;
    for (const entry of manifest.entries) {
      assert.equal(entry.lineStart, previousEnd);
      assert.ok(entry.lineEnd > entry.lineStart);
      const current = lines.slice(entry.lineStart, entry.lineEnd).join('\n');
      assert.equal(entry.hash, sha256Text(current));
      previousEnd = entry.lineEnd;
    }
  }
});

test('bounded fuzz accepts valid Wolf offsets and rejects one-byte interval escapes', () => {
  const random = seededRandom(0x574f4c46);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-wolf-offset-fuzz-'));
  for (let iteration = 0; iteration < 64; iteration++) {
    const textValue = `message-${iteration}-${'x'.repeat(1 + Math.floor(random() * 40))}`;
    const text = Buffer.from(`${textValue}\0`, 'utf8');
    const pos1 = Math.floor(random() * 16);
    const pos2 = pos1 + 4;
    const pos3 = pos2 + text.length;
    const bytes = Buffer.alloc(pos3 + Math.floor(random() * 8));
    bytes.writeUInt32LE(text.length, pos1);
    text.copy(bytes, pos2);
    const file = `Map${String(iteration).padStart(3, '0')}.mps`;
    fs.writeFileSync(path.join(root, file), bytes);
    const manifest = { format: 'wolf', entries: [{
      id: `${file}#0`,
      sourceFile: file,
      encoding: 'utf8',
      nullTerminated: true,
      hash: crypto.createHash('sha256').update(textValue).digest('hex'),
      wolf: { pos1, pos2, pos3, len: text.length },
    }] };

    const valid = inspectWolfBinaryMappings(root, manifest);
    assert.equal(valid.ok, true, JSON.stringify(valid.issues));

    const escaped = structuredClone(manifest);
    escaped.entries[0].wolf.pos3 = bytes.length + 1;
    const invalid = inspectWolfBinaryMappings(root, escaped);
    assert.equal(invalid.ok, false);
    assert.ok(invalid.issues.some((issue) => issue.code === 'WOLF_OFFSET_INVALID'));
  }
});
