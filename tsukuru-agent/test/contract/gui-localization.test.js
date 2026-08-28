const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..', '..');
const sourcePath = path.join(appRoot, 'src', 'lib', 'enlang', 'enlang.js');

test('English localization is one-shot and avoids HTML injection sinks', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.doesNotMatch(source, /while\s*\(\s*true\s*\)/);
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.doesNotMatch(source, /setTimeout\s*\(/);
  assert.match(source, /\.textContent\s*=/);
});

test('loadEn translates current nodes idempotently and preserves newlines as text', () => {
  const elements = [
    {
      textContent: '이전 값',
      getAttribute(name) { return name === 'enlang' ? 'Line one\nLine two' : null; },
    },
    {
      textContent: '이전 값 2',
      getAttribute(name) { return name === 'enlang' ? 'Safe <b>text</b>' : null; },
    },
  ];
  const context = {
    document: {
      documentElement: { lang: 'ko' },
      querySelectorAll(selector) {
        assert.equal(selector, '[enlang]');
        return elements;
      },
    },
  };
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });

  assert.equal(typeof context.loadEn, 'function');
  assert.equal(context.loadEn(), 2);
  assert.equal(context.loadEn(), 2);
  assert.equal(elements[0].textContent, 'Line one\nLine two');
  assert.equal(elements[1].textContent, 'Safe <b>text</b>');
  assert.equal(context.document.documentElement.lang, 'en');
});
