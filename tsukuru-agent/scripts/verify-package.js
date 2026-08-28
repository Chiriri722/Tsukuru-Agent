const asar = require('@electron/asar');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspectDeterministicZip } = require('./normalize-release-zip.js');

const appRoot = path.resolve(__dirname, '..');
const repositoryUrl = 'https://github.com/Chiriri722/Tsukuru-Agent.git';
const REQUIRED_ENTRIES = [
  'package.json',
  'src/cli/electronMain.js',
  'src/cli/main.js',
  'src/cli/run.js',
  'src/core/container.js',
  'src/core/runtimeDiagnostics.js',
  'src/core/schema.js',
  'src/core/validator.js',
  'src/js/gdevelop/GDevelopService.js',
  'src/js/rpgmv/RpgMakerService.js',
  'src/js/tyrano/TyranoService.js',
  'src/js/wolf/WolfService.js',
  'LICENSE',
  'NOTICE.md',
  'THIRD-PARTY-NOTICES',
];

function normalizeEntry(entry) {
  return entry.replaceAll('\\', '/').replace(/^\/+/, '');
}

function collectPackageIssues({ packageJson, entries, artifactName, expectedVersion }) {
  const issues = [];
  const normalizedEntries = entries.map(normalizeEntry);
  const entrySet = new Set(normalizedEntries);
  const expectedArtifactName = `tsukuru-agent-${expectedVersion}-win.zip`;

  if (packageJson.name !== 'tsukuru-agent') issues.push('package name must be tsukuru-agent');
  if (packageJson.version !== expectedVersion) issues.push(`package version must be ${expectedVersion}`);
  if (packageJson.main !== 'src/cli/electronMain.js') issues.push('package entry point must be src/cli/electronMain.js');
  if (packageJson.repository?.url !== repositoryUrl) issues.push('package repository metadata is stale');
  if (artifactName !== expectedArtifactName) issues.push(`artifact name must be ${expectedArtifactName}`);
  for (const required of REQUIRED_ENTRIES) {
    if (!entrySet.has(required)) issues.push(`missing required entry: ${required}`);
  }
  for (const entry of normalizedEntries) {
    if (/^exfiles(?:\/|$)/.test(entry)) {
      issues.push(`forbidden external binary in CLI core: ${entry}`);
    }
    if (/^(?:\.build|dist|dist-cli|test)(?:\/|$)/.test(entry)) {
      issues.push(`forbidden output entry: ${entry}`);
    }
  }
  return issues;
}

function parseSingleJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error('packaged CLI stdout is empty');
  return JSON.parse(trimmed);
}

function runPackagedSmoke(executablePath, dependencies = {}) {
  const platform = dependencies.platform ?? process.platform;
  if (platform !== 'win32') return { skipped: true };
  const spawnProcess = dependencies.spawnProcess ?? spawnSync;
  const tempDirectory = path.resolve(dependencies.tempDirectory ?? os.tmpdir());
  const smokeRoot = fs.mkdtempSync(path.join(tempDirectory, 'tsukuru-package-smoke-'));
  if (path.dirname(path.resolve(smokeRoot)) !== tempDirectory
    || !path.basename(smokeRoot).startsWith('tsukuru-package-smoke-')) {
    throw new Error(`refusing unexpected packaged smoke root: ${smokeRoot}`);
  }

  let outcome;
  let operationError;
  try {
    const packRoot = path.join(smokeRoot, 'pack');
    const backupRoot = path.join(packRoot, 'Backup');
    const extractRoot = path.join(packRoot, 'Extract');
    fs.mkdirSync(backupRoot, { recursive: true });
    fs.mkdirSync(extractRoot, { recursive: true });
    const sourceText = 'Alice';
    const actors = [null, { id: 1, name: sourceText, classId: 0 }];
    fs.writeFileSync(path.join(backupRoot, 'Actors.json'), JSON.stringify(actors));
    fs.writeFileSync(path.join(packRoot, '.extracteddata'), '{}');
    fs.writeFileSync(path.join(extractRoot, 'Actors.txt'), `${sourceText}\n`);
    fs.writeFileSync(path.join(extractRoot, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      format: 'rpgmv',
      entries: [{
        id: 'Actors.json#1.name',
        sourceFile: 'Backup/Actors.json',
        dataPath: '1.name',
        extractFile: 'Actors.txt',
        lineStart: 0,
        lineEnd: 1,
        hash: crypto.createHash('sha256').update(sourceText).digest('hex'),
        encoding: 'utf8',
        nullTerminated: false,
      }],
    }));
    const successRequest = path.join(smokeRoot, 'success-request.json');
    fs.writeFileSync(successRequest, JSON.stringify({
      schemaVersion: 2,
      operation: 'verify',
      format: 'auto',
      projectPath: packRoot,
      profile: 'standard',
      options: { verifyDepth: 'deep' },
      patches: [],
    }));

    const execute = (requestPath, label) => {
      const result = spawnProcess(executablePath, ['run', '--request', requestPath], {
        cwd: appRoot,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15_000,
        killSignal: 'SIGKILL',
      });
      if (result.error?.code === 'ETIMEDOUT') {
        throw new Error(`packaged CLI ${label} smoke timed out after 15000ms`);
      }
      if (result.error) throw result.error;
      return { result, response: parseSingleJson(result.stdout || '') };
    };

    const missingRequest = path.join(smokeRoot, '__missing-ci-request__.json');
    const failure = execute(missingRequest, 'failure');
    if (failure.result.status !== 1) {
      throw new Error(`packaged CLI failure smoke expected exit 1, received ${failure.result.status}`);
    }
    if (failure.response.ok !== false || failure.response.error?.code !== 'E_REQUEST_INVALID') {
      throw new Error(`packaged CLI returned an unexpected failure contract: ${failure.result.stdout}`);
    }

    const success = execute(successRequest, 'success');
    if (success.result.status !== 0) {
      throw new Error(`packaged CLI success smoke expected exit 0, received ${success.result.status}`);
    }
    if (success.response.ok !== true || success.response.format !== 'rpgmv'
      || success.response.validation?.entriesChecked !== 1
      || success.response.validation?.validEntries !== 1
      || success.response.validation?.invalidEntries !== 0) {
      throw new Error(`packaged CLI returned an unexpected success contract: ${success.result.stdout}`);
    }
    outcome = {
      skipped: false,
      success: { exitCode: success.result.status, entriesChecked: success.response.validation.entriesChecked },
      failure: { exitCode: failure.result.status, errorCode: failure.response.error.code },
    };
  } catch (error) {
    operationError = error;
  }

  let cleanupError;
  try {
    fs.rmSync(smokeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    if (fs.existsSync(smokeRoot)) cleanupError = new Error(`packaged smoke root remains: ${smokeRoot}`);
  } catch (error) {
    cleanupError = error;
  }
  if (operationError) {
    if (cleanupError) operationError.message += `; cleanup also failed: ${cleanupError.message}`;
    throw operationError;
  }
  if (cleanupError) throw cleanupError;
  return outcome;
}

function verifyPackage() {
  const sourcePackage = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  const artifactName = `tsukuru-agent-${sourcePackage.version}-win.zip`;
  const artifactPath = path.join(appRoot, 'dist-cli', artifactName);
  const asarPath = path.join(appRoot, 'dist-cli', 'win-unpacked', 'resources', 'app.asar');
  const executablePath = path.join(appRoot, 'dist-cli', 'win-unpacked', 'tsukuru-agent.exe');
  for (const requiredPath of [artifactPath, asarPath, executablePath]) {
    if (!fs.existsSync(requiredPath)) throw new Error(`missing packaged artifact: ${requiredPath}`);
  }
  const entries = asar.listPackage(asarPath).map(normalizeEntry);
  const packageJson = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'));
  const issues = collectPackageIssues({ packageJson, entries, artifactName, expectedVersion: sourcePackage.version });
  if (issues.length > 0) throw new Error(issues.join('\n'));
  const deterministicZip = inspectDeterministicZip(artifactPath);
  const smoke = runPackagedSmoke(executablePath);
  return { artifactName, entries: entries.length, deterministicZip, smoke };
}

if (require.main === module) {
  try {
    const result = verifyPackage();
    const smoke = result.smoke.skipped
      ? 'skipped-non-windows'
      : `ok/exit${result.smoke.success.exitCode},${result.smoke.failure.errorCode}/exit${result.smoke.failure.exitCode}`;
    process.stdout.write(`package verification OK: ${result.artifactName}, ${result.entries} entries, smoke=${smoke}\n`);
  } catch (error) {
    process.stderr.write(`package verification failed:\n${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { REQUIRED_ENTRIES, collectPackageIssues, normalizeEntry, runPackagedSmoke, verifyPackage };
