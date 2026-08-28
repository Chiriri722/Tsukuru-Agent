const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { buildNotices } = require('./generate-notices');

const ROOT = path.join(__dirname, '..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const sha256 = (relative) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative))).digest('hex');

function fail(message) {
  throw new Error(message);
}

function sortedEntries(value = {}) {
  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
}

function checkDependencies() {
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');
  const inventory = readJson('docs/supply-chain/dependencies.json');
  const names = Object.keys(pkg.dependencies ?? {}).sort();
  const inventoried = inventory.direct.map((entry) => entry.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(inventoried)) fail('Direct dependency inventory differs from package.json');
  if (JSON.stringify(sortedEntries(lock.packages[''].dependencies)) !== JSON.stringify(sortedEntries(pkg.dependencies))) fail('Lockfile runtime root differs from package.json');
  if (JSON.stringify(sortedEntries(lock.packages[''].devDependencies)) !== JSON.stringify(sortedEntries(pkg.devDependencies))) fail('Lockfile dev root differs from package.json');
  for (const name of names) if (name.startsWith('@types/')) fail(`Type-only package is in runtime dependencies: ${name}`);
  for (const entry of inventory.direct) {
    const locked = lock.packages[`node_modules/${entry.name}`];
    if (locked?.version !== entry.version) fail(`Locked version drift: ${entry.name}`);
    if (!['cli-core', 'gui', 'shared'].includes(entry.scope)) fail(`Invalid dependency scope: ${entry.name}`);
    if (!Array.isArray(entry.usedBy) || entry.usedBy.length < 1) fail(`Missing call sites: ${entry.name}`);
    for (const callSite of entry.usedBy) {
      const target = path.join(ROOT, callSite);
      if (!fs.existsSync(target)) fail(`Dependency call site missing: ${entry.name} -> ${callSite}`);
      const source = fs.readFileSync(target, 'utf8');
      if (!source.includes(entry.name)) fail(`Dependency call site no longer imports ${entry.name}: ${callSite}`);
    }
  }
}

function checkExternalBinaries() {
  const inventory = readJson('src/core/supplyChain/external-binaries.json');
  const ids = new Set();
  for (const entry of inventory.entries) {
    if (ids.has(entry.id)) fail(`Duplicate external binary id: ${entry.id}`);
    ids.add(entry.id);
    if (!/^https:\/\//.test(entry.origin) || !entry.license || !entry.version) fail(`Incomplete provenance: ${entry.id}`);
    for (const callSite of entry.callSites ?? []) {
      if (!fs.existsSync(path.join(ROOT, callSite))) fail(`External binary call site missing: ${entry.id} -> ${callSite}`);
    }
    if (entry.distribution === 'gui-bundled') {
      const stat = fs.statSync(path.join(ROOT, entry.relativePath));
      if (stat.size !== entry.size || sha256(entry.relativePath) !== entry.sha256) fail(`External binary drift: ${entry.id}`);
      if (entry.cliIncluded !== false) fail(`GUI binary marked for CLI inclusion: ${entry.id}`);
    }
  }
}

function checkVendoredAssets() {
  const inventory = readJson('docs/supply-chain/vendored-assets.json');
  for (const entry of inventory.entries) {
    if (!entry.origin || !entry.license || !fs.existsSync(path.join(ROOT, entry.licenseText))) fail(`Incomplete vendored asset provenance: ${entry.path}`);
    if (sha256(entry.path) !== entry.sha256) fail(`Vendored asset drift: ${entry.path}`);
  }
}

function checkAuditExceptions() {
  const policy = readJson('docs/supply-chain/audit-exceptions.json');
  const now = Date.now();
  for (const exception of policy.exceptions) {
    for (const field of ['advisory', 'package', 'rationale', 'owner', 'issue', 'expires']) {
      if (typeof exception[field] !== 'string' || exception[field].length < 1) fail(`Audit exception is missing ${field}`);
    }
    const expires = Date.parse(exception.expires);
    if (!Number.isFinite(expires) || expires <= now) fail(`Audit exception expired: ${exception.advisory}`);
    if (expires > now + 90 * 24 * 60 * 60 * 1000) fail(`Audit exception exceeds 90 days: ${exception.advisory}`);
  }
}

function main() {
  checkDependencies();
  checkExternalBinaries();
  checkVendoredAssets();
  checkAuditExceptions();
  const actualNotice = fs.readFileSync(path.join(ROOT, 'THIRD-PARTY-NOTICES'), 'utf8').replace(/\r\n/g, '\n');
  if (actualNotice !== buildNotices()) fail('THIRD-PARTY-NOTICES drift');
  process.stdout.write('supply-chain inventory OK: dependencies, binaries, assets, notices, exceptions\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
