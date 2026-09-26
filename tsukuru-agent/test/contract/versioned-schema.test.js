const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  validateRequest,
  validateResolvedRequest,
} = require('../../.build/app/src/core/schema.js');
const {
  contractSchemaRegistry,
  validateContract,
} = require('../../.build/app/src/core/contracts/schemaRegistry.js');
const { parseExtractManifest } = require('../../.build/app/src/core/contracts/manifestContract.js');
const { readContainerProvenance } = require('../../.build/app/src/core/container/provenance.js');
const { emptyResult } = require('../../.build/app/src/core/schema.js');
const { finalizeAgentResult } = require('../../.build/app/src/core/contracts/resultContract.js');
const { WarningCodes } = require('../../.build/app/src/core/types.js');
const { executeAgentRequest } = require('../../.build/app/src/cli/run.js');

const appRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.dirname(appRoot);

function request(overrides = {}) {
  return {
    schemaVersion: 2,
    operation: 'verify',
    projectPath: 'fixture',
    ...overrides,
  };
}

function rejectsInvalid(fn) {
  assert.throws(fn, (error) => error && error.code === 'E_REQUEST_INVALID');
}

test('publishes every versioned machine contract through one immutable registry', () => {
  assert.deepEqual(Object.keys(contractSchemaRegistry).sort(), [
    'container-provenance:1',
    'engine-options:2',
    'manifest:1',
    'manifest:2',
    'request:1',
    'request:2',
    'result:1',
    'result:2',
  ]);
  assert.ok(Object.isFrozen(contractSchemaRegistry));

  for (const [key, schema] of Object.entries(contractSchemaRegistry)) {
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(typeof schema.$id, 'string', key);
    assert.ok(schema.$id.endsWith('.schema.json'), key);
  }
});

test('translation quality is additive in v1/v2 and validates bounded diagnostics independently of structural success', () => {
  const quality = { mechanical: 'pass', language: 'needs-review', context: 'not-run', semantics: 'not-run',
    entriesChecked: 1, sourcePreserved: 0, issueCount: 1, omittedCount: 0,
    issues: [{ code: 'RPG_TRANSLATION_JAPANESE', severity: 'warning', file: 'Actors.json', entryId: 'Actors.json#1.name' }] };
  for (const version of [1, 2]) {
    const result = { ...emptyResult(version), translationQuality: quality };
    assert.equal(validateContract('result', version, result).ok, true);
    assert.equal(validateContract('result', version, { ...result, translationQuality: { ...quality, semantics: 'pass' } }).ok, false);
    assert.equal(validateContract('result', version, { ...result, translationQuality: { ...quality, unknown: true } }).ok, false);
    assert.equal(validateContract('result', version, { ...result, translationQuality: { ...quality, issues: Array(101).fill(quality.issues[0]) } }).ok, false);
  }
});

test('keeps v1 unknown options but rejects them in v2', () => {
  const legacy = validateRequest(request({ schemaVersion: 1, options: { legacyExtension: true } }));
  assert.equal(legacy.options.legacyExtension, true);

  rejectsInvalid(() => validateRequest(request({ options: { legacyExtension: true } })));
});

test('v2 discriminates options by operation and requested or detected format', () => {
  const verify = validateRequest(request({ options: { verifyDepth: 'deep', humanSummary: true } }));
  assert.equal(verify.options.verifyDepth, 'deep');

  rejectsInvalid(() => validateRequest(request({ operation: 'extract', options: { humanSummary: true } })));
  rejectsInvalid(() => validateRequest(request({ operation: 'recover', format: 'wolf' })));
  rejectsInvalid(() => validateRequest(request({ operation: 'extract', format: 'rpgmv', options: { extAll: true } })));

  const autoWolf = validateRequest(request({ operation: 'extract', options: { extAll: true } }));
  assert.equal(validateResolvedRequest(autoWolf, 'wolf'), autoWolf);
  rejectsInvalid(() => validateResolvedRequest(autoWolf, 'rpgmv'));

  const codeExtract = validateRequest(request({
    operation: 'extract',
    format: 'gdevelop-electron',
    options: { experimentalGdevelopCodeStrings: true },
  }));
  assert.equal(codeExtract.options.experimentalGdevelopCodeStrings, true);
  const codeApply = validateRequest(request({
    operation: 'apply',
    format: 'gdevelop-electron',
    options: { experimentalGdevelopCodeStrings: true },
  }));
  assert.equal(codeApply.options.experimentalGdevelopCodeStrings, true);
  for (const format of ['rpgmv', 'rpgmz', 'rpgmz-electron']) {
    const options = { containerSourcePath: 'game', experimentalMalformedAsarRepack: true };
    assert.equal(validateRequest(request({ operation: 'apply', format, options })).options.experimentalMalformedAsarRepack, true);
    const auto = validateRequest(request({ operation: 'apply', options }));
    assert.equal(validateResolvedRequest(auto, format), auto);
    rejectsInvalid(() => validateRequest(request({ operation: 'apply', format,
      options: { ...options, experimentalMalformedAsarRepack: 'true' } })));
    rejectsInvalid(() => validateResolvedRequest(auto, 'wolf'));
  }
  rejectsInvalid(() => validateRequest(request({
    operation: 'patch',
    options: { experimentalGdevelopCodeStrings: true },
    patches: [{ id: 'entry', expectedHash: '0'.repeat(64), text: 'translated' }],
  })));
});

test('v2 applies documented defaults and option dependencies before dispatch', () => {
  const normalized = validateRequest(request());
  assert.equal(normalized.format, 'auto');
  assert.equal(normalized.profile, 'standard');
  assert.deepEqual(normalized.options, {});
  assert.deepEqual(normalized.patches, []);

  const apply = validateRequest(request({
    operation: 'apply',
    format: 'rpgmz-electron',
    options: { containerSourcePath: 'game', launchProbe: true, launchTimeoutMs: 2500 },
  }));
  assert.equal(apply.options.launchTimeoutMs, 2500);
  rejectsInvalid(() => validateRequest(request({
    operation: 'apply',
    options: { launchTimeoutMs: 2500 },
  })));

  assert.equal(validateRequest(request({ options: { operationTimeoutMs: 5000 } })).options.operationTimeoutMs, 5000);
  rejectsInvalid(() => validateRequest(request({ options: { operationTimeoutMs: 0 } })));

  const recover = validateRequest(request({
    operation: 'recover',
    format: 'rpgmv',
    options: { dryRun: true, conflictPolicy: 'fail-if-present' },
  }));
  assert.equal(recover.options.dryRun, true);
  assert.equal(recover.options.conflictPolicy, 'fail-if-present');
  rejectsInvalid(() => validateRequest(request({
    operation: 'recover',
    options: { conflictPolicy: 'overwrite' },
  })));
});

test('checked-in schema documents are copied to staging and validate normalized requests', () => {
  const relativeSchemas = [
    'v1/request.schema.json',
    'v1/result.schema.json',
    'v1/manifest.schema.json',
    'v1/container-provenance.schema.json',
    'v2/request.schema.json',
    'v2/result.schema.json',
    'v2/manifest.schema.json',
    'v2/engine-options.schema.json',
  ];
  for (const relative of relativeSchemas) {
    assert.ok(fs.existsSync(path.join(appRoot, 'src', 'core', 'contracts', 'schemas', relative)), relative);
    assert.ok(fs.existsSync(path.join(appRoot, '.build', 'app', 'src', 'core', 'contracts', 'schemas', relative)), relative);
  }

  const normalized = validateRequest(request({ options: { verifyDepth: 'deep' } }));
  assert.deepEqual(validateContract('request', 2, normalized), { ok: true, errors: [] });
});

test('manifest reader accepts v1/v2 and rejects schema drift before engine code', () => {
  const base = { format: 'rpgmv', createdAt: '2026-08-23T00:00:00.000Z', entries: [] };
  assert.equal(parseExtractManifest({ schemaVersion: 1, ...base }).schemaVersion, 1);
  assert.equal(parseExtractManifest({ schemaVersion: 2, ...base, sourceSnapshots: {} }).schemaVersion, 2);

  const legacyMinimalEntry = {
    id: 'legacy-entry',
    extractFile: '../outside.txt',
    hash: '0'.repeat(64),
  };
  assert.equal(parseExtractManifest({
    schemaVersion: 1,
    format: 'rpgmv',
    entries: [legacyMinimalEntry],
  }).entries.length, 1);
  assert.throws(
    () => parseExtractManifest({
      schemaVersion: 2,
      format: 'rpgmv',
      createdAt: base.createdAt,
      sourceSnapshots: {},
      entries: [legacyMinimalEntry],
    }),
    (error) => error && error.code === 'E_MANIFEST_CORRUPT',
  );

  assert.throws(
    () => parseExtractManifest({ schemaVersion: 2, ...base, sourceSnapshots: {}, unexpected: true }),
    (error) => error && error.code === 'E_MANIFEST_CORRUPT',
  );
});

test('container provenance reader applies its versioned schema before path semantics', () => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tsukuru-provenance-schema-'));
  try {
    fs.writeFileSync(path.join(root, '.tsukuru-container.json'), JSON.stringify({
      schemaVersion: 1,
      containerType: 'electron-asar',
      archiveRelativePath: 'resources/app.asar',
      archiveSha256: '0'.repeat(64),
      engine: { type: 'rpgmz', root: 'project' },
      archiveFiles: ['project/data/Actors.json'],
      unpackedFiles: [],
      requiredEntries: ['project/data/Actors.json'],
      invalidEntryCount: 0,
      unexpected: true,
    }));
    assert.throws(
      () => readContainerProvenance(root),
      (error) => error && error.code === 'E_CONTAINER_PROVENANCE_INVALID'
        && Array.isArray(error.details?.violations),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('v1 results preserve legacy keys while v2 adds structured warning compatibility', () => {
  const legacy = finalizeAgentResult(emptyResult(1), 1);
  assert.equal(Object.hasOwn(legacy, 'schemaVersion'), false);
  assert.equal(Object.hasOwn(legacy, 'warningDetails'), false);
  assert.deepEqual(validateContract('result', 1, legacy), { ok: true, errors: [] });

  const current = emptyResult(2);
  current.warnings.push('legacy warning text');
  const finalized = finalizeAgentResult(current, 2);
  assert.equal(finalized.schemaVersion, 2);
  assert.deepEqual(finalized.warningDetails, [{
    code: WarningCodes.LEGACY_MESSAGE,
    message: 'legacy warning text',
  }]);
  assert.deepEqual(validateContract('result', 2, finalized), { ok: true, errors: [] });
});

test('application emits the result version selected by the request contract', async () => {
  const projectPath = path.join(appRoot, 'missing-contract-fixture');
  const v1 = await executeAgentRequest(request({ schemaVersion: 1, projectPath }));
  const v2 = await executeAgentRequest(request({ schemaVersion: 2, projectPath }));
  assert.equal(Object.hasOwn(v1, 'schemaVersion'), false);
  assert.equal(Object.hasOwn(v1, 'warningDetails'), false);
  assert.equal(v2.schemaVersion, 2);
  assert.deepEqual(v2.warningDetails, []);
  assert.deepEqual(validateContract('result', 1, v1), { ok: true, errors: [] });
  assert.deepEqual(validateContract('result', 2, v2), { ok: true, errors: [] });
});

test('checked-in contract examples and README snippets stay schema-valid', () => {
  const examplesRoot = path.join(appRoot, 'src', 'core', 'contracts', 'examples');
  const stagedExamplesRoot = path.join(appRoot, '.build', 'app', 'src', 'core', 'contracts', 'examples');
  const catalog = JSON.parse(fs.readFileSync(path.join(examplesRoot, 'catalog.json'), 'utf8'));

  assert.ok(Array.isArray(catalog));
  assert.ok(catalog.length >= 8);
  for (const { file, kind, version } of catalog) {
    const sourcePath = path.join(examplesRoot, file);
    const stagedPath = path.join(stagedExamplesRoot, file);
    assert.ok(fs.existsSync(sourcePath), file);
    assert.ok(fs.existsSync(stagedPath), `staged ${file}`);
    const value = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    assert.deepEqual(validateContract(kind, version, value), { ok: true, errors: [] }, file);
  }

  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const snippets = [...readme.matchAll(
    /<!-- contract-example:([a-z-]+):(\d+) -->\s*```json\s*([\s\S]*?)\s*```/g,
  )];
  assert.ok(snippets.length >= 4, 'README must publish at least four validated contract examples');
  for (const [, kind, version, source] of snippets) {
    assert.deepEqual(
      validateContract(kind, Number(version), JSON.parse(source)),
      { ok: true, errors: [] },
      `README ${kind}:v${version}`,
    );
  }

  const documentationRoots = [path.join(repoRoot, 'docs'), path.join(appRoot, 'docs')];
  const documentationSnippets = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.name.endsWith('.md')) {
        const markdown = fs.readFileSync(absolute, 'utf8');
        for (const match of markdown.matchAll(
          /<!-- contract-example:([a-z-]+):(\d+) -->\s*```json\s*([\s\S]*?)\s*```/g,
        )) documentationSnippets.push({ file: absolute, match });
      }
    }
  };
  for (const root of documentationRoots) visit(root);
  assert.ok(documentationSnippets.length >= 1, 'docs must include a schema-validated JSON example');
  for (const { file, match: [, kind, version, source] } of documentationSnippets) {
    assert.deepEqual(
      validateContract(kind, Number(version), JSON.parse(source)),
      { ok: true, errors: [] },
      `${path.relative(repoRoot, file)} ${kind}:v${version}`,
    );
  }
});

test('publishes the v2 migration guide, ADR, and static TypeScript contract surface', () => {
  const migration = fs.readFileSync(path.join(appRoot, 'docs', 'contracts', 'v2-migration.md'), 'utf8');
  for (const term of ['v1', 'v2', 'unknown option', 'warningDetails', 'operationTimeoutMs', 'E_OPERATION_CANCELLED']) {
    assert.match(migration, new RegExp(term, 'i'));
  }

  const adr = fs.readFileSync(
    path.join(repoRoot, 'docs', 'adr', '0003-versioned-json-contracts-and-operation-runtime.md'),
    'utf8',
  );
  for (const term of ['JSON Schema 2020-12', 'OperationRuntime', 'AsyncLocalStorage', 'v1', 'v2']) {
    assert.match(adr, new RegExp(term, 'i'));
  }

  const typeSurface = fs.readFileSync(path.join(appRoot, 'src', 'core', 'contracts', 'types.ts'), 'utf8');
  for (const term of ['AgentRequestV2', 'AgentResult', 'ExtractManifest', 'ContainerProvenance']) {
    assert.match(typeSurface, new RegExp(`\\b${term}\\b`));
  }
});
