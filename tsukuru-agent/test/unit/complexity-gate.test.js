const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(appRoot, 'scripts', 'check-complexity.js');
const api = fs.existsSync(scriptPath) ? require(scriptPath) : null;

test('TypeScript complexity gate is present', () => {
  assert.ok(api, 'scripts/check-complexity.js is missing');
});

test('complexity analysis counts control-flow decisions', { skip: !api }, () => {
  const functions = api.analyzeTypeScript(`
    function decide(a: boolean, b: boolean, values: number[]) {
      if (a && b) return 1;
      for (const value of values) {
        if (value > 0) return value;
      }
      return a ? 2 : 3;
    }
  `, 'fixture.ts');
  assert.deepEqual(functions.map(({ name, complexity }) => ({ name, complexity })), [
    { name: 'decide', complexity: 6 },
  ]);
});

test('nested functions own their decisions instead of inflating the parent', { skip: !api }, () => {
  const functions = api.analyzeTypeScript(`
    const outer = () => {
      const inner = (value: number) => value > 0 ? 1 : 0;
      return inner(1);
    };
  `, 'fixture.ts');
  assert.deepEqual(functions.map(({ name, complexity }) => ({ name, complexity })), [
    { name: 'outer', complexity: 1 },
    { name: 'inner', complexity: 2 },
  ]);
});

test('production TypeScript keeps every function at cyclomatic complexity 40 or lower', { skip: !api }, () => {
  assert.deepEqual(api.collectComplexityIssues({ maxComplexity: 40 }), []);
});
