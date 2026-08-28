const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const AdmZip = require('adm-zip');
const asar = require('@electron/asar');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(ROOT, 'docs', 'performance', 'baseline.json');
const CASE_IDS = ['rpgmv', 'wolf', 'tyrano', 'gdevelop', 'asar', 'nwjs'];
const PROFILES = {
  smoke: { rpgMaps: 3, rpgCommands: 5, wolfEntries: 10, tyranoFiles: 3, tyranoLines: 20, gdevelopEntries: 20, archiveFiles: 20, archiveBytes: 256 },
  ci: { rpgMaps: 40, rpgCommands: 30, wolfEntries: 300, tyranoFiles: 40, tyranoLines: 100, gdevelopEntries: 1000, archiveFiles: 800, archiveBytes: 1024 },
  baseline: { rpgMaps: 80, rpgCommands: 60, wolfEntries: 600, tyranoFiles: 80, tyranoLines: 200, gdevelopEntries: 2000, archiveFiles: 1600, archiveBytes: 2048 },
};

function parseArgs(argv) {
  const profileIndex = argv.indexOf('--profile');
  const workerIndex = argv.indexOf('--worker');
  const profile = profileIndex >= 0 ? argv[profileIndex + 1] : 'smoke';
  if (!PROFILES[profile]) throw new Error(`Unknown benchmark profile: ${profile}`);
  return {
    profile,
    worker: workerIndex >= 0 ? argv[workerIndex + 1] : null,
    check: argv.includes('--check'),
  };
}

function writeJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value));
}

function directoryMetrics(root) {
  let files = 0;
  let totalBytes = 0;
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) {
        files++;
        totalBytes += fs.statSync(child).size;
      }
    }
  };
  visit(root);
  return { files, totalBytes };
}

async function timed(stages, name, action) {
  const started = performance.now();
  const value = await action();
  stages[name] += performance.now() - started;
  return value;
}

function compiled(relative) {
  return require(path.join(ROOT, '.build', 'app', ...relative.split('/')));
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function createRpgFixture(root, config) {
  const data = path.join(root, 'data');
  fs.mkdirSync(data, { recursive: true });
  const mapInfos = [null];
  for (let mapId = 1; mapId <= config.rpgMaps; mapId++) {
    mapInfos.push({ id: mapId, name: `Map ${mapId}` });
    const list = [];
    for (let index = 0; index < config.rpgCommands; index++) {
      list.push({ code: 401, indent: 0, parameters: [`Benchmark text ${mapId}-${index}`] });
    }
    writeJson(path.join(data, `Map${String(mapId).padStart(3, '0')}.json`), {
      displayName: `Map ${mapId}`,
      events: [null, { id: 1, pages: [{ list }] }],
    });
  }
  writeJson(path.join(data, 'MapInfos.json'), mapInfos);
  writeJson(path.join(data, 'System.json'), { startMapId: 1 });
  for (const name of ['Actors', 'Classes', 'Skills', 'Enemies', 'Troops', 'CommonEvents']) {
    writeJson(path.join(data, `${name}.json`), [null]);
  }
  return { sourceRoot: data, textEntries: config.rpgMaps * config.rpgCommands };
}

function createWolfFixture(root, config) {
  const data = path.join(root, 'data');
  fs.mkdirSync(data, { recursive: true });
  const chunks = [];
  const entries = [];
  let offset = 0;
  for (let index = 0; index < config.wolfEntries; index++) {
    const text = `Wolf benchmark text ${index}`;
    const payload = Buffer.concat([Buffer.from(text, 'utf8'), Buffer.from([0])]);
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32LE(payload.length, 0);
    chunks.push(prefix, payload);
    entries.push({
      id: `map.mps#${index}`,
      sourceFile: 'map.mps',
      hash: sha256Text(text),
      encoding: 'utf8',
      nullTerminated: true,
      wolf: { pos1: offset, pos2: offset + 4, pos3: offset + 4 + payload.length, len: payload.length },
    });
    offset += 4 + payload.length;
  }
  fs.writeFileSync(path.join(data, 'map.mps'), Buffer.concat(chunks));
  return { sourceRoot: data, textEntries: entries.length, manifest: { entries } };
}

function createTyranoFixture(root, config) {
  const project = path.join(root, 'tyrano');
  fs.mkdirSync(project, { recursive: true });
  for (let fileIndex = 0; fileIndex < config.tyranoFiles; fileIndex++) {
    const lines = ['[if exp="true"]'];
    for (let line = 0; line < config.tyranoLines; line++) lines.push(`Tyrano benchmark ${fileIndex}-${line}`);
    lines.push('[endif]');
    fs.writeFileSync(path.join(project, `scene-${fileIndex}.ks`), `${lines.join('\n')}\n`);
  }
  return { sourceRoot: project, textEntries: config.tyranoFiles * config.tyranoLines };
}

function createGDevelopFixture(root, config) {
  const project = path.join(root, 'gdevelop');
  fs.mkdirSync(project, { recursive: true });
  const objects = [];
  for (let index = 0; index < config.gdevelopEntries; index++) {
    objects.push({ type: 'TextObject::Text', string: `GDevelop benchmark ${index}` });
  }
  fs.writeFileSync(path.join(project, 'data.js'), `gdjs.projectData = ${JSON.stringify({ layouts: [{ objects }] })};\n`);
  return { sourceRoot: project, textEntries: objects.length };
}

function createArchiveSource(root, config) {
  const source = path.join(root, 'archive-source');
  fs.mkdirSync(path.join(source, 'assets'), { recursive: true });
  writeJson(path.join(source, 'package.json'), { name: 'benchmark', main: 'index.html' });
  fs.writeFileSync(path.join(source, 'index.html'), '<!doctype html><title>benchmark</title>');
  const payload = Buffer.alloc(config.archiveBytes, 0x61);
  for (let index = 0; index < config.archiveFiles; index++) {
    fs.writeFileSync(path.join(source, 'assets', `file-${String(index).padStart(5, '0')}.txt`), payload);
  }
  return { sourceRoot: source, textEntries: config.archiveFiles };
}

async function runEngineCase(id, root, config, stages) {
  const { snapshotDirectory } = compiled('src/core/validator.js');
  if (id === 'rpgmv') {
    const fixture = await timed(stages, 'fixture', () => createRpgFixture(root, config));
    await timed(stages, 'parsing', () => compiled('src/core/validation/engines/rpg.js').inspectRpgProject(fixture.sourceRoot, { entries: [] }));
    await timed(stages, 'hashing', () => snapshotDirectory(fixture.sourceRoot));
    return fixture;
  }
  if (id === 'wolf') {
    const fixture = await timed(stages, 'fixture', () => createWolfFixture(root, config));
    await timed(stages, 'parsing', () => compiled('src/core/validation/engines/wolf.js').inspectWolfBinaryMappings(fixture.sourceRoot, fixture.manifest));
    await timed(stages, 'hashing', () => snapshotDirectory(fixture.sourceRoot));
    return fixture;
  }
  if (id === 'tyrano') {
    const fixture = await timed(stages, 'fixture', () => createTyranoFixture(root, config));
    await timed(stages, 'parsing', () => compiled('src/core/validation/engines/tyrano.js').inspectTyranoProject(fixture.sourceRoot));
    await timed(stages, 'hashing', () => snapshotDirectory(fixture.sourceRoot));
    return fixture;
  }
  if (id === 'gdevelop') {
    const fixture = await timed(stages, 'fixture', () => createGDevelopFixture(root, config));
    const service = new (compiled('src/js/gdevelop/GDevelopService.js').GDevelopService)(undefined);
    const result = await timed(stages, 'parsing', () => service.extract({ projectRoot: fixture.sourceRoot, force: true }));
    fixture.textEntries = result.extractedEntries;
    await timed(stages, 'hashing', () => snapshotDirectory(fixture.sourceRoot));
    return fixture;
  }
  const fixture = await timed(stages, 'fixture', () => createArchiveSource(root, config));
  const archivePath = path.join(root, id === 'asar' ? 'app.asar' : 'package.nw');
  if (id === 'asar') {
    await timed(stages, 'packing', () => asar.createPackage(fixture.sourceRoot, archivePath));
  } else {
    await timed(stages, 'packing', () => {
      const zip = new AdmZip();
      zip.addLocalFolder(fixture.sourceRoot);
      zip.writeZip(archivePath);
    });
  }
  await timed(stages, 'parsing', () => compiled('src/core/container.js').inspectContainer(archivePath));
  await timed(stages, 'hashing', () => snapshotDirectory(fixture.sourceRoot));
  return fixture;
}

async function runWorker(id, profile) {
  if (!CASE_IDS.includes(id)) throw new Error(`Unknown benchmark case: ${id}`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `tsukuru-benchmark-${id}-`));
  const stages = { fixture: 0, hashing: 0, packing: 0, parsing: 0 };
  const started = performance.now();
  try {
    const fixture = await runEngineCase(id, root, PROFILES[profile], stages);
    const source = directoryMetrics(fixture.sourceRoot);
    const temp = directoryMetrics(root);
    const maxRss = Number(process.resourceUsage().maxRSS) * 1024;
    return {
      id,
      elapsedMs: Number((performance.now() - started).toFixed(3)),
      peakRssBytes: Math.max(process.memoryUsage().rss, maxRss),
      metrics: { files: source.files, totalBytes: source.totalBytes, textEntries: fixture.textEntries, tempBytes: temp.totalBytes },
      stageTimingsMs: Object.fromEntries(Object.entries(stages).map(([key, value]) => [key, Number(value.toFixed(3))])),
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function checkRegression(report) {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  if (baseline.profile !== report.profile) throw new Error(`Benchmark baseline profile mismatch: ${baseline.profile} != ${report.profile}`);
  const issues = [];
  for (const entry of report.cases) {
    const expected = baseline.cases[entry.id];
    if (!expected) issues.push(`missing baseline: ${entry.id}`);
    else {
      if (entry.elapsedMs > expected.maxElapsedMs) issues.push(`${entry.id} elapsed ${entry.elapsedMs} > ${expected.maxElapsedMs}`);
      if (entry.peakRssBytes > expected.maxPeakRssBytes) issues.push(`${entry.id} peak RSS ${entry.peakRssBytes} > ${expected.maxPeakRssBytes}`);
      if (entry.metrics.files !== expected.expectedFiles) issues.push(`${entry.id} files ${entry.metrics.files} != ${expected.expectedFiles}`);
      if (entry.metrics.totalBytes !== expected.expectedTotalBytes) issues.push(`${entry.id} bytes ${entry.metrics.totalBytes} != ${expected.expectedTotalBytes}`);
    }
  }
  if (issues.length > 0) throw new Error(`Benchmark regression:\n${issues.join('\n')}`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.worker) {
    process.stdout.write(`${JSON.stringify(await runWorker(args.worker, args.profile))}\n`);
    return;
  }
  const cases = CASE_IDS.map((id) => {
    const result = spawnSync(process.execPath, [__filename, '--worker', id, '--profile', args.profile], {
      cwd: ROOT,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(`Benchmark case failed: ${id}\n${result.stderr || result.stdout}`);
    return JSON.parse(result.stdout);
  });
  const report = {
    schemaVersion: 1,
    profile: args.profile,
    environment: { platform: process.platform, arch: process.arch, node: process.version },
    cases,
  };
  if (args.check) checkRegression(report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
