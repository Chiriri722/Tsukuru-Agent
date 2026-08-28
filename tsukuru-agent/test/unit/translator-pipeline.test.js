const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { translatorTestHooks } = require('../../.build/app/src/js/rpgmv/translator.js');

function installGlobals() {
  global.settings = {
    safeTrans: true,
    smartTrans: true,
    fastEztrans: true,
    DoNotTransHangul: false,
    userdict: {},
  };
  global.mwindow = { webContents: { send() {} } };
}

test('translation mode normalization preserves legacy provider aliases', () => {
  installGlobals();
  const kakao = { type: 'kakao', langu: 'en', usePreProcess: false };
  assert.deepEqual(translatorTestHooks.configureTranslationMode(kakao), {
    compatibilityMode: false,
    type2: 'kakao',
    langu: 'en',
    usePreProcess: true,
  });
  assert.equal(kakao.type, 'transEngine');
  assert.equal(global.settings.smartTrans, false);

  installGlobals();
  const eztrans = { type: 'eztransh', langu: 'jp' };
  assert.deepEqual(translatorTestHooks.configureTranslationMode(eztrans), {
    compatibilityMode: true,
    type2: '',
    langu: 'jp',
    usePreProcess: false,
  });
  assert.equal(eztrans.type, 'eztrans');
});

test('translation file classification keeps RPG and Wolf safety boundaries', () => {
  installGlobals();
  const base = { arg: { game: 'rpg' }, compatibilityMode: false, edDat: {}, note2Codes: {} };
  assert.equal(translatorTestHooks.classifyTranslationFile('Actors.txt', base), '');
  assert.equal(translatorTestHooks.classifyTranslationFile('ext_scripts.txt', base), 'src');
  assert.equal(translatorTestHooks.classifyTranslationFile('random.txt', base), null);

  const compatibility = { ...base, compatibilityMode: true };
  assert.equal(translatorTestHooks.classifyTranslationFile('System.txt', compatibility), null);

  const wolf = { ...base, arg: { game: 'wolf' } };
  assert.equal(translatorTestHooks.classifyTranslationFile('map.txt', wolf), '');
  assert.equal(translatorTestHooks.classifyTranslationFile('commonEvent.txt', wolf), '');
  assert.equal(translatorTestHooks.classifyTranslationFile('database.txt', wolf), null);
});

test('source-line and memory-backed translation stages preserve line layout', async () => {
  installGlobals();
  const fakeTranslator = {
    translate: async (text) => `KO:${text}`,
    isCrash: async () => false,
  };
  assert.equal(
    await translatorTestHooks.translateSourceLine('D_TEXT Hello 1', fakeTranslator),
    'D_TEXT KO:Hello 1\n',
  );

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-translator-test-'));
  try {
    const file = path.join(tempRoot, 'Actors.txt');
    fs.writeFileSync(file, 'こんにちは\n世界', 'utf8');
    const classifier = {
      arg: { game: 'rpg' },
      compatibilityMode: false,
      edDat: {},
      note2Codes: {},
    };
    const shouldNotTranslate = {
      translate: async () => { throw new Error('memory path should not call provider'); },
      isCrash: async () => false,
    };
    const aborted = await translatorTestHooks.translateFiles(
      ['Actors.txt'],
      tempRoot,
      shouldNotTranslate,
      classifier,
      false,
      1000,
      { 'こんにちは': '안녕하세요', '世界': '세계' },
      fs.readFileSync(file, 'utf8').length,
    );
    assert.equal(aborted, false);
    assert.equal(fs.readFileSync(file, 'utf8'), '안녕하세요\n세계');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
