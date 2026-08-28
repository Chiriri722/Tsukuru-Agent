const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..', '..');
const scssPaths = [
  'src/html/main/styles/main.scss',
  'src/html/simple/back.scss',
  'src/html/wolf/back.scss',
];

function read(relativePath) {
  return fs.readFileSync(path.join(appRoot, relativePath), 'utf8');
}

test('SCSS is the reproducible source for shipped GUI CSS', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.match(packageJson.devDependencies?.sass ?? '', /^\d+\.\d+\.\d+$/);
  assert.equal(packageJson.scripts?.styles, 'sass src/html:src/html --no-source-map');
  assert.ok(fs.existsSync(path.join(appRoot, 'scripts', 'css-rule-diff.js')));
});

test('each GUI stylesheet defines motion, focus, and reduced-motion contracts', () => {
  const requiredTokens = ['--ease-out', '--ease-in-out', '--ease-drawer', '--dur-press', '--dur-panel', '--dur-drawer'];
  for (const relativePath of scssPaths) {
    const source = read(relativePath);
    for (const token of requiredTokens) assert.match(source, new RegExp(`${token}\\s*:`), `${relativePath}: ${token}`);
    assert.match(source, /:focus-visible/);
    assert.match(source, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    assert.doesNotMatch(source, /transition:\s*0?\.\d+s\s*;/);
    assert.doesNotMatch(source, /scale\(0\)/);
  }

  const settings = read('src/html/config/styles.css');
  assert.match(settings, /:focus-visible/);
  assert.match(settings, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('press and hover feedback is explicit and input-capability aware', () => {
  for (const relativePath of scssPaths) {
    const source = read(relativePath);
    assert.match(source, /:active[\s\S]*?scale\(0\.97\)/, relativePath);
    assert.match(source, /transition:[^;]*transform[^;]*var\(--dur-press\)[^;]*var\(--ease-out\)/, relativePath);
    assert.match(source, /transition:[^;]*background-color\s+150ms\s+ease/, relativePath);
  }
  const wolf = read('src/html/wolf/back.scss');
  assert.match(wolf, /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*\{[\s\S]*?\.runbtn:hover[\s\S]*?\}/);
});

test('progress bars animate compositor transforms instead of layout width', () => {
  for (const relativePath of ['src/html/main/renderer.ts', 'src/html/wolf/rend.ts']) {
    const source = read(relativePath);
    assert.doesNotMatch(source, /\.style\.width\s*=/, relativePath);
    assert.match(source, /\.style\.transform\s*=\s*`scaleX\(/, relativePath);
  }
  for (const relativePath of ['src/html/main/styles/main.scss', 'src/html/wolf/back.scss']) {
    const source = read(relativePath);
    const progressRule = source.match(/#border_r\s*\{(?<body>[\s\S]*?)\}/)?.groups.body ?? '';
    assert.match(progressRule, /width:\s*100vw/);
    assert.match(progressRule, /transform:\s*scaleX\(0\)/);
    assert.match(progressRule, /transform-origin:\s*left/);
    assert.match(progressRule, /transition:\s*transform\s+200ms\s+linear/);
  }
});

test('mode panels fade safely and are removed from keyboard navigation while hidden', () => {
  const scss = read('src/html/main/styles/main.scss');
  const hiddenRule = scss.match(/\.hiddenc\s*\{(?<body>[\s\S]*?)\}/)?.groups.body ?? '';
  assert.doesNotMatch(hiddenRule, /visibility\s*:/);
  assert.match(hiddenRule, /opacity:\s*0/);
  assert.match(hiddenRule, /transform:\s*scale\(0\.98\)/);
  assert.match(hiddenRule, /pointer-events:\s*none/);

  const renderer = read('src/html/main/renderer.ts');
  assert.match(renderer, /\binert\b/);
  assert.match(renderer, /aria-hidden/);
});
