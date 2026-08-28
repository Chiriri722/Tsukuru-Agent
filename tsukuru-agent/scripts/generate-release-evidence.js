const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const sha256 = (target) => crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');

function parseArgs(argv) {
  const outputIndex = argv.indexOf('--output-dir');
  if (outputIndex < 0 || !argv[outputIndex + 1]) throw new Error('Usage: generate-release-evidence --output-dir <dir> <artifact...>');
  const outputDir = path.resolve(ROOT, argv[outputIndex + 1]);
  const allowDirty = argv.includes('--allow-dirty') || argv.includes('allow-dirty');
  const artifacts = argv
    .filter((value, index) => index !== outputIndex && index !== outputIndex + 1
      && value !== '--allow-dirty' && value !== 'allow-dirty')
    .map((value) => path.resolve(ROOT, value));
  if (artifacts.length < 1) throw new Error('At least one release artifact is required');
  return { outputDir, artifacts, allowDirty };
}

function runGit(args, failureMessage) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', shell: false, windowsHide: true });
  if (result.status !== 0) throw new Error(failureMessage);
  return result.stdout.trim();
}

function gitSource(allowDirty) {
  const commit = runGit(['rev-parse', 'HEAD'], 'Unable to resolve source commit');
  const commitDate = runGit(['show', '-s', '--format=%cI', 'HEAD'], 'Unable to resolve source commit date');
  const dirty = runGit(['status', '--porcelain=v1', '--untracked-files=all'], 'Unable to inspect source tree').length > 0;
  if (dirty && !allowDirty) {
    throw new Error('Release evidence requires a clean source tree (append allow-dirty for non-release testing only)');
  }
  return { commit, commitDate, dirty };
}

function main(argv = process.argv.slice(2)) {
  const { outputDir, artifacts, allowDirty } = parseArgs(argv);
  for (const artifact of artifacts) if (!fs.statSync(artifact).isFile()) throw new Error(`Artifact is not a file: ${artifact}`);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const source = gitSource(allowDirty);
  const files = artifacts.map((target) => ({ name: path.basename(target), bytes: fs.statSync(target).size, sha256: sha256(target) }))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(files.map((file) => file.name)).size !== files.length) throw new Error('Artifact basenames must be unique');
  const manifest = {
    schemaVersion: 1,
    product: pkg.name,
    version: pkg.version,
    sourceCommit: source.commit,
    sourceCommitDate: source.commitDate,
    sourceTreeDirty: source.dirty,
    buildEnvironment: { platform: process.platform, arch: process.arch, node: process.version, npmRange: pkg.engines.npm },
    files,
  };
  const runtimePackages = Object.entries(lock.packages)
    .filter(([location, value]) => location.startsWith('node_modules/') && value.dev !== true && value.version)
    .map(([location, value]) => ({
      name: location.slice('node_modules/'.length),
      version: value.version,
      license: value.license || 'NOASSERTION',
      resolved: typeof value.resolved === 'string' && /^https:\/\//.test(value.resolved) ? value.resolved : 'NOASSERTION',
    }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
  const dependencyPackages = runtimePackages.map((entry, index) => ({
    SPDXID: `SPDXRef-Package-${index + 1}`,
    name: entry.name,
    versionInfo: entry.version,
    downloadLocation: entry.resolved,
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: entry.license,
  }));
  const artifactSetHash = crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex');
  const sbom = {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `${pkg.name}-${pkg.version}`,
    documentNamespace: `https://github.com/Chiriri722/Tsukuru-Agent/sbom/${manifest.sourceCommit}/${artifactSetHash}`,
    creationInfo: { created: source.commitDate, creators: ['Tool: Tsukuru-Agent-generate-release-evidence'] },
    documentDescribes: ['SPDXRef-RootPackage'],
    packages: [{
      SPDXID: 'SPDXRef-RootPackage',
      name: pkg.name,
      versionInfo: pkg.version,
      downloadLocation: pkg.repository?.url ?? 'NOASSERTION',
      filesAnalyzed: false,
      licenseConcluded: pkg.license,
      licenseDeclared: pkg.license,
    }, ...dependencyPackages],
    relationships: dependencyPackages.map((entry) => ({
      spdxElementId: 'SPDXRef-RootPackage',
      relationshipType: 'DEPENDS_ON',
      relatedSpdxElement: entry.SPDXID,
    })),
  };
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'SHA256SUMS'), files.map((file) => `${file.sha256}  ${file.name}`).join('\n') + '\n');
  fs.writeFileSync(path.join(outputDir, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(outputDir, 'sbom.spdx.json'), JSON.stringify(sbom, null, 2) + '\n');
  process.stdout.write(`release evidence written: ${files.length} artifacts, ${runtimePackages.length} runtime packages\n`);
}

try {
  if (require.main === module) main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}

module.exports = { main };
