const fs = require('node:fs');
const path = require('node:path');

const PROJECT_REPOSITORY = 'https://github.com/Chiriri722/Tsukuru-Agent.git';
const PROJECT_HOMEPAGE = 'https://github.com/Chiriri722/Tsukuru-Agent#readme';
const PROJECT_ISSUES = 'https://github.com/Chiriri722/Tsukuru-Agent/issues';
const UPDATE_MANIFEST_PATH = 'Chiriri722/Tsukuru-Agent/main/tsukuru-agent/version.json';

function readVersionSurfaces(appRoot = path.resolve(__dirname, '..')) {
  return {
    packageJson: JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')),
    versionJson: JSON.parse(fs.readFileSync(path.join(appRoot, 'version.json'), 'utf8')),
    releaseNotes: fs.readFileSync(path.join(appRoot, '..', 'v2.5-release-notes.md'), 'utf8'),
    changelog: fs.readFileSync(path.join(appRoot, '..', 'CHANGELOG.md'), 'utf8'),
    cliBuilder: fs.readFileSync(path.join(appRoot, 'electron-builder.cli.yml'), 'utf8'),
    mainSource: fs.readFileSync(path.join(appRoot, 'main.ts'), 'utf8'),
    updatePolicySource: fs.readFileSync(path.join(appRoot, 'src', 'electron', 'updatePolicy.ts'), 'utf8'),
    guiHtml: fs.readFileSync(path.join(appRoot, 'src', 'html', 'simple', 'index.html'), 'utf8'),
  };
}

function collectVersionIssues(surfaces) {
  const issues = [];
  const pkg = surfaces.packageJson;
  const expectedReleaseTitle = `# Tsukuru Agent v${pkg.version} compatibility update`;
  const normalizedChangelog = surfaces.changelog.replace(/\r\n?/g, '\n');

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) {
    issues.push(`package.json version is not valid SemVer: ${pkg.version}`);
  }
  if (surfaces.versionJson.version !== pkg.version || surfaces.versionJson.type !== 'json') {
    issues.push(`version.json must mirror package.json version ${pkg.version}`);
  }
  if (!surfaces.releaseNotes.startsWith(expectedReleaseTitle)) {
    issues.push(`release notes must start with: ${expectedReleaseTitle}`);
  }
  if (!normalizedChangelog.includes(`<!-- current-version:start -->\n## [${pkg.version}] - Unreleased\n<!-- current-version:end -->`)) {
    issues.push(`CHANGELOG.md current version must mirror package.json version ${pkg.version}`);
  }
  if (!/^artifactName: tsukuru-agent-\$\{version\}-\$\{os\}\.\$\{ext\}$/m.test(surfaces.cliBuilder)) {
    issues.push('CLI artifactName must derive from electron-builder version variables');
  }
  if (pkg.name !== 'tsukuru-agent') issues.push('package name must be tsukuru-agent');
  if (pkg.repository?.url !== PROJECT_REPOSITORY) issues.push('package repository points outside the current project');
  if (pkg.homepage !== PROJECT_HOMEPAGE) issues.push('package homepage points outside the current project');
  if (pkg.bugs?.url !== PROJECT_ISSUES) issues.push('package bugs URL points outside the current project');
  if (pkg.build?.productName !== 'Tsukuru Agent') issues.push('GUI productName must be Tsukuru Agent');
  if (!pkg.build?.protocols?.schemes?.includes('MVExtractor')) issues.push('legacy MVExtractor protocol alias is missing');
  if (!pkg.build?.protocols?.schemes?.includes('tsukuru-agent')) issues.push('tsukuru-agent protocol is missing');
  if (!surfaces.updatePolicySource.includes(UPDATE_MANIFEST_PATH)) issues.push('GUI update manifest points outside the current project');
  if (!surfaces.mainSource.includes(PROJECT_ISSUES)) issues.push('GUI support URL points outside the current project');
  if (!surfaces.guiHtml.includes('<title>Tsukuru Agent</title>')) issues.push('GUI title must be Tsukuru Agent');

  return issues;
}

function checkVersion(appRoot) {
  const surfaces = readVersionSurfaces(appRoot);
  const issues = collectVersionIssues(surfaces);
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => `- ${issue}`).join('\n'));
  }
  return surfaces.packageJson;
}

if (require.main === module) {
  try {
    const pkg = checkVersion();
    process.stdout.write(`version identity OK: ${pkg.name}@${pkg.version}\n`);
  } catch (error) {
    process.stderr.write(`version identity check failed:\n${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { checkVersion, collectVersionIssues, readVersionSurfaces };
