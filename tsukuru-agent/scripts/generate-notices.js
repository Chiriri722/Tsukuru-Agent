const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LICENSE_NAMES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'COPYING', 'COPYING.md'];

function normalize(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
}

function findLicenseFile(directory) {
  const names = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'));
  for (const candidate of LICENSE_NAMES) {
    const exact = names.find((name) => name === candidate);
    if (exact) return path.join(directory, exact);
    const caseInsensitive = names.find((name) => name.toLowerCase() === candidate.toLowerCase());
    if (caseInsensitive) return path.join(directory, caseInsensitive);
  }
  return null;
}

function packageLicense(name) {
  const directory = path.join(ROOT, 'node_modules', ...name.split('/'));
  const target = findLicenseFile(directory);
  if (target) return normalize(fs.readFileSync(target, 'utf8'));
  throw new Error(`LICENSE file not found for direct runtime dependency: ${name}`);
}

function buildNotices() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const names = Object.keys(pkg.dependencies ?? {}).sort();
  const sections = names.map((name) => {
    const locked = lock.packages[`node_modules/${name}`];
    if (!locked?.version) throw new Error(`Lockfile resolution missing for ${name}`);
    return `${'='.repeat(70)}\n${name}@${locked.version}\n${'-'.repeat(70)}\n${packageLicense(name)}`;
  });
  const header = `THIRD-PARTY-NOTICES
===================

Tsukuru Agent includes the exact direct runtime dependency versions resolved by
package-lock.json. This file is generated deterministically by
scripts/generate-notices.js; external binaries and vendored assets are tracked
separately under docs/supply-chain and src/core/supplyChain.`;
  return `${header}\n\n${sections.join('\n\n')}\n`;
}

function run(argv = process.argv.slice(2)) {
  const target = path.join(ROOT, 'THIRD-PARTY-NOTICES');
  const expected = buildNotices();
  if (argv.includes('--check')) {
    const actual = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : '';
    if (actual !== expected) {
      process.stderr.write('THIRD-PARTY-NOTICES drift detected; run npm run generate:notices\n');
      return 1;
    }
    process.stdout.write(`THIRD-PARTY-NOTICES OK: ${Object.keys(require('../package.json').dependencies).length} direct runtime packages\n`);
    return 0;
  }
  fs.writeFileSync(target, expected, 'utf8');
  process.stdout.write(`THIRD-PARTY-NOTICES written: ${Object.keys(require('../package.json').dependencies).length} direct runtime packages\n`);
  return 0;
}

if (require.main === module) process.exitCode = run();

module.exports = { buildNotices, findLicenseFile, packageLicense, run };
