const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(appRoot, relativePath), 'utf8');
}

function rendererSources() {
  return [
    'src/html/config/script.ts',
    'src/html/main/renderer.ts',
    'src/html/simple/rend.ts',
    'src/html/wolf/rend.ts',
  ];
}

test('every BrowserWindow is created through the secure window factory', () => {
  const factoryPath = path.join(appRoot, 'src', 'electron', 'windowFactory.ts');
  assert.ok(fs.existsSync(factoryPath), 'secure window factory is missing');

  const candidates = [
    'main.ts',
    'src/js/libs/papagotrans.ts',
  ];
  for (const relativePath of candidates) {
    assert.doesNotMatch(read(relativePath), /new\s+BrowserWindow\s*\(/, relativePath);
  }

  const factory = read('src/electron/windowFactory.ts');
  assert.match(factory, /nodeIntegration:\s*false/);
  assert.match(factory, /contextIsolation:\s*true/);
  assert.match(factory, /sandbox:\s*true/);
  assert.match(factory, /webSecurity:\s*true/);
  assert.match(factory, /setWindowOpenHandler/);
  assert.match(factory, /will-navigate/);
});

test('renderers use only the typed preload bridge and no Node globals', () => {
  for (const relativePath of rendererSources()) {
    const source = read(relativePath);
    assert.doesNotMatch(source, /(?:window\.)?require\s*\(/, relativePath);
    assert.doesNotMatch(source, /\bipcRenderer\b/, relativePath);
    assert.doesNotMatch(source, /\bBuffer\s*\./, relativePath);
    assert.match(source, /window\.tsukuru/, relativePath);
  }
});

test('local HTML has a restrictive CSP and no remote executable script', () => {
  for (const relativePath of [
    'src/html/config/settings.html',
    'src/html/license.html',
    'src/html/main/index.html',
    'src/html/simple/index.html',
    'src/html/wolf/index.html',
  ]) {
    const html = read(relativePath);
    assert.match(html, /http-equiv=["']Content-Security-Policy["']/i, relativePath);
    assert.match(html, /default-src\s+'self'/i, relativePath);
    assert.match(html, /object-src\s+'none'/i, relativePath);
    assert.doesNotMatch(html, /<script[^>]+src=["']https?:\/\//i, relativePath);
  }
});

test('renderer route changes use fixed route IDs instead of file paths', () => {
  for (const relativePath of rendererSources()) {
    const source = read(relativePath);
    assert.doesNotMatch(source, /send\(['"]changeURL['"],\s*['"].*\.html/i, relativePath);
    assert.doesNotMatch(source, /send\(['"]openFolder['"]/i, relativePath);
  }
  const main = read('main.ts');
  assert.doesNotMatch(main, /loadFile\(arg\)/);
});

test('legacy open package and renderer update requests are removed', () => {
  const main = read('main.ts');
  assert.doesNotMatch(main, /from\s+['"]open['"]/);
  assert.doesNotMatch(main, /ipcMain\.on\s*\(/);
  assert.doesNotMatch(main, /process\.on\(['"]uncaughtException['"]/);
  assert.ok(fs.existsSync(path.join(appRoot, 'src', 'electron', 'handlers', 'windowHandlers.ts')));
  assert.match(main, /registerWindowHandlers\s*\(/);
  for (const channel of ['license', 'changeURL', 'updatePage', 'eztransHelp', 'minimize', 'close', 'app_version', 'updates', 'openFolder', 'setheight']) {
    assert.doesNotMatch(main, new RegExp(`onValidated\\(['"]${channel}['"]`), channel);
  }
  for (const [file, registration] of [
    ['settingsHandlers.ts', 'registerSettingsHandlers'],
    ['projectHandlers.ts', 'registerProjectHandlers'],
    ['operationHandlers.ts', 'registerOperationHandlers'],
  ]) {
    assert.ok(fs.existsSync(path.join(appRoot, 'src', 'electron', 'handlers', file)), `${file} is missing`);
    assert.match(main, new RegExp(`${registration}\\s*\\(`));
  }
  assert.doesNotMatch(main, /onValidated\s*\(/, 'main.ts must not own IPC channel registration');
});

test('Electron network use and offline behavior are explicitly documented', () => {
  const policyPath = path.join(appRoot, 'docs', 'electron-network-policy.md');
  assert.ok(fs.existsSync(policyPath), 'Electron network policy is missing');
  const policy = fs.readFileSync(policyPath, 'utf8');
  assert.match(policy, /raw\.githubusercontent\.com\/Chiriri722\/Tsukuru-Agent/);
  assert.match(policy, /5(?:,?000|초)/);
  assert.match(policy, /offline/i);
  assert.match(policy, /papago\.naver\.com/);
  assert.match(policy, /WolfDec/i);
  assert.match(policy, /renderer[^\n]*(?:remote|원격)[^\n]*(?:script|스크립트)/i);
});
