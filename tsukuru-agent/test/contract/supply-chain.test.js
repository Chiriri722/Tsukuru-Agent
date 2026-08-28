const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.dirname(appRoot);
const { findLicenseFile } = require('../../scripts/generate-notices.js');

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(appRoot, relative), 'utf8'));
}

function sha256(relative) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(appRoot, relative))).digest('hex');
}

test('runtime license discovery honors package filename casing on case-sensitive filesystems', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-license-case-'));
  try {
    const licensePath = path.join(root, 'license');
    fs.writeFileSync(licensePath, 'MIT\n');
    assert.equal(findLicenseFile(root), licensePath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime dependencies are used, type-only packages are dev-only, and deprecated clients are absent', () => {
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');
  const forbidden = [
    'aes-js', 'axios', 'bson', 'electron-log', 'glob', 'lodash', 'lz-string',
    'open', 'os-locale', 'request', 'sha3',
  ];
  for (const name of forbidden) assert.equal(pkg.dependencies[name], undefined, name);
  assert.equal(pkg.dependencies.acorn, '8.18.0');
  assert.equal(pkg.dependencies['adm-zip'], '^0.6.0');
  assert.equal(pkg.devDependencies.electron, '43.4.1');
  assert.equal(pkg.devDependencies['electron-builder'], '26.15.7');
  assert.equal(lock.packages['node_modules/electron'].version, '43.4.1');
  assert.equal(lock.packages['node_modules/electron-builder'].version, '26.15.7');
  assert.equal(pkg.devDependencies['@types/adm-zip'], undefined);
  for (const name of Object.keys(pkg.dependencies)) assert.equal(name.startsWith('@types/'), false, name);
  assert.equal(pkg.devDependencies['electron-packager'], undefined);
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies);

  const sourceFiles = [
    'main.ts',
    ...fs.readdirSync(path.join(appRoot, 'src'), { recursive: true })
      .filter((entry) => typeof entry === 'string' && entry.endsWith('.ts'))
      .map((entry) => path.join('src', entry)),
  ];
  const source = sourceFiles.map((file) => fs.readFileSync(path.join(appRoot, file), 'utf8')).join('\n');
  assert.doesNotMatch(source, /from\s+['"](?:axios|request)['"]|require\(['"](?:axios|request)['"]\)/);
});

test('dependency install scripts are explicitly classified and unused Squirrel hooks are denied', () => {
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');
  const installScriptPackages = Object.entries(lock.packages)
    .filter(([, entry]) => entry.hasInstallScript === true)
    .map(([relative, entry]) => `${relative.split('node_modules/').at(-1)}@${entry.version}`)
    .sort();

  assert.deepEqual(installScriptPackages, ['@parcel/watcher@2.6.0', 'electron-winstaller@5.4.0']);
  assert.deepEqual(pkg.allowScripts, { '@parcel/watcher': false, 'electron-winstaller': false });
});

test('machine-readable dependency, binary, and vendored-asset inventories match shipped files', () => {
  const dependencies = readJson('docs/supply-chain/dependencies.json');
  const binaries = readJson('src/core/supplyChain/external-binaries.json');
  const assets = readJson('docs/supply-chain/vendored-assets.json');
  const pkg = readJson('package.json');

  assert.deepEqual(dependencies.direct.map((entry) => entry.name).sort(), Object.keys(pkg.dependencies).sort());
  for (const entry of dependencies.direct) {
    assert.match(entry.version, /^\d+\.\d+\.\d+/);
    assert.match(entry.license, /\S/);
    assert.ok(Array.isArray(entry.usedBy) && entry.usedBy.length > 0, entry.name);
    assert.ok(['cli-core', 'gui', 'shared'].includes(entry.scope), entry.name);
  }

  const bundled = binaries.entries.filter((entry) => entry.distribution === 'gui-bundled');
  assert.equal(bundled.length, 3);
  for (const entry of bundled) {
    assert.equal(sha256(entry.relativePath), entry.sha256, entry.id);
    assert.match(entry.origin, /^https:\/\//);
    assert.match(entry.license, /\S/);
    assert.ok(entry.callSites.length > 0);
    assert.equal(entry.cliIncluded, false);
  }
  const wolfDec = binaries.entries.find((entry) => entry.id === 'wolfdec-v0.3');
  assert.equal(wolfDec.sha256, '847e1812c1150a0cd168400ea3625487707aceb6e625a7324e4dc1a80da0619c');
  assert.equal(wolfDec.size, 256000);
  assert.equal(wolfDec.distribution, 'on-demand-pinned');

  assert.ok(assets.entries.some((entry) => entry.path.endsWith('NotoSansKR.otf') && entry.license === 'OFL-1.1'));
  assert.ok(assets.entries.some((entry) => entry.path.endsWith('sweetalert2/main.js') && entry.license === 'MIT'));
});

test('supply-chain drift, notices, and release evidence are executable policy gates', () => {
  const pkg = readJson('package.json');
  for (const script of ['check:supply-chain', 'generate:notices', 'normalize:cli-zip', 'release:evidence']) {
    assert.equal(typeof pkg.scripts[script], 'string', script);
  }
  for (const relative of [
    'scripts/check-supply-chain.js',
    'scripts/generate-notices.js',
    'scripts/generate-release-evidence.js',
    'scripts/normalize-release-zip.js',
    'docs/supply-chain/audit-policy.md',
    'docs/supply-chain/binary-replacement.md',
    'docs/supply-chain/dependency-upgrades.md',
    'docs/supply-chain/electron-upgrade-status.md',
  ]) assert.ok(fs.existsSync(path.join(appRoot, relative)), relative);
  assert.ok(fs.existsSync(path.join(repoRoot, '.github', 'dependabot.yml')));

  const check = spawnSync(process.execPath, ['scripts/check-supply-chain.js'], {
    cwd: appRoot,
    encoding: 'utf8',
  });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(check.stdout, /supply-chain inventory OK/i);

  const cliConfig = fs.readFileSync(path.join(appRoot, 'electron-builder.cli.yml'), 'utf8');
  assert.doesNotMatch(cliConfig, /extraResources|exfiles/);
  const processSources = [
    fs.readFileSync(path.join(appRoot, 'src', 'core', 'processRegistry.ts'), 'utf8'),
    fs.readFileSync(path.join(appRoot, 'src', 'js', 'rpgmv', 'translator.ts'), 'utf8'),
    fs.readFileSync(path.join(appRoot, 'src', 'js', 'wolf', 'extract', 'decrypter.ts'), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(processSources, /import\s*\{[^}]*\bexec\b[^}]*\}\s*from\s*['"]child_process/);
  assert.doesNotMatch(processSources, /require\(['"]child_process['"]\)\.exec/);
  assert.match(processSources, /verifyExternalBinary/);
  assert.match(processSources, /shell:\s*false/);
  assert.match(processSources, /timeout/i);

  const electronStatus = fs.readFileSync(path.join(appRoot, 'docs', 'supply-chain', 'electron-upgrade-status.md'), 'utf8');
  assert.match(electronStatus, /Electron 43\.4\.1/);
  assert.match(electronStatus, /electron-builder 26\.15\.7/);
  assert.match(electronStatus, /Electron 43 rung/i);
  assert.match(electronStatus, /electron-builder 26 rung/i);
  assert.match(electronStatus, /dependency ladder and audit no longer block/i);
  assert.match(electronStatus, /release readiness still requires/i);
  assert.match(electronStatus, /npm audit/);
});

test('release evidence is deterministic and binds artifacts to source and an SPDX SBOM', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-release-evidence-'));
  try {
    const artifact = path.join(tempRoot, 'tsukuru-agent-test.zip');
    fs.writeFileSync(artifact, 'deterministic release artifact\n');
    const outputs = [path.join(tempRoot, 'first'), path.join(tempRoot, 'second')];
    for (const outputDir of outputs) {
      const result = spawnSync(process.execPath, [
        'scripts/generate-release-evidence.js', '--output-dir', outputDir, artifact, '--allow-dirty',
      ], { cwd: appRoot, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /release evidence written/i);
    }

    for (const name of ['SHA256SUMS', 'release-manifest.json', 'sbom.spdx.json']) {
      assert.equal(
        fs.readFileSync(path.join(outputs[0], name), 'utf8'),
        fs.readFileSync(path.join(outputs[1], name), 'utf8'),
        `${name} must be deterministic`,
      );
    }

    const expectedHash = crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
    const manifest = JSON.parse(fs.readFileSync(path.join(outputs[0], 'release-manifest.json'), 'utf8'));
    assert.match(manifest.sourceCommit, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
    assert.equal(typeof manifest.sourceTreeDirty, 'boolean');
    assert.deepEqual(manifest.files, [{
      name: path.basename(artifact),
      bytes: fs.statSync(artifact).size,
      sha256: expectedHash,
    }]);
    assert.equal(fs.readFileSync(path.join(outputs[0], 'SHA256SUMS'), 'utf8'), `${expectedHash}  ${path.basename(artifact)}\n`);

    const sbom = JSON.parse(fs.readFileSync(path.join(outputs[0], 'sbom.spdx.json'), 'utf8'));
    assert.equal(sbom.spdxVersion, 'SPDX-2.3');
    assert.deepEqual(sbom.documentDescribes, ['SPDXRef-RootPackage']);
    assert.ok(sbom.packages.length >= 16);
    assert.ok(sbom.packages.some((entry) => entry.SPDXID === 'SPDXRef-RootPackage'
      && entry.licenseDeclared === 'GPL-3.0-only'));
    assert.ok(sbom.packages.some((entry) => entry.name === '@electron/asar'));
    assert.ok(sbom.packages.every((entry) => typeof entry.licenseDeclared === 'string'));
    assert.ok(sbom.relationships.some((entry) => entry.spdxElementId === 'SPDXRef-RootPackage'
      && entry.relationshipType === 'DEPENDS_ON'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
