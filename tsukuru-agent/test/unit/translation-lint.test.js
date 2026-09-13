const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectTranslations } = require('../../.build/app/src/core/translationLint.js');

test('bounded translation diagnostics retain a blocking error even after many language warnings', () => {
  const candidates = Array.from({ length: 110 }, (_, index) => ({
    file: 'Actors.json', entryId: `Actors.json#${index}.name`, source: 'Original', text: '日本語',
  }));
  candidates.push({ file: 'Actors.json', entryId: 'Actors.json#999.name', source: '\\FF[1]Original', text: '\\F[1]번역' });
  const result = inspectTranslations(candidates);
  assert.equal(result.mechanical, 'fail');
  assert.equal(result.issues.length, 100);
  assert.equal(result.issueCount, 111);
  assert.equal(result.omittedCount, 11);
  assert.ok(result.issues.some(issue => issue.severity === 'error' && issue.entryId === 'Actors.json#999.name'));
});

test('control arguments, escape parity and positional placeholders are preserved while named placeholders can move', () => {
  const lint = (source, text) => inspectTranslations([{ file: 'Map001.json', entryId: 'Map001.json#message', source, text }]).mechanical;
  assert.equal(lint('\\PLUGIN[a[1],b]Original %s %d', '\\PLUGIN[a[1],b]번역 %s %d'), 'pass');
  assert.equal(lint('\\PLUGIN[a[1],b]Original', '\\PLUGIN[a[2],b]번역'), 'fail');
  assert.equal(lint('\\\\\\FF[1]Original', '\\\\FF[1]번역'), 'fail');
  assert.equal(lint('Hello %s %d', '번역 %d %s'), 'fail');
  assert.equal(lint('%1 says {name}', '{name} 번역 %1'), 'pass');
});

test('RPG context never joins pages, events or unmatched 401 commands and leaves semantic swaps unverified', () => {
  const { inspectRpgMessageQuality } = require('../../.build/app/src/js/rpgmv/messageQuality.js');
  const header = { code: 101, indent: 0, parameters: [] };
  const line = (text, indent = 0) => ({ code: 401, indent, parameters: [text] });
  const page = list => ({ list });
  const cases = [
    { events: [null, { pages: [page([header, line('「first')]), page([header, line('second」')])] }] },
    { events: [null, { pages: [page([header, line('「first')])] }, { pages: [page([header, line('second」')])] }] },
    { events: [null, { pages: [page([header, line('valid'), line('orphan', 1)])] }] },
    { events: [null, { pages: [page([line('orphan')])] }] },
  ];
  for (const data of cases) {
    const quality = inspectTranslations([]);
    inspectRpgMessageQuality({ backups: new Map([['Map001.json', data]]) }, [], quality);
    assert.equal(quality.context, 'needs-review');
    assert.ok(quality.issues.some(issue => /^RPG_MESSAGE_/.test(issue.code)));
  }
  const swapped = inspectTranslations([
    { file: 'Map001.json', entryId: 'yes', source: 'Yes', text: '아니요' },
    { file: 'Map001.json', entryId: 'no', source: 'No', text: '예' },
    { file: 'Actors.json', entryId: 'Actors.json#1.name', source: '名前', text: '名前' },
  ]);
  assert.equal(swapped.mechanical, 'pass');
  assert.equal(swapped.semantics, 'not-run');
  assert.equal(swapped.language, 'needs-review');
  assert.ok(swapped.issues.some(issue => issue.reason?.includes('source-preserved')));
});

test('external-message CSV source and readback use the runtime parser field semantics', async () => {
  const { parseString } = require('fast-csv');
  const { parseRpgMessageCsv } = require('../../.build/app/src/js/rpgmv/translation.js');
  for (const text of ['key, "text"\n', '\t"key",\t"text"  \r\n', 'key, unquoted text \n',
    'key,"quote ""inside"""\n', 'key,"line1\r\nline2"\n', '\nkey,value\n', 'key,a"b\n', ' \t\n', ' \t', '']) {
    const expected = Object.create(null);
    await new Promise((resolve, reject) => parseString(text).on('data', row => { expected[row[0] ?? ''] = row[1] ?? ''; }).on('error', reject).on('end', resolve));
    assert.deepEqual(parseRpgMessageCsv(text), expected, JSON.stringify(text));
  }
});
