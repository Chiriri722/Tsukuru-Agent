const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..', '..');
const stageRoot = path.join(appRoot, '.build', 'app');
const { emptyResult } = require(path.join(stageRoot, 'src', 'core', 'schema.js'));
const { handleApply } = require(path.join(stageRoot, 'src', 'cli', 'operations', 'apply.js'));
const { handleExtract } = require(path.join(stageRoot, 'src', 'cli', 'operations', 'extract.js'));
const { handlePatch } = require(path.join(stageRoot, 'src', 'cli', 'operations', 'patch.js'));
const { handleRecover } = require(path.join(stageRoot, 'src', 'cli', 'operations', 'recover.js'));
const { handleVerify } = require(path.join(stageRoot, 'src', 'cli', 'operations', 'verify.js'));

function request(operation) {
  return {
    schemaVersion: 2,
    operation,
    format: 'auto',
    projectPath: 'fixture',
    profile: 'standard',
    options: {},
    patches: [],
  };
}

test('all five operation handlers reject unsupported engines without runtime globals', async () => {
  const unsupported = { format: 'nwjs', dataDir: 'fixture' };
  await assert.rejects(handleApply(request('apply'), unsupported, emptyResult()),
    (error) => error.code === 'E_NOT_IMPLEMENTED');
  await assert.rejects(handleExtract(request('extract'), unsupported, emptyResult()),
    (error) => error.code === 'E_NOT_IMPLEMENTED');
  await assert.rejects(handlePatch(request('patch'), unsupported, emptyResult()),
    (error) => error.code === 'E_NOT_IMPLEMENTED');
  await assert.rejects(handleRecover(request('recover'), unsupported, emptyResult()),
    (error) => error.code === 'E_NOT_IMPLEMENTED');

  await assert.rejects(handleVerify(request('verify'), { format: 'unknown', dataDir: 'fixture' }, emptyResult()),
    (error) => error.code === 'E_FORMAT_UNKNOWN');

  const operationFiles = ['apply.ts', 'extract.ts', 'patch.ts', 'recover.ts', 'verify.ts'];
  const verifyFiles = fs.readdirSync(path.join(appRoot, 'src', 'cli', 'operations', 'verify'))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => path.join('verify', file));
  for (const file of [...operationFiles, ...verifyFiles]) {
    const source = fs.readFileSync(path.join(appRoot, 'src', 'cli', 'operations', file), 'utf8');
    assert.doesNotMatch(source, /\bprocess\.|\bconsole\.|from\s+['"]electron|require\(['"]electron/);
  }
});

test('engine path policy keeps RPG, Wolf, Tyrano, and GDevelop workspaces distinct', () => {
  const { extractionWorkspacePath } = require(path.join(stageRoot, 'src', 'cli', 'enginePaths.js'));
  assert.match(extractionWorkspacePath({ format: 'rpgmz', dataDir: 'root/data' }), /data[\\/]Extract$/);
  assert.match(extractionWorkspacePath({ format: 'wolf', dataDir: 'root/Data' }), /Data[\\/]_Extract$/);
});

test('engine operation registries replace family condition chains in public handlers', () => {
  const { looseExtractHandlerRegistry } = require(path.join(stageRoot, 'src', 'cli', 'operations', 'extract.js'));
  const { looseApplyHandlerRegistry } = require(path.join(stageRoot, 'src', 'cli', 'operations', 'apply.js'));
  const { engineVerifyHandlerRegistry } = require(path.join(stageRoot, 'src', 'cli', 'operations', 'verify.js'));
  for (const [registry, families] of [
    [looseExtractHandlerRegistry, ['rpgmaker', 'wolf', 'tyrano', 'gdevelop']],
    [looseApplyHandlerRegistry, ['rpgmaker', 'wolf', 'tyrano', 'gdevelop']],
    [engineVerifyHandlerRegistry, ['rpgmaker', 'wolf', 'tyrano', 'gdevelop', 'nwjs']],
  ]) {
    assert.equal(Object.isFrozen(registry), true);
    assert.deepEqual(Object.keys(registry), families);
    for (const handler of Object.values(registry)) assert.equal(typeof handler, 'function');
  }

  for (const [file, handlerName] of [
    ['extract.ts', 'handleExtract'],
    ['apply.ts', 'handleApply'],
    ['verify.ts', 'handleVerify'],
  ]) {
    const source = fs.readFileSync(path.join(appRoot, 'src', 'cli', 'operations', file), 'utf8');
    const handlerSource = source.slice(source.indexOf(`export async function ${handlerName}`));
    assert.doesNotMatch(handlerSource, /engine\.family\s*===/);
  }
});
