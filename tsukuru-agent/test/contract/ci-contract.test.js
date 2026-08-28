const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(appRoot, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(appRoot, relativePath), 'utf8'));
}

test('supported Node and npm ranges and verification scripts are explicit', () => {
  const packageJson = readJson('package.json');

  assert.deepEqual(packageJson.engines, { node: '>=22 <25', npm: '>=10 <12' });
  assert.equal(packageJson.scripts['check:generated'], 'node scripts/check-generated-drift.js');
  assert.equal(packageJson.scripts['check:styles'], 'node scripts/check-style-drift.js');
  assert.equal(packageJson.scripts['check:complexity'], 'node scripts/check-complexity.js');
  assert.equal(packageJson.scripts['check:inventory'], 'node scripts/check-test-inventory.js');
  assert.equal(
    packageJson.scripts.verify,
    'npm-run-all --sequential check:version typecheck check:styles check:complexity test check:generated check:inventory check:supply-chain',
  );
  assert.equal(packageJson.scripts['verify:package'], 'node scripts/verify-package.js');
  assert.equal(packageJson.scripts['release:evidence'], 'node scripts/generate-release-evidence.js --output-dir');
});

test('CI runs portable verification and Windows packaging from the lockfile', () => {
  const packageJson = readJson('package.json');
  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'ci.yml');
  assert.equal(fs.existsSync(workflowPath), true, '.github/workflows/ci.yml must exist');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /node-version: 22/);
  assert.match(workflow, /cache: npm/);
  assert.match(workflow, /cache-dependency-path: tsukuru-agent\/package-lock\.json/);
  assert.match(workflow, /run: npm ci/);
  assert.match(workflow, /run: npm audit --omit=dev/);
  assert.match(workflow, /run: npm run verify/);
  assert.match(workflow, /run: npm run build:cli/);
  assert.match(workflow, /run: npm run verify:package/);
  assert.match(workflow, /npm run release:evidence -- dist-cli\/release-evidence/);
  assert.match(workflow, /dist-cli\/release-evidence\/SHA256SUMS/);
  assert.match(workflow, /dist-cli\/release-evidence\/release-manifest\.json/);
  assert.match(workflow, /dist-cli\/release-evidence\/sbom\.spdx\.json/);
  assert.match(workflow, /run: npm run test:electron/);
  assert.match(workflow, /uses: actions\/checkout@v7/);
  assert.match(workflow, /uses: actions\/setup-node@v7/);
  assert.match(workflow, /uses: actions\/upload-artifact@v7/);
  assert.match(workflow, /run: npm run test:coverage/);
  assert.match(workflow, /run: npm run test:coverage:core/);
  assert.match(workflow, /run: npm run test:order/);
  assert.doesNotMatch(workflow, /retry/i);
  assert.match(workflow, /retention-days: 7/);
  assert.doesNotMatch(workflow, /run: npm install(?:\s|$)/);
  assert.equal(packageJson.scripts['test:electron'], 'npm run compile:gui && electron test/electron-smoke-app');
  assert.equal(packageJson.scripts['test:coverage:core'], 'node scripts/run-tests.js --coverage-core');
  for (const file of ['package.json', 'main.js', 'index.html', 'renderer.js']) {
    assert.equal(fs.existsSync(path.join(appRoot, 'test', 'electron-smoke-app', file)), true, `missing Electron smoke ${file}`);
  }
  const smokeMain = fs.readFileSync(path.join(appRoot, 'test', 'electron-smoke-app', 'main.js'), 'utf8');
  for (const fragment of [
    "resolveRendererRoute('home'",
    'registerSettingsHandlers({',
    'registerProjectHandlers({',
    'registerOperationHandlers({',
    "onValidated('wolf_ext'",
    "onValidated('wolf_apply'",
  ]) {
    assert.match(smokeMain, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('README distinguishes developer install from reproducible CI and release install', () => {
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');

  assert.match(readme, /Node\.js 22\.x 또는 24\.x, npm 10\.x 또는 11\.x/);
  assert.match(readme, /개발 환경에서는 `npm install`/);
  assert.match(readme, /CI와 릴리스 검증에서는 반드시 `npm ci`/);
  assert.match(readme, /`npm run verify`/);
  assert.match(readme, /`npm run verify:package`/);

  const baseline = readJson(path.join('..', 'docs', 'coverage-baseline.json'));
  assert.deepEqual(baseline.thresholds, {
    scope: 'schema/path/transaction', lines: 70, branches: 50, functions: 85,
  });
  assert.deepEqual(baseline.tests, { files: 23, checks: 123, passed: 123 });
  assert.deepEqual(baseline.coverage, { lines: 76.91, branches: 64.67, functions: 77.98 });
  assert.deepEqual(baseline.coreGate.tests, { files: 28, checks: 150, passed: 150 });
  assert.deepEqual(baseline.coreGate.coverage, { lines: 81.68, branches: 64.26, functions: 96.08 });
  const runner = fs.readFileSync(path.join(appRoot, 'scripts', 'run-tests.js'), 'utf8');
  assert.match(runner, /--test-coverage-lines=70/);
  assert.match(runner, /--test-coverage-branches=50/);
  assert.match(runner, /--test-coverage-functions=85/);
  assert.match(readme, /core coverage[^\n]*line 70%[^\n]*branch 50%[^\n]*function 85%/i);
});

test('repository drift checks are executable and agree with the documented test inventory', () => {
  for (const script of ['check-generated-drift.js', 'check-test-inventory.js']) {
    assert.equal(fs.existsSync(path.join(appRoot, 'scripts', script)), true, `${script} must exist`);
  }

  const inventory = spawnSync(process.execPath, ['scripts/check-test-inventory.js'], {
    cwd: appRoot,
    encoding: 'utf8',
  });
  assert.equal(inventory.status, 0, inventory.stderr || inventory.stdout);
  assert.match(inventory.stdout, /test inventory OK: 58 files, 388 tests/);

  const generated = spawnSync(process.execPath, ['scripts/check-generated-drift.js'], {
    cwd: appRoot,
    encoding: 'utf8',
  });
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  assert.match(generated.stdout, /generated artifact check OK: 0 TypeScript-sibling source artifacts/);
});

test('publishes task-oriented architecture, compatibility, security, contribution, and release docs', () => {
  const required = [
    'docs/architecture.md',
    'docs/compatibility.md',
    'docs/reference/error-warning-codes.md',
    'docs/maintenance-policy.md',
    'docs/release-checklist.md',
    'SECURITY.md',
    'CONTRIBUTING.md',
  ];
  for (const relative of required) assert.ok(fs.existsSync(path.join(repoRoot, relative)), relative);

  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  assert.match(readme, /\*\*5개 작업\*\*[^\n]*`recover`/);
  assert.match(readme, /^## CLI 빠른 시작$/m);
  assert.match(readme, /^## GUI 사용$/m);

  const architecture = fs.readFileSync(path.join(repoRoot, 'docs', 'architecture.md'), 'utf8');
  for (const term of ['OperationRuntime', 'WorkspaceTransaction', 'provenance', 'renderer', 'preload']) {
    assert.match(architecture, new RegExp(term, 'i'));
  }
  const compatibility = fs.readFileSync(path.join(repoRoot, 'docs', 'compatibility.md'), 'utf8');
  for (const term of ['RPG Maker MV', 'Wolf RPG', 'TyranoScript', 'GDevelop', 'Electron ASAR', 'NW.js', 'diagnostic', 'experimental']) {
    assert.match(compatibility, new RegExp(term, 'i'));
  }
  const security = fs.readFileSync(path.join(repoRoot, 'SECURITY.md'), 'utf8');
  for (const term of ['private', 'archive', 'symbolic link', 'experimental']) {
    assert.match(security, new RegExp(term, 'i'));
  }
  const packageJson = readJson('package.json');
  assert.match(security, new RegExp(`Electron ${packageJson.devDependencies.electron.replaceAll('.', '\\.')}`));
  assert.match(security, new RegExp(`electron-builder ${packageJson.devDependencies['electron-builder'].replaceAll('.', '\\.')}`));
  const contributing = fs.readFileSync(path.join(repoRoot, 'CONTRIBUTING.md'), 'utf8');
  for (const term of ['npm ci', 'npm run verify', 'fixture', 'JSON Schema', 'release checklist']) {
    assert.match(contributing, new RegExp(term, 'i'));
  }
  assert.match(fs.readFileSync(path.join(repoRoot, 'task_plan.md'), 'utf8'), /historical/i);
  assert.match(fs.readFileSync(path.join(repoRoot, 'v2.5-validation-compatibility-plan.md'), 'utf8'), /historical/i);

  const markdownFiles = [
    path.join(repoRoot, 'README.md'),
    path.join(repoRoot, 'CHANGELOG.md'),
    ...required.map((relative) => path.join(repoRoot, relative)),
  ];
  for (const markdownFile of markdownFiles) {
    const markdown = fs.readFileSync(markdownFile, 'utf8');
    for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      assert.ok(
        fs.existsSync(path.resolve(path.dirname(markdownFile), target)),
        `${path.relative(repoRoot, markdownFile)} -> ${target}`,
      );
    }
  }
});

test('documents every canonical error and warning code', () => {
  const { ErrorCodes, WarningCodes } = require('../../.build/app/src/core/types.js');
  const reference = fs.readFileSync(path.join(repoRoot, 'docs', 'reference', 'error-warning-codes.md'), 'utf8');
  for (const code of [...Object.values(ErrorCodes), ...Object.values(WarningCodes)]) {
    assert.match(reference, new RegExp('`' + code + '`'));
  }
});

test('release and maintenance policy separate automated evidence from manual gameplay', () => {
  const release = fs.readFileSync(path.join(repoRoot, 'docs', 'release-checklist.md'), 'utf8');
  for (const term of ['npm run verify', 'npm run build:cli', 'npm run verify:package', 'release:evidence', 'manual gameplay']) {
    assert.match(release, new RegExp(term, 'i'));
  }
  const packageJson = readJson('package.json');
  assert.match(release, new RegExp(`Electron ${packageJson.devDependencies.electron.replaceAll('.', '\\.')}`));
  assert.match(release, new RegExp(`electron-builder ${packageJson.devDependencies['electron-builder'].replaceAll('.', '\\.')}`));
  const maintenance = fs.readFileSync(path.join(repoRoot, 'docs', 'maintenance-policy.md'), 'utf8');
  for (const term of ['schemaVersion', 'deprecation', 'experimental', 'v2 migration']) {
    assert.match(maintenance, new RegExp(term, 'i'));
  }
});

test('test suites are separated by responsibility with no root-level test files', () => {
  for (const directory of ['unit', 'contract', 'integration', 'e2e', 'helpers']) {
    assert.equal(
      fs.statSync(path.join(appRoot, 'test', directory)).isDirectory(),
      true,
      `test/${directory} must exist`,
    );
  }

  const rootTests = fs.readdirSync(path.join(appRoot, 'test'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => entry.name);
  assert.deepEqual(rootTests, []);
});

test('INV-01 through INV-06 are mapped to executable regression tests', () => {
  const catalogPath = path.join(appRoot, 'test', 'helpers', 'invariants.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  assert.deepEqual(catalog.invariants.map((entry) => entry.id), [
    'INV-01', 'INV-02', 'INV-03', 'INV-04', 'INV-05', 'INV-06',
  ]);
  for (const invariant of catalog.invariants) {
    assert.ok(invariant.tests.length > 0, `${invariant.id} has no tests`);
    for (const reference of invariant.tests) {
      const source = fs.readFileSync(path.join(appRoot, reference.file), 'utf8');
      assert.match(source, new RegExp(`test\\(['\"]${reference.title.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}['\"]`));
    }
  }
});

test('package verifier accepts the required CLI identity and allowlisted entries', () => {
  const verifierPath = path.join(appRoot, 'scripts', 'verify-package.js');
  assert.equal(fs.existsSync(verifierPath), true, 'verify-package.js must exist');
  const { REQUIRED_ENTRIES, collectPackageIssues } = require(verifierPath);
  const packageJson = readJson('package.json');

  const issues = collectPackageIssues({
    packageJson: { ...packageJson, main: 'src/cli/electronMain.js', productName: 'tsukuru-agent' },
    entries: REQUIRED_ENTRIES,
    artifactName: `tsukuru-agent-${packageJson.version}-win.zip`,
    expectedVersion: packageJson.version,
  });

  assert.deepEqual(issues, []);
});

test('headless packaged entry starts without waiting for GUI readiness and smoke is bounded', () => {
  const entry = fs.readFileSync(path.join(appRoot, 'src', 'cli', 'electronMain.ts'), 'utf8');
  assert.match(entry, /runAgent\(process\.argv\.slice\(1\)\)/);
  assert.doesNotMatch(entry, /whenReady\s*\(/);
  assert.match(entry, /app\.exit\(code\)/);

  const verifier = fs.readFileSync(path.join(appRoot, 'scripts', 'verify-package.js'), 'utf8');
  assert.match(verifier, /timeout:\s*15_000/);
  assert.match(verifier, /killSignal:\s*'SIGKILL'/);
  assert.match(verifier, /ETIMEDOUT/);
});

test('packaged smoke exercises bounded success and failure JSON contracts', () => {
  const verifierPath = path.join(appRoot, 'scripts', 'verify-package.js');
  const { runPackagedSmoke } = require(verifierPath);
  const calls = [];
  let fixtureRoot;
  const spawnProcess = (executablePath, args, options) => {
    assert.equal(executablePath, 'C:\\fake\\tsukuru-agent.exe');
    assert.deepEqual(args.slice(0, 2), ['run', '--request']);
    assert.equal(options.timeout, 15_000);
    assert.equal(options.killSignal, 'SIGKILL');
    const requestPath = args[2];
    calls.push(requestPath);
    if (!fs.existsSync(requestPath)) {
      return {
        status: 1,
        stdout: JSON.stringify({ ok: false, error: { code: 'E_REQUEST_INVALID' } }),
        stderr: '',
      };
    }
    fixtureRoot = path.dirname(requestPath);
    const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
    assert.equal(request.operation, 'verify');
    assert.equal(fs.existsSync(path.join(request.projectPath, 'Backup', 'Actors.json')), true);
    assert.equal(fs.existsSync(path.join(request.projectPath, 'Extract', 'manifest.json')), true);
    return {
      status: 0,
      stdout: JSON.stringify({
        ok: true,
        format: 'rpgmv',
        validation: { entriesChecked: 1, validEntries: 1, invalidEntries: 0 },
      }),
      stderr: '',
    };
  };

  const result = runPackagedSmoke('C:\\fake\\tsukuru-agent.exe', {
    platform: 'win32',
    spawnProcess,
    tempDirectory: os.tmpdir(),
  });

  assert.equal(calls.length, 2);
  assert.equal(result.success.exitCode, 0);
  assert.equal(result.success.entriesChecked, 1);
  assert.equal(result.failure.exitCode, 1);
  assert.equal(result.failure.errorCode, 'E_REQUEST_INVALID');
  assert.equal(fs.existsSync(fixtureRoot), false, 'packaged success fixture must be cleaned');
});

test('package verifier rejects metadata drift, missing files, and nested outputs', () => {
  const verifierPath = path.join(appRoot, 'scripts', 'verify-package.js');
  assert.equal(fs.existsSync(verifierPath), true, 'verify-package.js must exist');
  const { collectPackageIssues } = require(verifierPath);

  const issues = collectPackageIssues({
    packageJson: { name: 'wrong', version: '0.0.0', main: 'main.js', repository: {} },
    entries: ['package.json', 'dist-cli/old.zip', 'exfiles/eztrans/EztransServer.exe'],
    artifactName: 'wrong.zip',
    expectedVersion: '2.5.0',
  });

  assert.ok(issues.some((issue) => issue.includes('package name')));
  assert.ok(issues.some((issue) => issue.includes('package version')));
  assert.ok(issues.some((issue) => issue.includes('entry point')));
  assert.ok(issues.some((issue) => issue.includes('missing required entry')));
  assert.ok(issues.some((issue) => issue.includes('forbidden output entry')));
  assert.ok(issues.some((issue) => issue.includes('forbidden external binary')));
  assert.ok(issues.some((issue) => issue.includes('artifact name')));
});
