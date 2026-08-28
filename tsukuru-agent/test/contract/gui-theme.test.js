const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(appRoot, relativePath), 'utf8');
}

test('theme tokens provide opaque surfaces, valid CSS variable names, and distinct choices', () => {
  const source = read('src/js/rpgmv/styles.ts');
  assert.doesNotMatch(source, /#(?:[0-9a-f]{6})00\b/i);
  assert.doesNotMatch(source, /["']--[^"']*:["']\s*:/);

  const themeBodies = [...source.matchAll(/["'](?:Dracula|Classic)["']\s*:\s*\{(?<body>[\s\S]*?)\}\s*,?/g)]
    .map((match) => match.groups.body.replace(/\s+/g, ''));
  assert.equal(themeBodies.length, 2);
  assert.notEqual(themeBodies[0], themeBodies[1]);
});

test('every primary stylesheet has a usable first-paint palette', () => {
  for (const relativePath of [
    'src/html/main/styles/main.scss',
    'src/html/simple/back.scss',
    'src/html/wolf/back.scss',
  ]) {
    const source = read(relativePath);
    const root = source.match(/:root\s*\{(?<body>[\s\S]*?)\}/)?.groups.body ?? '';
    for (const token of ['--mainColor', '--Highlight3', '--Highlight2', '--Highlight1', '--Background', '--Selected']) {
      assert.match(root, new RegExp(`${token}\\s*:\\s*#[0-9a-f]{6,8}`, 'i'), `${relativePath}: ${token}`);
    }
    assert.doesNotMatch(root, /:\s*#000(?:000)?(?:ff)?\s*;/i, relativePath);
  }
});
