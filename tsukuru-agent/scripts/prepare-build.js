const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const stageRoot = path.join(appRoot, '.build', 'app');
const buildConfig = path.join(appRoot, 'tsconfig.build.json');
const tscPath = require.resolve('typescript/bin/tsc');

function isGeneratedSourceJavaScript(filePath) {
  if (path.extname(filePath).toLowerCase() !== '.js') return false;
  return fs.existsSync(filePath.slice(0, -3) + '.ts');
}

function shouldCopyStaticFile(filePath) {
  if (/\.(?:ts|tsx|scss|map)$/i.test(filePath)) return false;
  return !isGeneratedSourceJavaScript(filePath);
}

function copyStaticTree(sourceRoot, targetRoot) {
  if (!fs.existsSync(sourceRoot)) return;
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const targetPath = path.join(targetRoot, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`staging input must not be a symbolic link: ${sourcePath}`);
    }
    if (entry.isDirectory()) {
      copyStaticTree(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile() || !shouldCopyStaticFile(sourcePath)) continue;
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function writeStagedPackage(target) {
  const source = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  const main = target === 'cli' ? 'src/cli/electronMain.js' : 'main.js';
  const staged = { ...source, main };
  delete staged.build;
  fs.writeFileSync(path.join(stageRoot, 'package.json'), JSON.stringify(staged, null, 2) + '\n');
}

function prepareBuild(target) {
  if (!['gui', 'cli'].includes(target)) {
    throw new Error(`unsupported build target: ${target}`);
  }
  fs.rmSync(stageRoot, { recursive: true, force: true });
  fs.mkdirSync(stageRoot, { recursive: true });
  childProcess.execFileSync(process.execPath, [tscPath, '-p', buildConfig], {
    cwd: appRoot,
    stdio: 'inherit',
  });

  copyStaticTree(path.join(appRoot, 'src'), path.join(stageRoot, 'src'));
  copyStaticTree(path.join(appRoot, 'res'), path.join(stageRoot, 'res'));
  for (const name of ['LICENSE', 'NOTICE.md', 'THIRD-PARTY-NOTICES', 'version.json']) {
    fs.copyFileSync(path.join(appRoot, name), path.join(stageRoot, name));
  }
  writeStagedPackage(target);
}

prepareBuild(process.argv[2] || 'gui');
