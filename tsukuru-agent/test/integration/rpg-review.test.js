const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { RpgMakerService } = require('../../.build/app/src/js/rpgmv/RpgMakerService.js');
const { createOperationContext, createRpgState } = require('../../.build/app/src/core/context.js');
const { CapturingProgressSink, CapturingLogger } = require('../../.build/app/src/core/sinks.js');
const { settings } = require('../../.build/app/src/js/rpgmv/datas.js');
const { executeAgentRequest } = require('../../.build/app/src/cli/run.js');
const { validateRequest, validateResolvedRequest } = require('../../.build/app/src/core/schema.js');
const { validateContract } = require('../../.build/app/src/core/contracts/schemaRegistry.js');
const { applyPatches } = require('../../.build/app/src/cli/patcher.js');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const id = (page, index) => `Map001.json#events.1.pages.${page}.list.${index}.parameters.0`;

function snapshot(root) {
  return Object.fromEntries(fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(e => e.isFile()).map(e => {
      const file = path.join(e.parentPath ?? e.path, e.name);
      return [path.relative(root, file), hash(fs.readFileSync(file))];
    }));
}

async function fixture(t, prepare) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-review-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const game = path.join(root, 'game');
  fs.cpSync(path.resolve(__dirname, '../../../fixtures/rpgmv-basic'), game, { recursive: true });
  const data = path.join(game, 'www/data');
  const mapFile = path.join(data, 'Map001.json');
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  const header = name => ({ code: 101, indent: 0, parameters: ['Face', 0, 0, 2, name] });
  const line = (text, indent = 0) => ({ code: 401, indent, parameters: [text] });
  const end = { code: 0, indent: 0, parameters: [] };
  map.events = [null, { id: 1, name: 'Event', pages: [
    { list: [header('Guide'), line('North Castle and Castle'), line('PRIVATE_ORIGINAL'), end] },
    { list: [header('\\N[1]'), line('Different page'), line('Orphan', 1), end] },
  ] }];
  if (prepare) prepare(map, data);
  fs.writeFileSync(mapFile, JSON.stringify(map));
  const service = new RpgMakerService(createOperationContext(new CapturingProgressSink(), new CapturingLogger(), {
    rpg: createRpgState({ ...settings }),
  }));
  await service.extract({ dir: data, ext_note: true });
  const extract = path.join(data, 'Extract');
  const manifest = JSON.parse(fs.readFileSync(path.join(extract, 'manifest.json'), 'utf8'));
  const request = review => ({ schemaVersion: 2, operation: 'verify', format: 'auto', projectPath: data,
    options: { review: { reportPath: path.join(root, 'review.json'), ...review } } });
  return { root, game, data, extract, manifest, request };
}

test('review preserves original context and IDs, publishes privately, and remains compatible with patch', async t => {
  const f = await fixture(t);
  const selected = f.manifest.entries.find(e => e.id === id(0, 2));
  applyPatches(f.extract, 'rpgmv', [{ id: selected.id, expectedHash: selected.hash, text: 'PRIVATE_TRANSLATED' }]);
  const before = snapshot(f.game);
  const request = f.request({ entryIds: [id(1, 2), id(0, 2), id(0, 1), id(1, 1)] });
  request.options.diagnosticReportPath = path.join(f.root, 'diagnostic.json');
  request.options.review.preview = { sourceLanguage: 'ja', targetLanguage: 'ko', glossary: {
    version: 'private-version', entries: [{ term: 'PRIVATE_TERM', translation: 'PRIVATE_GLOSSARY', priority: 'user' }],
  } };
  const result = await executeAgentRequest(request);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(snapshot(f.game), before);
  const report = JSON.parse(fs.readFileSync(request.options.review.reportPath, 'utf8'));
  assert.equal(validateContract('review', 1, report).ok, true);
  assert.equal(validateContract('review', 1, { ...report, schemaVersion: 2 }).ok, false);
  assert.equal(validateContract('review', 1, { ...report, unapprovedExtra: true }).ok, false);
  assert.equal(validateContract('review', 1, { ...report, workspaceHash: 'invalid' }).ok, false);
  assert.equal(validateContract('review', 99, report).ok, false);
  const row = report.entries.find(e => e.id === selected.id);
  assert.equal(row.source, 'PRIVATE_ORIGINAL');
  assert.equal(row.text, 'PRIVATE_TRANSLATED');
  assert.equal(row.currentHash, hash(row.text));
  assert.equal(row.sourceHash, hash(row.source));
  assert.equal(row.state, 'changed');
  assert.deepEqual(report.entries.map(e => e.id), [id(0, 1), id(0, 2), id(1, 1), id(1, 2)]);
  const group = report.groups.find(g => g.id === row.groupId);
  assert.deepEqual(group.lines.map(l => l.source), ['North Castle and Castle', 'PRIVATE_ORIGINAL']);
  assert.deepEqual(group.speaker, { status: 'explicit', name: 'Guide', basis: '101.parameters.4' });
  assert.equal(report.groups.find(g => g.id === report.entries[2].groupId).speaker.status, 'unknown');
  assert.equal(report.entries[3].contextStatus, 'unavailable');
  assert.equal(report.preview.mode, 'offline');
  assert.equal(report.preview.approved, false);
  const diagnostic = fs.readFileSync(request.options.diagnosticReportPath, 'utf8');
  for (const text of ['PRIVATE_ORIGINAL', 'PRIVATE_TRANSLATED', 'PRIVATE_GLOSSARY', 'PRIVATE_TERM', 'private-version']) {
    assert.equal(JSON.stringify(result).includes(text), false);
    assert.equal(diagnostic.includes(text), false);
  }
});

test('glossary selection handles precedence, independent short occurrences, bounds and revision changes', async t => {
  const f = await fixture(t);
  const glossary = { version: '1', entries: [
    { term: 'Castle', translation: 'derived', priority: 'derived' },
    { term: 'Castle', translation: 'manual', priority: 'manual' },
    { term: 'Castle', translation: 'user', priority: 'user' },
    { term: 'North Castle', translation: 'north', priority: 'manual' },
    { term: 'PRIVATE_ORIGINAL', translation: 'context', priority: 'manual' },
    { term: 'Absent', translation: 'unused', priority: 'user' },
  ] };
  const run = async (name, changes = {}) => {
    const request = f.request({ entryIds: [id(0, 1)], reportPath: path.join(f.root, name),
      preview: { sourceLanguage: 'ja', targetLanguage: 'ko', glossary, ...changes } });
    const result = await executeAgentRequest(request);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    return JSON.parse(fs.readFileSync(request.options.review.reportPath, 'utf8'));
  };
  const a = await run('a.json');
  assert.deepEqual(a.preview.terms.map(e => e.term).sort(), ['Castle', 'North Castle', 'PRIVATE_ORIGINAL']);
  assert.equal(a.preview.terms.find(e => e.term === 'Castle').translation, 'user');
  const b = await run('b.json');
  assert.equal(a.preview.requestHash, b.preview.requestHash);
  const capped = await run('cap.json', { maxTerms: 1 });
  assert.equal(capped.preview.terms.length, 1);
  assert.equal(capped.preview.omittedTerms, 2);
  assert.notEqual(a.preview.requestHash, capped.preview.requestHash);
  glossary.version = '2';
  assert.notEqual(a.preview.glossaryHash, (await run('version.json')).preview.glossaryHash);
  glossary.entries.push({ term: 'Castle', translation: 'conflict', priority: 'user' });
  const result = await executeAgentRequest(f.request({ preview: { sourceLanguage: 'ja', targetLanguage: 'ko', glossary } }));
  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(path.join(f.root, 'review.json')), false);
});

test('review rejects stale hashes, unknown/duplicate IDs and damaged Backup without writing', async t => {
  const f = await fixture(t);
  for (const entryIds of [['missing'], [id(0, 1), id(0, 1)]]) {
    const before = snapshot(f.root);
    const result = await executeAgentRequest(f.request({ entryIds }));
    assert.equal(result.ok, false);
    assert.deepEqual(snapshot(f.root), before);
  }
  const file = path.join(f.extract, f.manifest.entries.find(e => e.id === id(0, 1)).extractFile);
  const original = fs.readFileSync(file);
  fs.appendFileSync(file, '\n');
  // Change a mapped line, not just an unmapped final newline.
  fs.writeFileSync(file, original.toString().replace('North Castle', 'Wrong Castle'));
  let before = snapshot(f.root);
  assert.equal((await executeAgentRequest(f.request({}))).ok, false);
  assert.deepEqual(snapshot(f.root), before);
  fs.writeFileSync(file, original);
  fs.writeFileSync(path.join(f.data, 'Backup/Map001.json'), '{broken');
  before = snapshot(f.root);
  assert.equal((await executeAgentRequest(f.request({}))).ok, false);
  assert.deepEqual(snapshot(f.root), before);
});

test('review guards targets, existing outputs, publication faults and cancellation', async t => {
  const f = await fixture(t);
  for (const reportPath of [path.join(f.data, 'report.json'), path.join(f.data, '..review.json'), path.join(f.extract, 'manifest.json')]) {
    const before = snapshot(f.root);
    assert.equal((await executeAgentRequest(f.request({ reportPath }))).ok, false);
    assert.deepEqual(snapshot(f.root), before);
  }
  const target = path.join(f.root, 'review.json');
  fs.writeFileSync(target, 'previous');
  assert.equal((await executeAgentRequest(f.request({}))).error.code, 'E_OUTPUT_CONFLICT');
  assert.equal(fs.readFileSync(target, 'utf8'), 'previous');
  fs.unlinkSync(target);
  const linked = path.join(f.root, 'linked');
  fs.symlinkSync(f.data, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await executeAgentRequest(f.request({ reportPath: path.join(linked, 'bad.json') }))).ok, false);
  assert.equal(fs.existsSync(path.join(f.data, 'bad.json')), false);
  fs.unlinkSync(linked);
  const before = snapshot(f.root);
  const link = fs.linkSync;
  let injected = false;
  fs.linkSync = (source, destination) => {
    if (path.resolve(destination) === target) { injected = true; throw new Error('injected publication fault'); }
    return link(source, destination);
  };
  try { assert.equal((await executeAgentRequest(f.request({}))).ok, false); }
  finally { fs.linkSync = link; }
  assert.equal(injected, true);
  assert.deepEqual(snapshot(f.root), before);
  const controller = new AbortController();
  fs.linkSync = (source, destination) => {
    const result = link(source, destination);
    if (path.resolve(destination) === target) controller.abort();
    return result;
  };
  try {
    const result = await executeAgentRequest(f.request({}), { signal: controller.signal });
    assert.match(result.error.code, /CANCELLED/);
  } finally { fs.linkSync = link; }
  assert.deepEqual(snapshot(f.root), before);
  const collision = f.request({});
  collision.options.diagnosticReportPath = target;
  assert.equal((await executeAgentRequest(collision)).ok, false);
  assert.deepEqual(snapshot(f.root), before);
  const timed = f.request({});
  timed.options.operationTimeoutMs = 1;
  const timedResult = await executeAgentRequest(timed);
  assert.equal(timedResult.error?.code, 'E_OPERATION_TIMEOUT');
  assert.deepEqual(snapshot(f.root), before);
});

test('portable review paginates, bounds context, reports unsupported comments, and performs no network calls', async t => {
  const f = await fixture(t, map => {
    const list = map.events[1].pages[0].list;
    list.splice(2, 0, ...Array.from({ length: 55 }, (_, index) => ({ code: 401, indent: 0, parameters: [`Extra ${index}`] })));
  });
  // Review only needs the extracted workspace, not the original runtime or database beside it.
  for (const entry of fs.readdirSync(f.data, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json')) fs.unlinkSync(path.join(f.data, entry.name));
  }
  const before = snapshot(f.game);
  const request = f.request({ entryIds: [id(0, 1)], preview: { sourceLanguage: 'ja', targetLanguage: 'ko', glossary: {
    version: '1', entries: [{ term: 'North Castle', translation: 'long', priority: 'user' },
      { term: 'North', translation: 'short', priority: 'user' }],
  } } });
  const http = require('node:http');
  const https = require('node:https');
  const originals = [http.request, https.request, global.fetch];
  const fail = () => assert.fail('offline review contacted network');
  http.request = https.request = global.fetch = fail;
  try { assert.equal((await executeAgentRequest(request)).ok, true); }
  finally { [http.request, https.request, global.fetch] = originals; }
  const report = JSON.parse(fs.readFileSync(request.options.review.reportPath, 'utf8'));
  assert.equal(report.groups[0].lines.length, 50);
  assert.equal(report.groups[0].omittedLines, 7);
  assert.deepEqual(report.preview.terms.map(term => term.term), ['North Castle']);
  assert.deepEqual(snapshot(f.game), before);
  const page = f.request({ offset: 1, limit: 2, reportPath: path.join(f.root, 'page.json') });
  assert.equal((await executeAgentRequest(page)).ok, true);
  const paged = JSON.parse(fs.readFileSync(page.options.review.reportPath, 'utf8'));
  assert.deepEqual(paged.entries.map(e => e.id), f.manifest.entries.slice(1, 3).map(e => e.id));
  assert.equal(paged.omittedEntries, f.manifest.entries.length - 2);
  const all = f.request({ limit: 500, reportPath: path.join(f.root, 'all.json') });
  assert.equal((await executeAgentRequest(all)).ok, true);
  const full = JSON.parse(fs.readFileSync(all.options.review.reportPath, 'utf8'));
  assert.ok(full.entries.some(e => e.category === 'database'));
  assert.ok(full.entries.some(e => e.category === 'system'));
  for (const row of full.entries.filter(e => !e.supported)) {
    assert.equal(row.state, 'unsupported');
    assert.equal(row.source, null);
  }
});

test('mechanical failure remains failed while review exposes source, and fingerprints track Backup context', async t => {
  const f = await fixture(t);
  const first = f.request({ entryIds: [id(0, 1)] });
  assert.equal((await executeAgentRequest(first)).ok, true);
  const a = JSON.parse(fs.readFileSync(first.options.review.reportPath, 'utf8'));
  const backupPath = path.join(f.data, 'Backup/Map001.json');
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  backup.events[1].pages[0].list[0].parameters[4] = 'Different speaker';
  fs.writeFileSync(backupPath, JSON.stringify(backup));
  const second = f.request({ entryIds: [id(0, 1)], reportPath: path.join(f.root, 'second.json') });
  assert.equal((await executeAgentRequest(second)).ok, true);
  const b = JSON.parse(fs.readFileSync(second.options.review.reportPath, 'utf8'));
  assert.notEqual(a.workspaceHash, b.workspaceHash);
  assert.notEqual(a.groups[0].contextHash, b.groups[0].contextHash);
  const selected = f.manifest.entries.find(e => e.id === id(0, 1));
  const textFile = path.join(f.extract, selected.extractFile);
  const lines = fs.readFileSync(textFile, 'utf8').split('\n');
  lines[selected.lineStart] = '\\FF[999]Damaged';
  fs.writeFileSync(textFile, lines.join('\n'));
  selected.hash = hash(lines.slice(selected.lineStart, selected.lineEnd).join('\n'));
  fs.writeFileSync(path.join(f.extract, 'manifest.json'), JSON.stringify(f.manifest));
  const request = f.request({ entryIds: [selected.id], reportPath: path.join(f.root, 'damaged.json') });
  const before = snapshot(f.game);
  const result = await executeAgentRequest(request);
  assert.equal(result.ok, false);
  assert.equal(result.translationQuality.mechanical, 'fail');
  assert.ok(result.artifacts.includes(request.options.review.reportPath));
  assert.equal(JSON.parse(fs.readFileSync(request.options.review.reportPath, 'utf8')).entries[0].source, 'North Castle and Castle');
  assert.deepEqual(snapshot(f.game), before);
});

test('review request contract is bounded and v2 RPG-only; legacy options never activate it', async t => {
  const f = await fixture(t);
  assert.doesNotThrow(() => validateRequest(f.request({})));
  for (const review of [{ limit: 0 }, { limit: 501 }, { entryIds: [] }, { offset: -1 },
    { entryIds: [id(0, 1)], limit: 1 }, { preview: { sourceLanguage: 'ja' } },
    { preview: { sourceLanguage: 'ja', targetLanguage: 'ko', apiKey: 'secret' } }]) {
    assert.throws(() => validateRequest(f.request(review)), /스키마/);
  }
  assert.throws(() => validateRequest({ ...f.request({}), operation: 'apply' }));
  assert.throws(() => validateResolvedRequest(validateRequest(f.request({})), 'wolf'));
  const legacy = { ...f.request({}), schemaVersion: 1 };
  const before = snapshot(f.root);
  assert.equal((await executeAgentRequest(legacy)).ok, true);
  assert.deepEqual(snapshot(f.root), before);
});
