const fs = require('node:fs');
const path = require('node:path');

function syncVersion(appRoot = path.resolve(__dirname, '..')) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  const versionJsonPath = path.join(appRoot, 'version.json');
  const releaseNotesPath = path.join(appRoot, '..', 'v2.5-release-notes.md');
  const changelogPath = path.join(appRoot, '..', 'CHANGELOG.md');
  const releaseNotes = fs.readFileSync(releaseNotesPath, 'utf8');
  const changelog = fs.readFileSync(changelogPath, 'utf8');

  fs.writeFileSync(
    versionJsonPath,
    `${JSON.stringify({ version: packageJson.version, type: 'json' })}\n`,
    'utf8',
  );
  fs.writeFileSync(
    releaseNotesPath,
    releaseNotes.replace(/^# .*$/m, `# Tsukuru Agent v${packageJson.version} compatibility update`),
    'utf8',
  );
  fs.writeFileSync(
    changelogPath,
    changelog.replace(
      /<!-- current-version:start -->[\s\S]*?<!-- current-version:end -->/,
      `<!-- current-version:start -->\n## [${packageJson.version}] - Unreleased\n<!-- current-version:end -->`,
    ),
    'utf8',
  );

  return packageJson.version;
}

if (require.main === module) {
  const version = syncVersion();
  process.stdout.write(`version surfaces synced: ${version}\n`);
}

module.exports = { syncVersion };
