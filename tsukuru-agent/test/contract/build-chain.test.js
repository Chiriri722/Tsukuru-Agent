const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const appRoot = path.resolve(__dirname, '..', '..');
const packagePath = path.join(appRoot, 'package.json');
const buildConfigPath = path.join(appRoot, 'tsconfig.build.json');
const prepareScriptPath = path.join(appRoot, 'scripts', 'prepare-build.js');
const cleanScriptPath = path.join(appRoot, 'scripts', 'clean-output.js');
const stageRoot = path.join(appRoot, '.build', 'app');

function readPackage() {
  return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function trackedRuntimeSnapshot() {
  const files = childProcess.execFileSync(
    'git',
    ['ls-files', 'main.ts', 'main_update.ts', 'src'],
    { cwd: appRoot, encoding: 'utf8' },
  ).trim().split(/\r?\n/).filter(Boolean);
  const existingFiles = files.filter((file) => fs.existsSync(path.join(appRoot, file)));
  return new Map(existingFiles.map((file) => [file, sha256(path.join(appRoot, file))]));
}

test('both GUI and CLI package scripts compile before electron-builder', () => {
  const scripts = readPackage().scripts;
  assert.equal(scripts.pretest, 'npm run compile');
  for (const [name, compileName, cleanName] of [
    ['build', 'compile:gui', 'clean:gui'],
    ['build2', 'compile:gui', 'clean:gui'],
    ['build:cli', 'compile:cli', 'clean:cli'],
  ]) {
    const command = scripts[name] || '';
    const compileAt = command.indexOf(`npm run ${compileName}`);
    const cleanAt = command.indexOf(`npm run ${cleanName}`);
    const builderAt = command.indexOf('electron-builder');
    assert.ok(compileAt >= 0, `${name} does not invoke npm run compile`);
    assert.ok(cleanAt > compileAt, `${name} must clean its output after compile`);
    assert.ok(builderAt > cleanAt, `${name} must clean before electron-builder`);
  }
});

test('output cleanup only accepts the two package output directories', () => {
  assert.ok(fs.existsSync(cleanScriptPath), 'scripts/clean-output.js is missing');
  const { resolveOutputDirectory } = require(cleanScriptPath);
  assert.equal(resolveOutputDirectory('dist'), path.join(appRoot, 'dist'));
  assert.equal(resolveOutputDirectory('dist-cli'), path.join(appRoot, 'dist-cli'));
  for (const unsafe of ['.', '..', 'node_modules', '.build', path.parse(appRoot).root]) {
    assert.throws(() => resolveOutputDirectory(unsafe), /unsupported output directory/);
  }
});

test('development launchers execute the staged application', () => {
  const scripts = readPackage().scripts;
  assert.match(scripts.start2 || '', /^npm run compile\s*&&\s*electron \.build\/app start$/);
  assert.match(scripts.agent || '', /^npm run compile\s*&&\s*node \.build\/app\/src\/cli\/main\.js$/);
});

test('the test runner serializes staging mutations and owns a disposable temp root', () => {
  assert.equal(readPackage().scripts.test, 'node scripts/run-tests.js');
  assert.equal(readPackage().scripts['test:coverage'], 'node scripts/run-tests.js --coverage');
  assert.equal(readPackage().scripts['test:order'], 'node scripts/run-tests.js --order-seed=1414747474');
  assert.ok(fs.existsSync(path.join(appRoot, 'scripts', 'run-tests.js')));
  const runner = fs.readFileSync(path.join(appRoot, 'scripts', 'run-tests.js'), 'utf8');
  assert.match(runner, /--experimental-test-coverage/);
  assert.match(runner, /--order-seed/);
  assert.doesNotMatch(runner, /rerun-failures|testRetry|retryFailed|flakyRetry/i);
});

test('TypeScript emit and package inputs use an isolated staging tree', () => {
  assert.ok(fs.existsSync(buildConfigPath), 'tsconfig.build.json is missing');
  const buildConfig = JSON.parse(fs.readFileSync(buildConfigPath, 'utf8'));
  assert.equal(buildConfig.compilerOptions.rootDir, '.');
  assert.equal(buildConfig.compilerOptions.outDir, '.build/app');
  assert.equal(buildConfig.compilerOptions.noEmitOnError, true);

  const guiFiles = readPackage().build.files;
  assert.equal(guiFiles.length, 1);
  assert.equal(readPackage().build.win.files, undefined);
  assert.ok(guiFiles.every((entry) => typeof entry === 'object'));
  assert.ok(guiFiles.some((entry) => entry.from === '.build/app' && entry.to === '.'));
  const guiStage = guiFiles.find((entry) => entry.from === '.build/app');
  assert.ok(!guiStage.filter.includes('!package.json'), 'GUI package metadata is excluded');

  const cliConfig = fs.readFileSync(path.join(appRoot, 'electron-builder.cli.yml'), 'utf8');
  assert.match(cliConfig, /from:\s*["']?\.build\/app["']?/);
  assert.match(cliConfig, /^\s+-\s*["']?package\.json["']?\s*$/m);
  assert.doesNotMatch(cliConfig, /from:\s*["']?\.["']?\s*$/m);
  assert.match(cliConfig, /extraMetadata:[\s\S]*?main:\s*src\/cli\/electronMain\.js/);
  assert.doesNotMatch(cliConfig, /^ {2}-\s*["']?src\//m);
});

test('tracked regression tests load compiled modules from the staging tree', () => {
  for (const name of [
    'integration/core.test.js',
    'e2e/agent-workflows.test.js',
    'integration/runtime.test.js',
    'unit/schema-detect.test.js',
  ]) {
    const source = fs.readFileSync(path.join(appRoot, 'test', name), 'utf8');
    assert.doesNotMatch(source, /require\(["']\.\.\/src\//, `${name} still loads source-tree JavaScript`);
    assert.doesNotMatch(source, /path\.join\(__dirname,\s*["']\.\.["'],\s*["']src["']/, `${name} still executes source-tree JavaScript`);
    assert.match(source, /\.\.\/\.\.\/\.build\/app\/src\//, `${name} does not load staged JavaScript`);
  }
});

test('compile leaves tracked runtime sources unchanged and stages required files', () => {
  assert.ok(fs.existsSync(prepareScriptPath), 'scripts/prepare-build.js is missing');
  const before = trackedRuntimeSnapshot();

  childProcess.execFileSync(process.execPath, [prepareScriptPath], {
    cwd: appRoot,
    stdio: 'pipe',
  });

  const after = trackedRuntimeSnapshot();
  assert.deepEqual(after, before);

  const required = [
    'main.js',
    'src/cli/electronMain.js',
    'src/cli/main.js',
    'src/js/rpgmv/RpgMakerService.js',
    'src/js/wolf/WolfService.js',
    'src/js/tyrano/TyranoService.js',
    'src/js/gdevelop/GDevelopService.js',
    'src/html/simple/index.html',
    'src/html/simple/back.css',
    'src/lib/sweetalert2/main.js',
    'res/icon.png',
    'LICENSE',
    'NOTICE.md',
    'THIRD-PARTY-NOTICES',
    'package.json',
  ];
  for (const relativePath of required) {
    assert.ok(fs.existsSync(path.join(stageRoot, relativePath)), `missing staged file: ${relativePath}`);
  }

  const stagedPackage = JSON.parse(fs.readFileSync(path.join(stageRoot, 'package.json'), 'utf8'));
  assert.equal(stagedPackage.main, 'main.js');

  const forbidden = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (/\.(?:ts|tsx|scss|map)$/i.test(entry.name)) forbidden.push(fullPath);
    }
  };
  visit(stageRoot);
  assert.deepEqual(forbidden, []);
});

test('targeted staging writes the package entry point for each product', () => {
  childProcess.execFileSync(process.execPath, [prepareScriptPath, 'cli'], { cwd: appRoot, stdio: 'pipe' });
  let stagedPackage = JSON.parse(fs.readFileSync(path.join(stageRoot, 'package.json'), 'utf8'));
  assert.equal(stagedPackage.main, 'src/cli/electronMain.js');

  childProcess.execFileSync(process.execPath, [prepareScriptPath, 'gui'], { cwd: appRoot, stdio: 'pipe' });
  stagedPackage = JSON.parse(fs.readFileSync(path.join(stageRoot, 'package.json'), 'utf8'));
  assert.equal(stagedPackage.main, 'main.js');
});
