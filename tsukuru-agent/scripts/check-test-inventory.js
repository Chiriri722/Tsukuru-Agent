const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appRoot, '..');

function collectInventory() {
  const testRoot = path.join(appRoot, 'test');
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.name.endsWith('.test.js')) {
        files.push(path.relative(appRoot, fullPath).split(path.sep).join('/'));
      }
    }
  };
  visit(testRoot);
  files.sort();
  let tests = 0;
  for (const file of files) {
    const source = fs.readFileSync(path.join(appRoot, file), 'utf8');
    tests += (source.match(/^\s*test\s*\(/gm) || []).length;
  }
  return { files, tests };
}

function collectInventoryIssues(readme, inventory) {
  const issues = [];
  const documented = [...readme.matchAll(/^- `(?<file>test\/[^`]+\.test\.js)`/gm)]
    .map((match) => match.groups.file)
    .sort();
  const summary = readme.match(/`npm test`는 (?<files>\d+)개 테스트 파일에서 현재 (?<tests>\d+)개 검사를 실행합니다/);

  if (JSON.stringify(documented) !== JSON.stringify(inventory.files)) {
    issues.push(`README test files differ: documented=${documented.join(',')} actual=${inventory.files.join(',')}`);
  }
  if (!summary) {
    issues.push('README test inventory summary is missing');
  } else {
    if (Number(summary.groups.files) !== inventory.files.length) issues.push('README test file count is stale');
    if (Number(summary.groups.tests) !== inventory.tests) issues.push('README test count is stale');
  }
  return issues;
}

function checkTestInventory() {
  const inventory = collectInventory();
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const issues = collectInventoryIssues(readme, inventory);
  if (issues.length > 0) throw new Error(issues.join('\n'));
  return inventory;
}

if (require.main === module) {
  try {
    const inventory = checkTestInventory();
    process.stdout.write(`test inventory OK: ${inventory.files.length} files, ${inventory.tests} tests\n`);
  } catch (error) {
    process.stderr.write(`test inventory check failed:\n${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { checkTestInventory, collectInventory, collectInventoryIssues };
