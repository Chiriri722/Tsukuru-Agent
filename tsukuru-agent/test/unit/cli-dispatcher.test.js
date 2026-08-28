const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..', '..');
const stageRoot = path.join(appRoot, '.build', 'app');
const { dispatchOperation } = require(path.join(stageRoot, 'src', 'cli', 'dispatcher.js'));
const { emptyResult } = require(path.join(stageRoot, 'src', 'core', 'schema.js'));

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

test('operation dispatcher routes every operation to exactly one injected handler', async () => {
  const calls = [];
  const runtime = { operationId: 'runtime-1' };
  const handlers = Object.fromEntries(
    ['verify', 'extract', 'patch', 'apply', 'recover'].map((operation) => [
      operation,
      async (actualRequest, detected, result, actualRuntime) => {
        calls.push([operation, actualRequest.operation, detected.format, actualRuntime.operationId]);
        result.stats.handledBy = operation;
      },
    ]),
  );
  const detected = { format: 'rpgmz', dataDir: 'fixture/data' };

  for (const operation of ['verify', 'extract', 'patch', 'apply', 'recover']) {
    const result = emptyResult();
    await dispatchOperation(request(operation), detected, result, handlers, runtime);
    assert.equal(result.stats.handledBy, operation);
  }

  assert.deepEqual(calls, [
    ['verify', 'verify', 'rpgmz', 'runtime-1'],
    ['extract', 'extract', 'rpgmz', 'runtime-1'],
    ['patch', 'patch', 'rpgmz', 'runtime-1'],
    ['apply', 'apply', 'rpgmz', 'runtime-1'],
    ['recover', 'recover', 'rpgmz', 'runtime-1'],
  ]);
});

test('operation dispatcher rejects an unregistered runtime operation deterministically', async () => {
  await assert.rejects(
    dispatchOperation(request('future-operation'), { format: 'unknown', dataDir: 'fixture' }, emptyResult(), {}, { operationId: 'runtime-1' }),
    (error) => error.code === 'E_REQUEST_INVALID' && /future-operation/.test(error.message),
  );
});
