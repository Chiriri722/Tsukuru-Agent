const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { ErrorCodes, WarningCodes, OperationError, toOperationError } = require('../../.build/app/src/core/types.js');

const appRoot = path.resolve(__dirname, '..', '..');

function sourceCodeLiterals(prefix) {
  const values = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.name.endsWith('.ts')) {
        const source = fs.readFileSync(fullPath, 'utf8');
        const pattern = new RegExp(`[\\'"](${prefix}_[A-Z0-9_]+)[\\'"]`, 'g');
        for (const match of source.matchAll(pattern)) values.push(match[1]);
      }
    }
  };
  visit(path.join(appRoot, 'src'));
  return values;
}

test('error code names and values are unique and typo-resistant', () => {
  const entries = Object.entries(ErrorCodes);
  const values = entries.map(([, value]) => value);
  assert.equal(new Set(values).size, values.length);
  for (const [name, value] of entries) assert.equal(value, `E_${name}`);
});

test('all structured error literals in source belong to the canonical catalog', () => {
  const catalog = new Set(Object.values(ErrorCodes));
  const literals = sourceCodeLiterals('E');
  assert.ok(literals.length > 0);
  assert.deepEqual([...new Set(literals.filter((value) => !catalog.has(value)))], []);
  const warningCatalog = new Set(Object.values(WarningCodes));
  assert.deepEqual([...new Set(sourceCodeLiterals('W').filter((value) => !warningCatalog.has(value)))], []);
});

test('warning code names and values are unique and typo-resistant', () => {
  const entries = Object.entries(WarningCodes);
  const values = entries.map(([, value]) => value);
  assert.equal(new Set(values).size, values.length);
  for (const [name, value] of entries) assert.equal(value, `W_${name}`);
});

test('unknown failures normalize to the internal error contract deterministically', () => {
  const known = new OperationError(ErrorCodes.PATH_NOT_FOUND, 'missing', { path: 'x' });
  assert.equal(toOperationError(known), known);
  assert.deepEqual(toOperationError('boom').toJSON(), {
    code: ErrorCodes.INTERNAL,
    message: '내부 오류가 발생했습니다',
    details: undefined,
  });

  const privateFailure = new Error('failed at C:\\Users\\Private\\source.ts');
  privateFailure.stack = 'Error: failed\n    at C:\\Users\\Private\\source.ts:10:2';
  const normalized = toOperationError(privateFailure).toJSON();
  assert.deepEqual(normalized, {
    code: ErrorCodes.INTERNAL,
    message: '내부 오류가 발생했습니다',
    details: undefined,
  });
  assert.doesNotMatch(JSON.stringify(normalized), /Private|source\.ts|stack/i);
});
