const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const appRoot = path.resolve(__dirname, '..');
const cliPath = path.join(appRoot, '.build', 'app', 'src', 'cli', 'main.js');
const diagnosticsPath = path.join(appRoot, '.build', 'app', 'src', 'core', 'diagnostics.js');

function parseArgs(argv, environment = process.env) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--catalog') options.catalog = argv[++index];
    else if (argv[index].startsWith('--catalog=')) options.catalog = argv[index].slice('--catalog='.length);
    else if (argv[index] === '--output') options.output = argv[++index];
    else if (argv[index].startsWith('--output=')) options.output = argv[index].slice('--output='.length);
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  if (!options.catalog) options.catalog = environment.TSUKURU_CORPUS_CATALOG;
  if (!options.output) options.output = environment.TSUKURU_CORPUS_OUTPUT;
  if (!options.catalog) throw new Error('--catalog or TSUKURU_CORPUS_CATALOG is required');
  if (!options.output) options.output = path.resolve('compatibility-corpus-results.json');
  return options;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256Source(sourcePath) {
  const stat = fs.lstatSync(sourcePath);
  if (stat.isSymbolicLink()) throw new Error('corpus source cannot be a symbolic link');
  if (stat.isFile()) return sha256File(sourcePath);
  if (!stat.isDirectory()) throw new Error('corpus source must be a file or directory');
  const records = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`corpus source contains a symbolic link: ${entry.name}`);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) {
        const relative = path.relative(sourcePath, fullPath).split(path.sep).join('/');
        records.push(`${relative}\0${sha256File(fullPath)}`);
      }
    }
  };
  visit(sourcePath);
  return crypto.createHash('sha256').update(records.join('\n')).digest('hex');
}

function validateCatalog(raw) {
  if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.entries)) {
    throw new Error('private corpus catalog must contain schemaVersion=1 and entries[]');
  }
  const ids = new Set();
  for (const [index, entry] of raw.entries.entries()) {
    if (!entry || typeof entry !== 'object') throw new Error(`entries[${index}] must be an object`);
    for (const field of ['id', 'path', 'engine', 'wrapper']) {
      if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
        throw new Error(`entries[${index}].${field} must be a non-empty string`);
      }
    }
    if (ids.has(entry.id)) throw new Error(`duplicate corpus id: ${entry.id}`);
    ids.add(entry.id);
    if (entry.playtest && !['passed', 'failed', 'not-run'].includes(entry.playtest.status)) {
      throw new Error(`entries[${index}].playtest.status is invalid`);
    }
  }
  return raw.entries;
}

function summarizeWarnings(warnings) {
  const counts = new Map();
  for (const warning of warnings) {
    const text = String(warning);
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts].map(([warning, count]) => count === 1 ? warning : `${warning} (×${count})`);
}

function redactPublicRecord(record, sourcePath) {
  const { redactSensitiveValue } = require(diagnosticsPath);
  return redactSensitiveValue(record, [{ path: sourcePath, label: 'source' }]);
}

function verifySource(entry) {
  const sourcePath = path.resolve(entry.path);
  const sourceSha256 = sha256Source(sourcePath);
  const request = {
    schemaVersion: 2,
    operation: 'verify',
    format: 'auto',
    projectPath: sourcePath,
    profile: 'full',
    options: { verifyDepth: 'deep' },
    patches: [],
  };
  const child = spawnSync(process.execPath, [cliPath, 'run', '--request', '-'], {
    cwd: appRoot,
    input: JSON.stringify(request),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.error) throw child.error;
  const result = JSON.parse(child.stdout);
  return redactPublicRecord({
    id: entry.id,
    engine: result.engine?.type ?? entry.engine,
    wrapper: result.engine?.wrapper ?? entry.wrapper,
    sourceSha256,
    structural: {
      status: result.ok && child.status === 0 ? 'passed' : 'failed',
      format: result.format,
      score: result.scores?.total ?? null,
      risk: result.scores?.risk ?? null,
      errorCode: result.error?.code ?? null,
      warnings: summarizeWarnings(result.warnings ?? []),
    },
    playtest: entry.playtest ?? { status: 'not-run', notes: '' },
  }, sourcePath);
}

function runCorpus(catalogPath, outputPath) {
  if (!fs.existsSync(cliPath)) throw new Error('compiled CLI is missing; run npm run compile:cli first');
  const catalog = JSON.parse(fs.readFileSync(path.resolve(catalogPath), 'utf8'));
  const entries = validateCatalog(catalog);
  const records = [];
  let failed = 0;
  for (const entry of entries) {
    try {
      const record = verifySource(entry);
      records.push(record);
      if (record.structural.status !== 'passed') failed++;
    } catch (error) {
      failed++;
      records.push(redactPublicRecord({
        id: entry.id,
        engine: entry.engine,
        wrapper: entry.wrapper,
        sourceSha256: '0'.repeat(64),
        structural: { status: 'failed', format: null, score: null, risk: null, errorCode: 'CORPUS_RUN_FAILED', warnings: [error.message] },
        playtest: entry.playtest ?? { status: 'not-run', notes: '' },
      }, path.resolve(entry.path)));
    }
  }
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), records };
  fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { total: records.length, failed };
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const summary = runCorpus(options.catalog, options.output);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    process.exitCode = summary.failed === 0 ? 0 : 1;
  } catch (error) {
    process.stderr.write(`compatibility corpus failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  redactPublicRecord,
  runCorpus,
  sha256Source,
  summarizeWarnings,
  validateCatalog,
  verifySource,
};
