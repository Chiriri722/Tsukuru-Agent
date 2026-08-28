const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..', '..');
const stageRoot = path.join(appRoot, '.build', 'app');
const { isFormatCompatible } = require(path.join(stageRoot, 'src', 'cli', 'compatibilityPolicy.js'));
const {
  engineRegistry,
  selectEngineAdapter,
} = require(path.join(stageRoot, 'src', 'cli', 'engineRegistry.js'));

function detected(format, containerType = 'directory') {
  return {
    format,
    dataDir: 'fixture/data',
    container: { type: containerType },
  };
}

test('format compatibility policy preserves exact, legacy alias, and wrapper rules', () => {
  for (const format of ['rpgmv', 'rpgmz', 'wolf', 'gdevelop', 'tyrano', 'nwjs']) {
    assert.equal(isFormatCompatible('auto', detected(format)), true);
  }
  assert.equal(isFormatCompatible('rpgmv', detected('rpgmv')), true);
  assert.equal(isFormatCompatible('rpgmv', detected('rpgmz')), true, 'legacy RPG service accepts MZ');
  assert.equal(isFormatCompatible('rpgmz', detected('rpgmv')), false);
  assert.equal(isFormatCompatible('rpgmz-electron', detected('rpgmz')), true);
  assert.equal(isFormatCompatible('gdevelop-electron', detected('gdevelop')), true);
  assert.equal(isFormatCompatible('nwjs-webgame', detected('gdevelop', 'nwjs-package')), true);
  assert.equal(isFormatCompatible('nwjs-webgame', detected('gdevelop', 'directory')), false);
  assert.equal(isFormatCompatible('wolf', detected('tyrano')), false);
});

test('engine registry selects immutable adapters and exposes operation capabilities', () => {
  assert.deepEqual(Object.keys(engineRegistry), [
    'rpgmv', 'rpgmz', 'wolf', 'tyrano', 'gdevelop', 'nwjs', 'unknown',
  ]);
  assert.equal(selectEngineAdapter(detected('rpgmz')), engineRegistry.rpgmz);
  assert.equal(engineRegistry.rpgmz.family, 'rpgmaker');
  assert.equal(engineRegistry.rpgmz.patchFormat, 'rpgmv');
  assert.equal(engineRegistry.gdevelop.extractLayout, 'gdevelop-root');
  assert.equal(engineRegistry.wolf.operations.includes('recover'), false);
  assert.equal(engineRegistry.rpgmv.operations.includes('recover'), true);
  assert.equal(Object.isFrozen(engineRegistry), true);
  assert.equal(Object.isFrozen(engineRegistry.rpgmv), true);
  assert.throws(() => selectEngineAdapter(detected('unknown')), /지원되는 엔진 프로파일/);
});
