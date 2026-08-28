const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(appRoot, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(appRoot, relativePath), 'utf8'));
}

function readTextFromApp(relativePath) {
  return fs.readFileSync(path.join(appRoot, relativePath), 'utf8');
}

test('package.json is the canonical 2.5.0 version source', () => {
  const packageJson = readJson('package.json');
  const legacyVersion = readJson('version.json');
  const releaseNotes = fs.readFileSync(path.join(repoRoot, 'v2.5-release-notes.md'), 'utf8');

  assert.equal(packageJson.version, '2.5.0');
  assert.equal(legacyVersion.version, packageJson.version);
  assert.equal(legacyVersion.type, 'json');
  assert.match(releaseNotes, new RegExp(`^# Tsukuru Agent v${packageJson.version}\\b`));
  const changelog = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, new RegExp(`^## \\[${packageJson.version.replaceAll('.', '\\.')}\\] - Unreleased$`, 'm'));
});

test('package metadata identifies the current public project and preserves upstream credit', () => {
  const packageJson = readJson('package.json');

  assert.equal(packageJson.name, 'tsukuru-agent');
  assert.equal(packageJson.description, 'Agent-friendly CLI and GUI for safe game translation workflows');
  assert.deepEqual(packageJson.repository, {
    type: 'git',
    url: 'https://github.com/Chiriri722/Tsukuru-Agent.git',
  });
  assert.equal(packageJson.homepage, 'https://github.com/Chiriri722/Tsukuru-Agent#readme');
  assert.deepEqual(packageJson.bugs, {
    url: 'https://github.com/Chiriri722/Tsukuru-Agent/issues',
  });
  assert.equal(packageJson.author, 'Chiriri722 and Tsukuru Agent contributors');
  assert.ok(packageJson.contributors.includes('Sziya (original Tsukuru Extractor author)'));
  assert.equal(packageJson.license, 'GPL-3.0-only');
});

test('GUI branding and support endpoints belong to Tsukuru Agent', () => {
  const packageJson = readJson('package.json');
  const mainSource = readTextFromApp('main.ts');
  const updatePolicySource = readTextFromApp('src/electron/updatePolicy.ts');
  const html = readTextFromApp('src/html/simple/index.html');

  assert.equal(packageJson.build.productName, 'Tsukuru Agent');
  assert.equal(packageJson.build.appId, 'net.electron.MVExtractor', 'legacy GUI app id preserves user settings');
  assert.equal(packageJson.build.protocols.name, 'Tsukuru Agent');
  assert.deepEqual(packageJson.build.protocols.schemes, ['tsukuru-agent', 'MVExtractor']);
  assert.match(html, /<title>Tsukuru Agent<\/title>/);
  assert.match(html, /<h1>Tsukuru Agent<\/h1>/);
  assert.match(updatePolicySource, /Chiriri722\/Tsukuru-Agent\/main\/tsukuru-agent\/version\.json/);
  assert.match(mainSource, /https:\/\/github\.com\/Chiriri722\/Tsukuru-Agent\/releases/);
  assert.match(mainSource, /https:\/\/github\.com\/Chiriri722\/Tsukuru-Agent\/issues/);
});

test('CLI archive naming derives the release version instead of hard-coding it', () => {
  const packageJson = readJson('package.json');
  const cliBuilder = readTextFromApp('electron-builder.cli.yml');

  assert.equal(packageJson.scripts['check:version'], 'node scripts/check-version.js');
  assert.equal(packageJson.scripts['sync:version'], 'node scripts/sync-version.js');
  assert.match(cliBuilder, /^artifactName: tsukuru-agent-\$\{version\}-\$\{os\}\.\$\{ext\}$/m);
  assert.match(readTextFromApp('scripts/sync-version.js'), /CHANGELOG\.md/);
  assert.match(readTextFromApp('scripts/check-version.js'), /CHANGELOG\.md/);
});

test('check:version validates the checked-in version surfaces', () => {
  const result = spawnSync(process.execPath, ['scripts/check-version.js'], {
    cwd: appRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), 'version identity OK: tsukuru-agent@2.5.0');
});

test('version policy reports drift without mutating files', () => {
  const { collectVersionIssues, readVersionSurfaces } = require('../../scripts/check-version.js');
  const surfaces = readVersionSurfaces(appRoot);
  surfaces.versionJson.version = '9.9.9';
  surfaces.changelog = surfaces.changelog.replace('## [2.5.0] - Unreleased', '## [9.9.9] - Unreleased');

  const issues = collectVersionIssues(surfaces);

  assert.ok(issues.some((issue) => issue.includes('version.json')));
  assert.ok(issues.some((issue) => issue.includes('CHANGELOG.md')));
  assert.equal(readJson('version.json').version, '2.5.0');
});
