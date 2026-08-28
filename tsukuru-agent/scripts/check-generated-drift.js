const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');

function git(args) {
  return spawnSync('git', args, { cwd: appRoot, encoding: 'utf8', windowsHide: true });
}

function trackedFiles() {
  const result = git(['ls-files', '-z']);
  if (result.status !== 0) throw new Error(result.stderr || 'git ls-files failed');
  return new Set(result.stdout.split('\0').filter(Boolean).map((file) => file.replaceAll('\\', '/')));
}

function walk(directory, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolutePath, output);
    else if (entry.isFile()) output.push(absolutePath);
  }
  return output;
}

function relativePath(filePath) {
  return path.relative(appRoot, filePath).replaceAll('\\', '/');
}

function hasTypeScriptSibling(filePath) {
  return filePath.endsWith('.js') && fs.existsSync(filePath.slice(0, -3) + '.ts');
}

function collectGeneratedDriftIssues() {
  const tracked = trackedFiles();
  const sourceFiles = [
    ...walk(path.join(appRoot, 'src')),
    ...['main.js', 'main_update.js'].map((name) => path.join(appRoot, name)).filter(fs.existsSync),
  ].filter(hasTypeScriptSibling);
  const trackedGenerated = sourceFiles.map(relativePath).filter((file) => tracked.has(file)).sort();
  const untrackedGenerated = sourceFiles.map(relativePath).filter((file) => !tracked.has(file)).sort();
  const issues = [
    ...trackedGenerated.map((file) => `tracked TypeScript-sibling source artifact: ${file}`),
    ...untrackedGenerated.map((file) => `untracked TypeScript-sibling source artifact: ${file}`),
  ];

  return { issues, trackedGenerated };
}

function checkGeneratedDrift() {
  const result = collectGeneratedDriftIssues();
  if (result.issues.length > 0) throw new Error(result.issues.join('\n'));
  return result;
}

if (require.main === module) {
  try {
    const result = checkGeneratedDrift();
    process.stdout.write('generated artifact check OK: 0 TypeScript-sibling source artifacts\n');
  } catch (error) {
    process.stderr.write(`generated artifact check failed:\n${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { checkGeneratedDrift, collectGeneratedDriftIssues };
