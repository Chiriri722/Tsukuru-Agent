const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { GuiOperationCancellation } = require('../../.build/app/src/electron/operationCancellation.js');
const { validateIpcRequest, rendererToMainChannels } = require('../../.build/app/src/electron/ipcPolicy.js');
const { buildGuiContext } = require('../../.build/app/src/electron/guiContext.js');

test('GUI operation cancellation owns exactly one abortable operation', () => {
  const registry = new GuiOperationCancellation();
  let cancelHookCalls = 0;
  const first = registry.begin(() => { cancelHookCalls += 1; });
  assert.equal(first.signal.aborted, false);
  assert.throws(() => registry.begin(), (error) => error && error.code === 'E_OUTPUT_CONFLICT');
  assert.equal(registry.cancel(), true);
  assert.equal(first.signal.aborted, true);
  assert.equal(cancelHookCalls, 1);
  registry.finish(first.id);
  assert.equal(registry.cancel(), false);
  const second = registry.begin();
  assert.notEqual(second.id, first.id);
  registry.finish(second.id);
});

test('typed IPC and GUI context expose cancellation without arbitrary payloads', () => {
  assert.ok(rendererToMainChannels.includes('cancelOperation'));
  assert.equal(validateIpcRequest('cancelOperation', undefined), undefined);
  assert.throws(() => validateIpcRequest('cancelOperation', { operationId: 'other' }), /invalid/i);

  const controller = new AbortController();
  const context = buildGuiContext(controller.signal);
  assert.equal(context.signal.aborted, false);
  controller.abort();
  assert.equal(context.signal.aborted, true);
});

test('RPG and Wolf GUI adapters register and use the cancellation boundary', () => {
  const appRoot = path.resolve(__dirname, '..', '..');
  const operationHandlers = fs.readFileSync(path.join(appRoot, 'src/electron/handlers/operationHandlers.ts'), 'utf8');
  const main = fs.readFileSync(path.join(appRoot, 'main.ts'), 'utf8');
  const rpgApply = fs.readFileSync(path.join(appRoot, 'src/js/rpgmv/apply.ts'), 'utf8');
  const wolf = fs.readFileSync(path.join(appRoot, 'src/js/wolf/main.ts'), 'utf8');
  assert.match(operationHandlers, /onValidated\('cancelOperation'/);
  assert.match(main, /cancelOperation:/);
  assert.match(main, /guiOperationCancellation\.begin\(\(\) => cancelGuiOperation\(\)\)/);
  assert.match(rpgApply, /guiOperationCancellation\.begin\(\(\) => cancelGuiOperation\(\)\)/);
  assert.match(wolf, /guiOperationCancellation\.begin\(\(\) => cancelGuiOperation\(\)\)/);
  assert.match(main, /mainWindow\.on\('close',[\s\S]*guiOperationCancellation\.cancel\(\)/);
  assert.match(main, /before-quit[\s\S]*preventDefault\(\)[\s\S]*await terminateGuiOperation\(\)/);
  assert.match(main, /will-quit[\s\S]*terminateTrackedProcesses\(\)/);
});
