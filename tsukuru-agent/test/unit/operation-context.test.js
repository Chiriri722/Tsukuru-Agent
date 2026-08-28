const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createOperationContext,
  ctx,
  hasActiveContext,
  withOperationContext,
} = require('../../.build/app/src/core/context.js');

const sink = { set() {}, done() {} };
const logger = { info() {}, warn() {}, error() {}, debug() {} };

function context(label) {
  const value = createOperationContext(sink, logger);
  value.rpg.settings.label = label;
  return value;
}

test('operation context is cleared after success and failure', async () => {
  const first = context('first');
  assert.equal(hasActiveContext(), false);
  assert.equal(await withOperationContext(first, async () => ctx().rpg.settings.label), 'first');
  assert.equal(hasActiveContext(), false);

  await assert.rejects(
    withOperationContext(first, async () => { throw new Error('boom'); }),
    /boom/,
  );
  assert.equal(hasActiveContext(), false);
  assert.throws(() => ctx(), /Operation context is not set/);
});

test('nested operation context restores its parent', () => {
  const outer = context('outer');
  const inner = context('inner');
  withOperationContext(outer, () => {
    assert.equal(ctx(), outer);
    withOperationContext(inner, () => assert.equal(ctx(), inner));
    assert.equal(ctx(), outer);
  });
  assert.equal(hasActiveContext(), false);
});

test('parallel operation contexts never share mutable engine state', async () => {
  const first = context('first');
  const second = context('second');
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let bothReady = 0;
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });

  const run = (value) => withOperationContext(value, async () => {
    bothReady += 1;
    if (bothReady === 2) readyResolve();
    await gate;
    assert.equal(ctx(), value);
    return ctx().rpg.settings.label;
  });
  const pending = Promise.all([run(first), run(second)]);
  await ready;
  release();
  assert.deepEqual(await pending, ['first', 'second']);
  assert.equal(hasActiveContext(), false);
});

test('context implementation and service boundaries have no active singleton setter', () => {
  const appRoot = path.resolve(__dirname, '..', '..');
  const files = [
    'src/core/context.ts',
    'src/js/rpgmv/RpgMakerService.ts',
    'src/js/wolf/WolfService.ts',
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(appRoot, file), 'utf8');
    assert.doesNotMatch(source, /\bactiveContext\b/, file);
    assert.doesNotMatch(source, /\bsetActiveContext\b/, file);
  }
});
