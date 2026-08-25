# Post-v2.5 Hardening Progress

## Current Phase

Phase 18.6 — dependency, external-binary, and release supply-chain evidence is
next. Phase 18.5 versioned contracts, explicit runtime, and cancellation passed
every gate.

## Completed

- [x] Read and assess all of `New-task-plan.md`.
- [x] Compare its headline findings with the local repository.
- [x] Preserve the historical `task_plan.md` and add Phase 18 instead of replacing it.
- [x] Create a separate findings ledger.
- [x] Ask the existing ChatGPT Pro conversation to review the smallest first work unit using current local evidence.
- [x] Reproduce commit `17fa6e7` in an independent clean worktree.
- [x] Measure test and GUI/CLI package behavior before and after compile.
- [x] Capture tracked-only (61) and local-augmented (78) test baselines.
- [x] Hash six local-only tests, both lockfiles, the source fixture, and three
  bundled executable files.
- [x] Add normalized v1/v2 verify, invalid-path, and manifest snapshots.
- [x] Verify the post-compile packaged CLI's success and failure contracts.
- [x] Write `docs/baseline.md` and incorporate Pro's review boundary.
- [x] Receive Pro's final checkpoint approval: no blocking Phase 0 evidence is
  missing; keep incomplete-package success separate from compile orchestration.
- [x] Remove the disposable clean worktree and synthetic extracted-pack copy
  after recording evidence; no pre-existing `tmp` content was removed.
- [x] Reproduce the ignored local lock with `npm ci` in a second clean worktree.
- [x] Confirm GUI package contamination by a pre-existing `dist-cli` output:
  740,468,101 bytes/77 nested entries versus 34,974,465 bytes/0 after removal.
- [x] Remove the second disposable local-lock worktree after recording the
  comparison; the ignored source lockfile was not modified.
- [x] Create `chore/hardening-lockfile` from exact baseline `17fa6e7` in a
  separate worktree so the evidence-only main diff remains untouched.
- [x] Generate lockfile v3 with Node 24.14.0/npm 11.19.0 and prove that
  `package.json` is byte-identical.
- [x] Compare all package records with the ignored local lock: 624 versus 627,
  four version resolutions, and hoisted versus nested `es-abstract` placement.
- [x] Restrict the review unit to `.gitignore` plus `package-lock.json`.
- [x] Verify `npm ci`, typecheck, compile, tracked tests 61/61, CLI ZIP content,
  and packaged invalid/missing/extract/schema-v1/schema-v2 contracts.
- [x] Restore the 19 tracked JavaScript files rewritten by compile so no
  generated source drift remains in the lockfile-only diff.
- [x] Create `chore/hardening-build-chain` from exact baseline `17fa6e7` and
  use the canonical lock only as an ignored verification artifact.
- [x] Add eight build-chain regressions and observe every behavior fail before
  implementation or bug correction.
- [x] Emit TypeScript and runtime static assets into `.build/app`; move tracked
  tests and development launchers to staged runtime modules.
- [x] Add target-specific GUI/CLI staging metadata and exact-output cleanup
  restricted to `dist` or `dist-cli`.
- [x] Replace broad package inputs with one staging FileSet and remove the
  exclusion-only `win.files` input that re-enabled the repository root.
- [x] Pass typecheck and all 69 tracked tests without tracked source drift.
- [x] Pass actual `CLI → GUI → CLI` packaging with zero output-tree entries;
  the two CLI ASARs are byte-for-byte identical across order.
- [x] Recheck packaged CLI failure/extract/v1/v2 contracts and a five-second
  GUI unpacked launch probe with no root process left behind.
- [x] Create `chore/hardening-version-identity` from exact baseline `17fa6e7`
  without modifying the three earlier review units.
- [x] Establish `package.json@2.5.0` as canonical after checking local tags,
  commit history, release notes, and prior artifact names.
- [x] Add `sync:version`, `check:version`, current repository metadata, GUI
  branding/support links, version-derived CLI artifact naming, and ADR 0001.
- [x] Preserve the legacy GUI appId and `MVExtractor` protocol alias while
  adding the maintained `tsukuru-agent` identity.
- [x] Observe six version/identity tests fail before implementation, then pass
  6/6; pass typecheck, compile, and all 67 tracked tests.
- [x] Build `tsukuru-agent-2.5.0-win.zip`, verify its internal package identity,
  and confirm packaged `E_REQUEST_INVALID` JSON with exit 1.

## In Progress

- [x] Map `run.ts` responsibilities, dependencies, and side effects before
  moving operation dispatch into an application layer.
- [x] Move argument parsing, request loading, and the one-JSON stdout contract
  to injected entrypoint/presenter ports.
- [x] Replace the operation switch with an independently tested typed dispatcher.
- [x] Centralize engine capability, patch format, extraction layout, and request
  compatibility in immutable registry/policy modules.
- [x] Move all five implementations behind operation modules and route
  extract/apply/verify through immutable engine-family handler registries.
- [x] Move machine and human summary formatting to the presenter; `run.ts` no
  longer writes directly to stdout or stderr.
- [x] Add `WorkspaceTransaction` with force backup, rollback, failed-commit
  restoration, and pre-commit final-path invisibility; use it for ASAR/NW.js
  extract/repack and RPG/Wolf/Tyrano/GDevelop apply outputs.
- [x] Split RPG/Wolf/Tyrano validators, score/report/severity/protected-path/
  file-map policy, and reduce the legacy validator API to a 28-line barrel.
- [x] Split ASAR/NW.js/directory adapters, common archive/filesystem policy,
  inspect/pack/verify operations and provenance; reduce `container.ts` to 40 lines.
- [x] Record dependency direction and transaction invariants in ADR 0002.
- [x] Pass `npm run verify` and fixed-seed `npm run test:order`: 35 files,
  175 checks, 175 pass, generated drift 0, inventory drift 0.

## Next

- [ ] Build Phase 6 dependency and external-binary inventories from the lockfile,
  import/call graph, shipped files, hashes, licenses, and package boundaries.
- [ ] Characterize deprecated `request`, axios, Electron, and electron-builder
  reachability before removing or upgrading any dependency.
- [ ] Add reproducible notice/checksum/release-manifest/SBOM generation and drift
  contracts in small reversible units.
- [ ] Keep the three independent review worktrees intact; no commit or push is
  implied by the integration verification.

## Integrated hardening checkpoint (2026-08-22)

- [x] Combine lockfile, build-chain, and version/identity changes in
  `chore/hardening-integration` without modifying their source worktrees.
- [x] Add current GitHub Actions workflows for Ubuntu, Windows packaging, and
  an optional private compatibility corpus; lock install semantics to `npm ci`.
- [x] Restore and classify all test suites into five test layers; enforce an
  exact README inventory of 23 files and 126 checks.
- [x] Add deterministic CLI snapshots for all five operations, fixture and
  invariant catalogs, hostile archive/path regressions, bounded fuzz, and
  translation/manifest edge cases.
- [x] Add a single-root test harness with deterministic order shuffling, no
  retries, cleanup enforcement, and Node built-in coverage measurement.
- [x] Pass `npm run verify` (126/126), seeded order run (125/125), coverage
  baseline run (123/123), CLI build, package-content verification, and packaged
  stdout/exit-code smoke.

## Integrated Phase 3 checkpoint (2026-08-23)

- [x] Force secure BrowserWindow defaults and route every production window
  through one factory; deny unapproved navigation, popups, and webviews.
- [x] Replace renderer Node access with a typed sandbox preload exposing only
  allowlisted send/invoke/on channels; validate sender, payload, route, local
  directory, and external HTTPS host in the main process.
- [x] Split main-process IPC registration into window, settings, project, and
  operation handler modules; move `openFolder` to handle/invoke.
- [x] Add CSP and explicit update/network/offline policy; remove remote renderer
  scripts and the continue-after-uncaught-exception pattern.
- [x] Make GUI bulk replacement and version translation port operate through
  complete `Extract` staging/commit/rollback transactions.
- [x] Pass 150/150 full and seeded-order checks, actual Electron preload/IPC,
  RPG/Wolf extract/apply, settings save/close, route switching, and an actual
  five-second main GUI launch with no startup error.
- [x] Activate the post-stabilization core coverage gate for schema, path, and
  transaction seams at line 70%, branch 50%, and function 85%; measured
  81.68% / 64.26% / 96.08% across all 150 checks.
- [x] Rebuild and verify the 5,217-entry CLI ZIP: 98,547,808 bytes, SHA-256
  `1FA079EB8316004C112634B783854AB753B88917C0DD47ECB89F53A7DD8A327E`.

## Error Log

- 2026-08-19: `agbrowse web-ai send` stopped at ChatGPT surface preflight (`capability.unsupported`); no message was sent. Used the verified existing conversation through normal browser control.
- 2026-08-19: the first normal-browser input ref expired after a page refresh; refreshed the snapshot and resent successfully.
- 2026-08-19: `Get-Volume` was access denied while recording the filesystem;
  `System.IO.DriveInfo` confirmed NTFS without elevated disk administration.
- 2026-08-19: direct PowerShell invocation of the packaged GUI-subsystem EXE
  did not wait/capture stdout. A hidden `Start-Process -Wait` probe with separate
  streams produced reliable exit codes and JSON.
- 2026-08-19: running GUI and CLI electron-builder processes concurrently made
  the GUI builder scan a changing `dist-cli` tree and fail with ENOENT. Reran
  sequentially; this exposed the underlying missing `dist-cli/**` exclusion.
- 2026-08-19: plain PowerShell `ConvertFrom-Json` rejected the lockfile's empty
  root package path key. Repeated the graph comparison with `-AsHashtable`.
- 2026-08-19: `npm run compile` rewrote 19 tracked generated JavaScript files
  and left line-ending diffs. Restored only those verified compile outputs;
  compile/output separation remains a build-chain task.
- 2026-08-19: the loose RPG fixture extract writes `Extract` and `Backup` under
  the disposable source copy rather than the requested sibling output. The
  packaged verify was rerun against the emitted artifact path and passed for
  schema v1 and v2.
- 2026-08-19: the first build-chain RED run hit sandbox `spawn EPERM`; reran in
  the approved child-process environment and confirmed five intended failures.
- 2026-08-19: a build-chain test rebuilt the global staging tree while Node's
  test runner loaded other files in parallel, causing transient module-not-found
  failures. Added a failing serialization contract and set test concurrency 1.
- 2026-08-19: the first staged CLI package omitted `package.json`; explicitly
  including the staged file fixed packaging, but showed CLI `main` was still
  GUI `main.js`. Target-specific staged metadata fixed the entry point.
- 2026-08-19: adding a root package FileSet and retaining exclusion-only
  `win.files` each re-enabled default root packaging. Intermediate GUI ASARs
  were 394 MB with 185 output entries. Removing both root inputs produced the
  final 29.7 MB/zero-output-entry GUI ASAR.
- 2026-08-19: the first version-worktree `npm ci` reached dependency extraction
  but failed because the sandbox denied install-script child processes with
  `spawn EPERM`. The same lock and command succeeded in the approved execution
  environment; no dependency or lock mutation was needed.
- 2026-08-19: a PowerShell bulk line-ending normalization used backslash escape
  syntax and inserted literal `\\r\\n` text into 19 compile-generated JS files.
  Hash comparison caught it before review; only those explicit generated files
  were restored byte-for-byte from the baseline index. Product source and the
  intended identity diff were unaffected.
- 2026-08-23: direct Node test spawning again returned sandbox `EPERM`; the
  approved child-process environment passed without source or dependency changes.
- 2026-08-23: moving the update endpoint into `updatePolicy.ts` initially made
  two version contracts stale. Both checkers were updated to inspect the new
  canonical module, then the complete version suite passed.
- 2026-08-23: Phase 3 additions intentionally made the 23/126 and later 28/147
  inventories stale. README and the executable inventory contract now agree on
  28 files and 150 checks.
- 2026-08-23: the first expanded Electron run executed every GUI action but
  reported `ok:false` because the RPG renderer normalizes only its first path
  separator; the smoke now compares canonical paths. It also used `app.quit`,
  which could mask a failed result with exit 0; explicit `app.exit(exitCode)`
  now preserves the failure contract.
- 2026-08-23: the first broad handler-refactor patch changed two adjacent
  callback terminators in `main.ts`. Immediate typecheck found the syntax error;
  the exact functions were repaired before any runtime or package verification.
- 2026-08-23: the first full verification after splitting the CLI entrypoint
  exposed a real characterization regression: application failures lost the
  already detected format/container/engine fields. `executeAgentRequest` now
  owns operation error conversion and preserves its partial result; the five-
  operation snapshot and entrypoint contracts pass again.
- 2026-08-23: the first operation-boundary static test matched the data value
  `electron-asar` as if it were an Electron API dependency. Narrowed the test
  to actual import/require and `process.`/`console.` access; product behavior
  had already passed the snapshot and integration checks.
- 2026-08-23: replacing the validator barrel with a direct alias changed the
  callback type of `isProtectedPath` because the narrow policy accepts an
  optional profile argument. Typecheck caught its use in `Array.filter`; a
  one-argument compatibility wrapper restored the public API.
- 2026-08-23: the first container adapter extraction created a staging folder
  before rejecting a hostile `package.nw`. The existing integration invariant
  failed; adapter `assertExtractable` preflight now runs before staging creation.
- 2026-08-23: an initial targeted Node command named tests that do not exist in
  the reorganized hierarchy, so Node only executed the valid paths. The exact
  inventory was enumerated and the intended suites were rerun before broad gates.
- 2026-08-23: the first full gate after splitting verify into engine modules
  failed one static presenter-boundary assertion that read only the former
  top-level file. It now aggregates the verify subtree; runtime snapshots and
  all engine behavior had already remained unchanged.
- 2026-08-23: the first Phase 5 schema candidate inferred an undefined
  `outputPath` in a TypeScript narrowing path. Typecheck caught it before runtime;
  the request union and normalized optional field were separated explicitly.
- 2026-08-23: the first manifest schema required complete v2 mapping fields from
  v1 entries. Full tests exposed Wolf diagnostic and semantic traversal-contract
  regressions; only v1 was relaxed to its historical minimum and 56 focused
  checks then passed.
- 2026-08-23: Phase 5 intentionally raised the inventory from 35/175 to 39/198,
  so the first full run failed the stale README/CI count contract. Both sources
  now agree and the executable inventory check passes.

## Integrated Phase 5 checkpoint (2026-08-23)

- [x] Publish immutable request/result/manifest v1/v2, provenance v1, and engine
  options v2 JSON Schema 2020-12 documents with static TypeScript exports.
- [x] Reject invalid v2 operation/format/options before dispatch while retaining
  v1 unknown-option and minimal-manifest compatibility.
- [x] Centralize error/warning codes and preserve legacy warning strings beside
  v2 structured warning details.
- [x] Validate eight checked-in examples and four README JSON examples; publish
  ADR 0003 and the v2 migration policy.
- [x] Remove module-level active context, add explicit OperationRuntime dependency
  injection, and prove success/failure/nested/parallel isolation.
- [x] Connect CLI signals, GUI cancel IPC, and operation timeouts to AbortSignal
  and transaction rollback/no-partial-output guarantees.
- [x] Pass typecheck, `npm run verify`, and fixed-seed `npm run test:order`:
  39 files, 198 checks, 198 pass, generated drift 0, inventory drift 0.

## Working-tree Guardrail

- User-owned/untracked input: `New-task-plan.md`.
- Main worktree keeps only the evidence/plan changes already recorded.
- Lockfile-only worktree status is exactly modified `.gitignore` plus untracked
  `package-lock.json`; `package.json` and product source are unchanged.
- Build-chain worktree contains only build configuration, staging/cleanup
  helpers, and tracked test path/regression changes; its copied lock and all
  package outputs remain ignored.
- Version/identity worktree contains only metadata/version policy, GUI
  identity/link changes, ADR, and six regression tests; its copied lock,
  dependencies, package outputs, and compile outputs remain ignored or clean.
- No commit, push, dependency declaration update, security auto-fix, or global
  tool update was performed.

## Integrated Phase 6 checkpoint (2026-08-23)

- [x] Added direct dependency, external binary, and vendored asset inventories;
  deterministic notice generation; audit/exception, dependency-upgrade, and
  binary-replacement policies; and weekly Dependabot with manual Electron majors.
- [x] Removed unused/deprecated direct dependencies and replaced request/axios
  calls with a bounded HTTPS/loopback client. Added download hash/size pinning.
- [x] Added verified external-binary resolution, fixed paths and argument arrays,
  shell-off spawning, timeout, and process-tree cleanup; CLI packages no exfiles.
- [x] Upgraded adm-zip 0.5.18 to 0.6.0 after the production audit found a high
  OOM advisory; removed redundant type definitions and reached production audit 0.
- [x] Added checksum, source/build manifest, and SPDX 2.3 SBOM generation with a
  clean-source release gate and deterministic dirty-state test opt-in.
- [x] Connected production audit, supply-chain drift, release evidence, and
  evidence upload to CI. Added package startup timeout and explicit exfiles ban.
- [x] Moved shared process lifecycle and public-error redaction from Electron to
  core after real packaged smoke exposed a missing-module startup hang.
- [x] Built and verified `tsukuru-agent-2.5.0-win.zip` (97,054,332 bytes): 3,467
  ASAR entries, no GUI translation executables, `E_REQUEST_INVALID`/exit1 smoke.
- [x] `npm run verify`: 42 files, 209 checks, 209 pass; generated/inventory/
  supply-chain drift 0. Fixed-seed `npm run test:order`: 209/209 pass.
- [x] `npm run test:electron`: preload/IPC/RPG/Wolf/settings/routes all pass with
  nodeIntegration false, contextIsolation/sandbox/webSecurity true.
- [!] Full audit remains 4 moderate/11 high through Electron 22.3.27 and
  electron-builder 22.14.13. Public binary release is blocked until the separate
  one-major-at-a-time upgrade ladder passes its documented matrix.

## Phase 6 errors resolved

- Initial supply-chain comparison treated JSON object insertion order as lock
  drift. It now compares sorted key/value entries.
- The first static no-`exec` assertion matched `RegExp.exec`; it now detects only
  child-process exec imports/calls.
- The first actual package verification waited indefinitely because CLI ASAR
  omitted a newly imported Electron-local module. A bounded smoke exposed the
  load error; shared modules moved to core and the actual archive now exits.
- npm 11 consumed option-like release arguments under PowerShell. The package
  script now owns `--output-dir` and receives only positional output/artifact
  values, which matches the Windows CI command.

## Integrated Phase 7 checkpoint (2026-08-23)

- [x] Added deterministic RPG/Wolf/Tyrano/GDevelop/ASAR/NW.js benchmark
  fixtures and elapsed/RSS/file-byte-entry/temp/stage metrics with checked-in
  CI ceilings and a manual Windows workflow.
- [x] Standardized progress events and v2 performance telemetry; added atomic,
  redacted opt-in diagnostics and request-level resource/temp-space preflight.
- [x] Moved RPG/Wolf extract/apply, bulk text replacement, and version port to
  a worker thread while preserving legacy GUI progress/alert behavior.
- [x] Added shared-memory cancellation, app `before-quit` cleanup waiting,
  worker-owned child PID tracking, process-tree termination, and staging
  rollback tests.
- [x] Recorded stream versus bounded-buffer decisions and residual legacy async
  paths in `docs/performance/io-boundaries.md`.
- [x] Passed `npm run benchmark:check` for all six profiles and synchronized the
  executable README inventory at 46 files/225 checks.
- [ ] Final `npm run verify` rerun after the inventory assertion update remains
  part of the next integrated gate; no commit or push was performed.

## Integrated Phase 8A checkpoint (2026-08-23)

- [x] Added diagnostic detection for directory-form `package.nw` and an
  explicit `experimentalNwDirectory` v2 opt-in on extract/container apply.
- [x] Added deterministic directory provenance, wrapper-preserving copy-only
  publication, source/staged digest checks, and link/junction/path/collision
  rejection.
- [x] Passed focused directory tests 2/2, full compatibility tests 8/8, and
  versioned-schema contracts 11/11; legacy ZIP round-trip remains green.
- [x] Documented the feature flag, rollback boundary, and synthetic-only
  evidence in README, release notes, and the experimental compatibility note.
- [!] Approved paths contain an Electron ASAR sample but no real directory-form
  `package.nw`; launch probe and gameplay validation remain pending a sample.
- [-] Started Phase 8B appended-ZIP diagnostic design. Final full `npm run
  verify`, commit, and push remain deferred until the integrated phases close.

## Integrated Phase 8B checkpoint (2026-08-23)

- [x] Added bounded classic-ZIP EOCD/central/local offset and PE32/PE32+
  inspection for executable-appended NW.js packages.
- [x] Added default-disabled `experimentalNwAppendedZip` extract/apply support
  for one unsigned candidate, with exact prefix preservation and output
  re-inspection.
- [x] Blocked certificate-table and malformed layouts with
  `E_EXPERIMENTAL_FEATURE_UNSAFE`; multiple candidates stay diagnostic-only and
  source hashes remain unchanged.
- [x] Documented official NW.js packaging evidence, Microsoft PE certificate
  semantics, unsupported ZIP64/bypass cases, and launch-unverified reporting.
- [x] Passed the complete compatibility suite 11/11 and versioned-schema suite
  11/11 after the change.
- [-] Started Phase 8C Electron/GDevelop ASAR transaction work. Full verify,
  inventory synchronization, commit, and push remain deferred.

## Integrated Phase 8C checkpoint (2026-08-23)

- [x] Connected Electron/GDevelop extract and apply to ASAR provenance,
  transaction publication, JSON Pointer verification, and runtime diagnostics.
- [x] Preserved ASAR unpacked metadata/files and unrelated external resources;
  protected `gdjs` and generated event scripts remain byte-identical.
- [x] Added protected-script tamper rollback and source archive SHA invariance to
  the GDevelop ASAR E2E.
- [x] Added diagnostic-only malformed-ASAR extraction and default-disabled
  `experimentalMalformedAsarRepack` for cleaned separate-copy output.
- [x] Passed CLI E2E 17/17 and compatibility 11/11.
- [!] The approved real sample is ElectronForMZ/RPG MZ with 18 decoy metadata
  entries, not GDevelop; it was inspected read-only and no playtest was claimed.
- [-] Started Phase 8D static `code*.js` profile. Full verify, inventory sync,
  commit, and push remain deferred.

## Integrated Phase 8D checkpoint (2026-08-23)

- [x] Added a default-disabled Acorn AST profile for direct generated-object
  `setString`/`setBBText` literals without executing JavaScript.
- [x] Kept identifiers, resource paths/URLs, variables, templates, arbitrary
  setters, and parse failures out of automatic extraction; emitted an
  inspectable ambiguous-candidate report.
- [x] Bound code entries to source snapshots, literal spans/hashes, quote,
  callee, and candidate index; hostile mapping edits fail atomically.
- [x] Allowed only validated code files through protected-script diffing in
  loose, Electron ASAR, and NW.js copy-only apply paths.
- [x] Added v2 option contracts, dependency inventory/notices, README/release
  notes, and the detailed experimental profile document.
- [x] Passed the relevant compatibility, full agent E2E, versioned-schema, and
  supply-chain suites 45/45.
- [-] Started Phase 9 documentation and release-maintenance work. Final full
  verify, release evidence, commit, and push remain deferred.

## Integrated Phase 9 checkpoint (2026-08-23)

- [x] Split README into CLI quick start and GUI usage, documented all five
  operations and v1/v2 schema behavior, and added architecture plus an
  operation/engine/wrapper/container compatibility matrix.
- [x] Added SECURITY, CONTRIBUTING, canonical CHANGELOG, maintenance and
  deprecation policy, every error/warning code, and an automated-versus-manual
  release checklist. Local Markdown links and tagged JSON examples are tested.
- [x] Reinstalled from the lockfile with `npm ci`, then passed `npm run verify`:
  46 files, 236 checks, 236 pass, generated/inventory/supply-chain drift 0.
- [x] Passed fixed-seed order 236/236 and all six CI benchmarks. The GDevelop
  structural byte contract is 733,548 after the deterministic code report;
  elapsed/RSS ceilings remain unchanged.
- [x] Built and verified the 97,065,414-byte CLI ZIP with 3,471 entries and
  packaged `E_REQUEST_INVALID`/exit1 smoke. ZIP SHA-256 is
  `7532f72efdb8ef1aa7553302b189c117597d3220216537d0945f191b612da9e8`.
- [x] Generated SHA256SUMS, source manifest, and SPDX 2.3 SBOM twice with
  identical hashes; the development manifest correctly records a dirty tree.
- [!] Production audit is 0, while full audit remains 4 moderate/11 high in
  Electron 22.3.27/electron-builder 22.14.13. Public GUI release and the whole
  Definition of Done remain blocked on the one-major-at-a-time ladder.
- [ ] No commit or push was performed.

## Electron 24 rung checkpoint (2026-08-23)

- [x] Upgraded only Electron from 23.3.13 to exact 24.8.8 while keeping
  electron-builder 26.15.7 fixed.
- [x] Clean install, production audit 0, full audit 2 high/0 critical,
  `verify` 236/236, fixed-seed 236/236, real Electron security smoke, and CLI
  package smoke all passed.
- [x] Artifact: 99,101,149 bytes, 3,012 entries, SHA-256
  `587a42830896b0ea627fa216fc8e95b96e537b64d1a83269660478dfb3237a35`.
- [!] Continue with Electron 25; public binary release remains blocked.
- [ ] No commit or push was performed.

## Electron 25 rung checkpoint (2026-08-23)

- [x] Upgraded only Electron to exact 25.9.8 with builder 26.15.7 fixed.
- [x] Clean install, production audit 0, full audit 2 high/0 critical,
  `verify` 236/236, fixed-seed 236/236, real Electron security smoke, and CLI
  package smoke all passed.
- [x] Artifact: 99,323,972 bytes, 3,012 entries, SHA-256
  `357da30fe25d7538bd1b6c00560495de249e0aede335f031e7b3cc996cd06ce0`.
- [!] Continue with Electron 26; public binary release remains blocked.
- [ ] No commit or push was performed.

## Electron 26 rung checkpoint (2026-08-23)

- [x] Upgraded only Electron to exact 26.6.10 with builder 26.15.7 fixed.
- [x] Clean install, production audit 0, full audit 2 high/0 critical,
  `verify` 236/236, fixed-seed 236/236, real Electron security smoke, and CLI
  package smoke all passed.
- [x] Artifact: 101,597,643 bytes, 3,012 entries, SHA-256
  `6e0c9ca192936487c29e0b5dc69503a8bd3e99c7ce6d80160be927fd2e48ee1a`.
- [!] Continue with Electron 27; public binary release remains blocked.
- [ ] No commit or push was performed.

## Electron 27 rung checkpoint (2026-08-23)

- [x] Electron 27.3.11 passed clean install, both 236/236 suites, two real GUI
  smoke runs, and CLI package verification under builder 26.15.7.
- [!] Both GUI runs recovered after GPU subprocess exits; this is recorded as a
  rung warning and must disappear or be dispositioned before public release.
- [x] Artifact: 104,949,433 bytes, 3,012 entries, SHA-256
  `835623b7a854fdf2cd096d2a1584b541204a24c0ed814e2a8783639025a59b41`.
- [!] Continue with Electron 28 and recheck GPU behavior.
- [ ] No commit or push was performed.

## Electron 28 rung checkpoint (2026-08-23)

- [x] Electron 28.3.3 passed clean install, both 236/236 suites, real GUI smoke,
  and CLI package verification under builder 26.15.7.
- [x] The unchanged GUI smoke emitted no GPU subprocess error, narrowing the
  recovered warning to the Electron 27 rung on this Windows host.
- [x] Artifact: 107,068,585 bytes, 3,012 entries, SHA-256
  `07c8ccd642437aaf7b59c8b31b7124b429827e285d1eefecffca2b537d6a6967`.
- [!] Continue with Electron 29; full audit remains 2 high/0 critical.
- [ ] No commit or push was performed.

## Electron 29 rung checkpoint (2026-08-23)

- [x] Electron 29.4.6 passed clean install, both 236/236 suites, error-free real
  GUI smoke, and CLI package verification under builder 26.15.7.
- [x] Artifact: 107,713,469 bytes, 3,012 entries, SHA-256
  `240e8e8074173762e4b70b27919732464437d09c935a8f810e6238b532dd9b5b`.
- [!] Continue with Electron 30; full audit remains 2 high/0 critical.
- [ ] No commit or push was performed.

## Electron 30 rung checkpoint (2026-08-23)

- [x] Electron 30.5.1 passed clean install, both 236/236 suites, error-free real
  GUI smoke, and CLI package verification under builder 26.15.7.
- [x] Artifact: 108,344,863 bytes, 3,012 entries, SHA-256
  `7d579be857f748b1fc0e84b76f7aa02cc9a05c450c7a109ea41e7c6afa1bbf57`.
- [!] Continue with Electron 31; full audit remains 2 high/0 critical.
- [ ] No commit or push was performed.

## Electron 31 rung checkpoint (2026-08-23)

- [x] Electron 31.7.7 passed clean install, both 236/236 suites, error-free real
  GUI smoke, and CLI package verification under builder 26.15.7.
- [x] Artifact: 110,233,601 bytes, 3,012 entries, SHA-256
  `83ec0fc8569c70fe43386e991ee7fc7fd22b4673636a742814162b5a433aba0b`.
- [!] Continue with Electron 32; full audit remains 2 high/0 critical.
- [ ] No commit or push was performed.

## Electron 32 rung checkpoint (2026-08-23)

- [x] Electron 32.3.3 passed clean install, both 236/236 suites, error-free real
  GUI smoke, and CLI package verification under builder 26.15.7.
- [x] Artifact: 112,556,338 bytes, 3,012 entries, SHA-256
  `91c4384cd06ebd4c48aa2d7580e8522f026c692fa385b2b4a894d7414040b6fd`.
- [!] Continue with Electron 33; full audit remains 2 high/0 critical.
- [ ] No commit or push was performed.

## Electron 33 rung checkpoint (2026-08-23)

- [x] Electron 33.4.11 passed clean install, both 236/236 suites, error-free real
  GUI smoke, and CLI package verification under builder 26.15.7.
- [x] Artifact: 114,400,989 bytes, 3,012 entries, SHA-256
  `91d72f1830da58a5b8027335786a04b204b74904c6006fe9628e15bb5e3b14a3`.
- [!] Continue with Electron 34; full audit remains 2 high/0 critical.
- [ ] No commit or push was performed.

## Electron 34 rung checkpoint (2026-08-23)

- [x] Electron 34.5.8 passed clean install, both 236/236 suites, error-free real
  GUI smoke, and CLI package verification under builder 26.15.7.
- [x] Artifact: 115,530,936 bytes, 3,012 entries, SHA-256
  `56e5f79154afb2216614984c8b3ab4a79d8e7155ce69abb22563d31af700efcc`.
- [!] Continue with Electron 35; full audit remains 2 high/0 critical.
- [ ] No commit or push was performed.

## Electron 35 rung checkpoint (2026-08-23)

- [x] Electron 35.7.5 passed clean install, both 236/236 suites, error-free real
  GUI smoke, and CLI package verification under builder 26.15.7.
- [x] Artifact: 120,098,576 bytes, 3,012 entries, SHA-256
  `2592fca6462297a45d91e275f675a99b1fef0676b9dffb8889b9ff6147fce2f1`.
- [!] Continue with Electron 36; full audit remains 2 high/0 critical.
- [ ] No commit or push was performed.

## Electron 36 rung checkpoint (2026-08-23)

- [x] Electron 36.9.5 passed clean install, both 236/236 suites, error-free real
  GUI smoke, and CLI package verification under builder 26.15.7.
- [x] Artifact: 120,718,162 bytes, 3,012 entries, SHA-256
  `351606132afe19b9a326a97ddd03ced2e9a7d7fc4e0da0a5e656fdb841abb453`.
- [!] Continue with Electron 37; full audit remains 2 high/0 critical.
- [ ] No commit or push was performed.

## Electron 37 rung checkpoint (2026-08-23)

- [x] Electron 37.10.3 passed clean install, both 236/236 suites, error-free real
  GUI smoke, and CLI package verification under builder 26.15.7.
- [x] Artifact: 132,572,932 bytes, 3,012 entries, SHA-256
  `670a405b3fe9c9fca62c96aa27f9a9a1c6ae30e734958a7402c52459bd1d29b8`.
- [!] Continue with Electron 38; full audit remains 2 high/0 critical.
- [ ] No commit or push was performed.

## Electron 38 rung checkpoint (2026-08-23)

- [x] Electron 38.8.6 passed clean install, both 236/236 suites, error-free real
  GUI smoke, and CLI package verification under builder 26.15.7.
- [x] Artifact: 135,014,318 bytes, 3,012 entries, SHA-256
  `90f44ae12f0c635dd9695278e5cda8b72196a630c159800aad794b00af6efe78`.
- [!] Continue with Electron 39; full audit remains 2 high/0 critical.
- [ ] No commit or push was performed.

## Electron 39 rung checkpoint (2026-08-23)

- [x] Electron 39.8.10 passed clean install, both 236/236 suites, error-free real
  GUI smoke, and CLI package verification under builder 26.15.7.
- [x] Artifact: 135,188,465 bytes, 3,012 entries, SHA-256
  `8bfbccb1fc61c788be783b555b6aaccc67282984950c3271f6f7629290bcbfb0`.
- [!] Continue with Electron 40; full audit remains 2 high/0 critical.
- [ ] No commit or push was performed.

## Electron 40 rung checkpoint (2026-08-23)

- [x] Electron 40.10.6 passed clean install, both 236/236 suites, error-free real
  GUI smoke, and CLI package verification under builder 26.15.7.
- [x] Artifact: 136,628,515 bytes, 3,012 entries, SHA-256
  `0df3145c5300d56cd8816602c6b886edee24e575729c280b63592e2dd83c4be8`.
- [x] Full audit dropped from 2 high to 1 high: `extract-zip` is resolved and
  the Electron sandboxed-iframe OpenURL advisory remains.
- [!] Continue with Electron 41; full audit remains 1 high/0 critical.
- [ ] No commit or push was performed.

## Electron 41 rung checkpoint (2026-08-23)

- [x] Electron 41.10.6 passed clean install, both 236/236 suites, error-free real
  GUI smoke, and CLI package verification under builder 26.15.7.
- [x] Artifact: 141,208,106 bytes, 3,012 entries, SHA-256
  `dfabf0ba8130171ede887ee551d3b5ef80faaafb761f192607a56c556bde904f`.
- [x] Production and full audits both report 0 vulnerabilities.
- [!] Continue with Electron 42; only the remaining current-major ladder blocks
  the public binary release.
- [ ] No commit or push was performed.

## Electron 42 rung checkpoint (2026-08-24)

- [x] Electron 42.9.3 passed clean install, both 236/236 suites, error-free real
  GUI smoke, and CLI package verification under builder 26.15.7.
- [x] Artifact: 140,468,586 bytes, 3,012 entries, SHA-256
  `6d82279ae92f5c2bcf4152f703104cdce7ba4aa7e5ced43759da84d86650324e`.
- [x] Production and full audits both report 0 vulnerabilities.
- [!] Continue with the current Electron 43 rung.
- [ ] No commit or push was performed.

## Electron 43 current-major checkpoint (2026-08-24)

- [x] Electron 43.4.1 passed clean install, production/full audit 0, both
  236/236 suites, error-free real GUI smoke, and CLI package verification under
  builder 26.15.7.
- [x] Artifact: 148,287,234 bytes, 3,012 entries, SHA-256
  `2ad8bc19ddcc293c8917053a62fcaea5c9fe1b69d39bc30282ff25e0a8dcb4b3`.
- [x] Electron 23 through current 43 and electron-builder 22 through current 26
  ladders are complete; the supply-chain audit blocker is cleared.
- [!] Continue with the final clean release matrix, GUI package, deterministic
  release evidence, and exhaustive plan/DoD audit.
- [ ] No commit or push was performed.

## Electron and builder ladder checkpoint (2026-08-23)

- [x] Verified Electron 23.3.13 with builder 22, then moved electron-builder one
  major at a time through 23.6.0, 24.13.3, 25.1.8, and 26.15.7.
- [x] Every accepted rung passed clean `npm ci`, production audit 0, `verify`
  236/236, fixed-seed order 236/236, real Electron GUI security smoke, CLI ZIP
  build, package allowlist, and `E_REQUEST_INVALID`/exit1 smoke.
- [x] Builder 26.15.7 removed the critical `tar` and builder-family findings.
  Full audit is now 2 high/0 critical, both through Electron 23 and
  `extract-zip`.
- [x] Final builder artifact: 99,313,201 bytes, 3,012 entries, SHA-256
  `3f37eba78f409e0e02b257efa9ff228929b01ad053876f7eaee29ddb129669d6`.
- [!] Public binary release remains blocked while Electron 24 through the
  current major are validated one major at a time.
- [ ] No commit or push was performed.

## P3-P5 final integration and security audit checkpoint (2026-08-24)

- [x] P3 baseline-aware RPG reference validation now downgrades only reference
  damage also present in `Backup` to registered `*_BASELINE` warnings; new
  workspace-only damage remains blocking.
- [x] P4 applies RPG translation dictionaries inside the ASAR apply transaction
  and adds recover dry-run plus `backup-and-replace`/`fail-if-present` policies.
- [x] P5 fixes NW.js entry order, permissions, and timestamps and canonicalizes
  CLI ZIP order, DOS time, NTFS extra fields, and comments.
- [x] Final security review found that manifest `extractFile` paths could follow
  an intermediate junction. A RED regression reproduced the external write;
  every existing Extract/Backup/`.extracteddata` segment is now link-checked,
  and the targeted core/recovery/dictionary set passed 40/40.
- [x] Release ZIP validation now rejects Windows collisions after case folding,
  NFC normalization, and trailing-dot/space trimming.
- [x] Final `npm run verify` and fixed-seed `npm run test:order` both passed 47
  files/243 tests; generated 19 pairs, inventory, version, supply-chain, and
  whitespace checks report no drift/error.
- [x] All six benchmarks passed. Production and full npm audits each report 0
  vulnerabilities across 514 dependencies.
- [x] Two complete CLI builds are `fc /b` identical: 148,285,977 bytes, 76 ZIP
  entries, SHA-256 `73658e117b4e8bb479fc15277e0851d900e09e4a283339313ec8474378a4f8c6`.
  Package verification accepted 3,012 ASAR entries and
  `E_REQUEST_INVALID`/exit-1.
- [x] Two dirty-worktree evidence runs produced identical files:
  `release-manifest.json` `422ab8af84e5e6181792a3efbd048b2f285519b37b8126ecb2d67c545457cbfd`,
  `sbom.spdx.json` `353d25ee5267119e92415048f0240978369ef6a84d4b49b9ae21db956ba04e10`,
  and `SHA256SUMS` `81e69c35608d5a7f104db6610833845a3a49ea575cd112b15b446f0117b92139`.
- [x] Latest GUI portable is 109,353,724 bytes
  (`b16e71babddff31bfbb8f49e0125e70c91db99a3546e25d0fe8ab0490b9a48e5`)
  and installer is 109,563,216 bytes
  (`5ceff701435ae5d63ca9d4bc138636f07296e0c7be6003181040a4700944bddd`).
  Electron security/IPC smoke passed; packaged launch observed 4 processes,
  had no early exit, and left 0 processes after cleanup.
- [!] Evidence records `sourceTreeDirty: true`; hosted CI, clean-source evidence,
  representative manual gameplay, signing, and publication remain external
  release gates.
- [ ] No commit or push was performed.
