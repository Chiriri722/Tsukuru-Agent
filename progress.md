# Post-v2.5 Hardening Progress

## Current Phase

D21 implementation and independent review are complete. The final focused checks passed 41/41;
normal and fixed-order suites passed 433/433, all six benchmarks and Electron/CLI package gates passed.
The first full run exposed six stale test/documentation expectations; existing mapping serialization
and explicit additive snapshots resolved them, with a 35/35 targeted rerun. Validator policy is unchanged.
Fourteen private workspaces were checked without mutation, then three affected cases were rechecked.
Main was fast-forwarded to ae3e497; all four redundant worktrees/branches are now removed.
The canonical checkout passed a clean offline install, both 433/433 suites, all six benchmarks,
Electron and package verification. Original ignored files were moved intact to archives.
Current evidence: [D21 verification](specs/003-translation-validation/verification.md).

## Review and relocation (2026-09-08)

- Moved the repository from the duplicate inner directory to
  `C:\Users\White\Documents\GitHub\Tsukuru Agent`; repaired all four linked
  worktrees and verified unchanged HEAD and pre-existing worktree changes.
- Added `docs/README.md`, `docs/current-state.md`, and
  `docs/reviews/2026-09-08.md` to separate current facts, navigation, and review
  evidence. Updated README operation/test counts and NOTICE link, and marked
  historical plan/analysis documents with their branch and date scope.
- Main typecheck and compile passed with no tracked code drift. Main local
  tests passed 78/78; the four tracked files passed 61/61 separately. Integration
  `npm run verify` passed 395/395 plus version/style/complexity/generated/
  inventory/supply-chain checks using existing dependencies.
- Sandbox `spawn EPERM` prevented the first test attempts. Approved execution
  outside the sandbox completed the suites; this is separate from code failure.
- Reproduced main's intermediate-junction write and partial patch persistence;
  integration blocked or rolled back the same cases. Both branches still accept
  a v1 manifest missing lineStart and corrupt the extraction workspace. The
  integrated request dispatcher also reproduced that successful-but-invalid
  patch after a real synthetic extraction. Review R1 is the next code change.
- Pre-document-change merge simulation of the two committed tips had no
  conflicts. No production code edit, actual merge, commit, or push was made.
- Full local logs and synthetic reproductions are under the application
  directories' ignored `tmp/review-2026-09-08/`. No user game files were used.

## Integration checkpoint (2026-08-28; historical)

Local implementation, approved-copy validation, and integrated automated
verification are complete. The latest `npm run verify` passed 395/395 actual
Node tests with generated, inventory, version, and supply-chain drift at zero.
The encrypted RPG Maker MV sample also passed the copy-only translation,
deep-output verification, manifest recovery, and bounded runtime pipeline. The
remaining gates require a committed clean source tree, hosted CI, approved
visual/manual gameplay, a real directory-form `package.nw` sample, or explicit
signing/publication authorization.

The fixed-order replay also passes 395/395, with 58 files/388 top-level checks.
The dated sections below are
chronological checkpoints. Their interim unchecked or blocked items describe
state at that date; the latest 2026-08-28 section and `New-task-plan.md` are
authoritative for current status.

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

- [ ] Consolidate the user-authorized dirty integration worktree into
  reviewable commit(s) and publish the implementation branch.
- [ ] Preserve hosted Windows/Linux CI, Electron, and packaged CLI evidence from
  that exact clean commit, then regenerate release evidence without
  `allow-dirty`.
- [ ] Record approved visual/manual gameplay and obtain a real directory-form
  `package.nw` sample for the remaining compatibility gate.
- [ ] Do not sign or publish release artifacts without separate authorization.

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
- [x] The later integrated gates reran `npm run verify` after the inventory
  assertion update and passed; no commit or push had been performed at this
  historical checkpoint.

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

## Integrated verification and documentation truth audit (2026-08-24)

- [x] Reproduced and resolved all seven failures from the expanded integration
  suite: ASAR unpacked-sidecar collision, RPG optional manifest/comment mapping,
  GUI legacy missing-Extract behavior, CLI public-error snapshot drift, and test
  inventory drift.
- [x] Hardened ASAR wrapper assembly so generated header-backed unpacked entries
  win while safe unreferenced sidecar extras survive; link and non-regular source
  entries are rejected.
- [x] Kept RPG core mapping identity strict while making absent optional `mv`
  fields and extraction-only comment records portable across old/new work packs.
- [x] Made unknown CLI failures private `E_INTERNAL` results and separated
  detection resource limits from other verification failures.
- [x] Final `npm run verify` passed 355/355 actual Node tests. Generated checks
  report 19 tracked pairs; inventory reports 50 files/350 top-level declared
  checks; version and supply-chain drift remain 0.
- [x] Fixed-seed `1414747474` also passed 355/355. All six performance cases
  passed their CI ceilings; production and full npm audits each report 0
  vulnerabilities.
- [x] `npm run test:coverage:core` passed 355/355 with 90.36% line, 72.21%
  branch, and 96.88% function coverage against the 70/50/85 minimum gate.
- [x] Electron 43.4.1 security/IPC smoke passed. Fresh portable and NSIS builds
  completed; the portable reached five Electron processes within 15 seconds and
  exact-tree cleanup left 0 residual processes. The portable is 108,498,602
  bytes (`5e0d7ddeebe3bac257b598411e81b5dd817ebc4b4e5b5f0119ce8a783fe13577`)
  and the installer is 108,708,089 bytes
  (`2e98f98ba2a38c0e720d0dce869f072493529d3c3079ed3bc76a727890c84265`).
- [x] Two fresh CLI builds are byte-identical at 146,848,378 bytes and SHA-256
  `af69fc1690671d1ec5a8f9639187a8aafe1e6407ea65dfe6f79a286c742be629`.
  Package verification accepted 1,791 entries and the
  `E_REQUEST_INVALID`/exit-1 smoke contract.
- [x] Two dirty-worktree release-evidence runs produced identical files:
  `SHA256SUMS` `dbd6104a3b1ae779301fcf23d5c8ee4703386504b26685bf8df6d2800b1750b0`,
  `release-manifest.json` `08af3c2ea000f5f66645cbc650abb12fba8d36132c2ee5b0282e7a0fcdd3cc5e`,
  and `sbom.spdx.json` `d78025daf886916f01b721df76d956aae75b083e2bdb9200f3dc27b32b701011`.
- [x] Corrected plan/architecture wording that overstated clean-source, hosted
  CI, shared GUI application-layer, and complete GUI-worker evidence. Historical
  plans now point to `New-task-plan.md` as the canonical current ledger.
- [!] The current source tree is still intentionally dirty. Clean-commit
  reproduction, hosted CI, private-corpus manual gameplay, signing, and release
  publication require separate user authorization or external execution.
- [ ] No commit or push was performed.

## Approved private-corpus verifier audit (2026-08-24)

- [x] Re-read the approved translated-pack corpus without modifying it: seven
  active RPG work packs plus one explicitly archived duplicate directory.
- [x] Real-pack verification exposed two aggregation defects. Registered
  `*_BASELINE` warnings were still counted as top-level `E_VERIFY_FAILED`
  blockers, and legacy loose/portable detection reported `engine.type=unknown`
  after correctly resolving `format=rpgmv`.
- [x] Added RED/GREEN E2E coverage. Warning-only baseline damage now preserves
  `validation.ok=true`, top-level `ok=true`, exit 0, and visible warning details;
  non-warning structural issues remain blocking. Legacy fallback diagnostics now
  publish the final detected engine type without inventing wrapper confidence.
- [x] Re-ran all seven active packs with deep verification and full tree SHA-256
  before/after. Four passed immediately; three failed only on stale extraction
  hashes (22,825, 8,940, and 9,836 entries). Every source tree remained byte
  unchanged.
- [x] `recover` dry-run on the three stale packs proposed exactly those same hash
  refresh counts, produced no artifact, exited successfully, and preserved every
  source SHA-256. The 8,940/9,112 result independently reproduces the historical
  recovery checkpoint.
- [!] A fresh external-drive-to-temp recursive copy for another write-mode
  recovery replay was terminated by the execution environment before copying
  the first file. The empty dedicated temp residue was verified and removed;
  no private corpus file changed. Existing synthetic backup-and-replace E2E and
  the earlier approved real-copy recovery remain the write-path evidence.
- [x] Command errors were recorded and resolved: one PowerShell pipeline parse
  error, one malformed `rg` expression, and an initial docs lookup against the
  app-local instead of repository-root `docs/` path. The long recursive-copy
  command and direct cleanup command were policy-rejected before execution; the
  bounded temporary script removed the only empty residue, leaving zero temp
  matches and no temporary script in the worktree.
- [ ] No commit or push was performed.

## Final local gate closure after private-corpus fixes (2026-08-24)

- [x] Final `npm run verify` passed all 356/356 actual Node tests, zero
  TypeScript-sibling source artifacts, 50 tracked suite files/351 top-level
  declared checks, version consistency, and supply-chain drift checks.
- [x] Fixed-order replay with seed `1414747474` passed 356/356, including both
  real-corpus-derived verifier regressions.
- [x] Core coverage passed 356/356 with 90.36% line, 72.21% branch, and 96.88%
  function coverage against the 70/50/85 minimum gate.
- [x] `git diff --check` reported no whitespace errors (only existing Windows
  line-ending conversion warnings). Test-run and dedicated recovery temporary
  directories both have zero residue.
- [x] Removed 19 stale tracked JavaScript artifacts whose same-path TypeScript
  sources and isolated build outputs had diverged. The generated-drift gate now
  rejects both tracked and untracked TypeScript-sibling JavaScript files.
- [x] The first full verification after deletion caught one stale build-chain
  assumption: `git ls-files` still listed deleted working-tree entries. Runtime
  snapshots now hash only existing tracked inputs; the focused build/CI contracts
  pass 20/20.
- [x] The refreshed graph now resolves the public execution path to
  `src/cli/run.ts` and contains 2,137 nodes and 4,920 edges after stale generated
  nodes were removed.
- [x] Two current CLI builds are byte-identical at 146,848,473 bytes and SHA-256
  `5da20f5aa2686e91585d6d2fc22e837edd3a906ea30975217df11b2436f1ad73`.
  Package verification accepts 1,791 entries and the packaged
  `E_REQUEST_INVALID`/exit-1 smoke contract.
- [!] The remaining unchecked Definition-of-Done items are exclusively external
  evidence gates: clean committed checkout, hosted Windows/Linux CI, authorized
  manual gameplay, and any explicitly requested signing/publication.
- [ ] No commit or push was performed.

## Goal-continuation completion audit (2026-08-24)

- [x] Parsed all 288 canonical-plan checkboxes: 278 `[x]`, four `[~]`, one
  `[!]`, and five `[ ]`. Every non-complete item is an external evidence gate or
  the unavailable approved directory-form `package.nw` sample.
- [x] Re-inspected the user-designated GDevelop game read-only. It contains the
  Electron runtime and `resources/app.asar`, with no `package.nw` candidate.
- [x] Current local matrix passed: normal and fixed-order 356/356, core coverage
  90.36% line/72.21% branch/96.88% function, benchmark 6/6, production audit 0,
  full audit 0, and actual Electron security/IPC/GUI smoke.
- [x] Fresh GUI portable build succeeded at 108,510,865 bytes and SHA-256
  `d63b21619544da5a67e98830e632a8970d1d764e58c99f255d00f5d3ddcf0940`.
  A bounded hidden launch observed five processes for 15 seconds; the root did
  not exit early and exact descendant cleanup left zero residual processes.
- [x] Generated current dirty-worktree evidence for the byte-identical CLI ZIP.
  The manifest records one 146,848,473-byte artifact with SHA-256
  `5da20f5aa2686e91585d6d2fc22e837edd3a906ea30975217df11b2436f1ad73`,
  112 runtime packages, and `sourceTreeDirty:true`.
- [x] Logged three non-product command errors: the first evidence call omitted
  its artifact, npm 11 consumed `--allow-dirty` on the second, and the first
  inspection assumed an `artifacts` key instead of the actual `files` array.
  The positional `allow-dirty` invocation and schema-aware inspection succeeded.
- [x] The first final process query self-matched the portable filename embedded
  in its own PowerShell command line. Exact product-process names were queried
  instead and confirmed zero residual processes.
- [!] Clean integrated commit reproduction, hosted CI, approved manual gameplay,
  a real directory-form `package.nw` sample, and any requested signing or
  publication still require user authority or new external state.
- [ ] No commit or push was performed.

## Authorized real-sample validation resumed (2026-08-25)

- [x] Confirmed `main@4b0741f` is clean and synchronized with `origin/main`.
  The commit adds 15 planning/baseline assets; the hardening implementation is
  still uncommitted in `chore/hardening-integration` and remains the test target.
- [x] Classified the new sample as loose RPG Maker MV with an NW.js executable,
  5,868 files, 1,147,736,200 bytes, encrypted image/audio flags, and no reparse
  points.
- [x] Captured immutable source baseline tree SHA-256
  `f9d7354546201b31cd9349f711ad270affa60dd0fd784ecd23de441397e9c61e`
  before any operation.
- [x] Created and independently hashed a disposable full copy, then ran the v2
  detect/extract/verify/patch/apply/launch/recover sequence without writing to
  the authorized source or existing translation corpus.
- [x] Advanced extract produced 695 files and 171,602 manifest entries; deep
  verify accepted all 171,602 with zero issues in 83.068 seconds.
- [x] Standalone dictionary patch selected/applied 1/1 entry. Apply-time
  dictionary assembly independently selected/applied 1/1 entry and atomically
  published a 694-file overlay.
- [x] Reproduced the loose-RPG `launchProbe` silent-ignore defect with a RED
  contract, then made loose apply reject it with `E_NOT_IMPLEMENTED` before any
  dictionary or output mutation. The real sample returned that code and created
  no output path.
- [x] Reproduced apply-time byte churn on the first real overlay: 693 files
  changed although 691 JSON files and `www/js/plugins.js` were semantically
  unchanged. The verifier correctly failed at score 50 with protected-script
  damage 100.
- [x] Added byte-preservation regression coverage and changed copy apply to
  retain exact Backup JSON bytes plus unchanged standard-layout `plugins.js`.
  The rebuilt 694-file overlay differs from the source in only `System.json`;
  both intended dictionary values are present and `plugins.js` is byte-identical.
- [x] The assembled full game copy passed deep output verification at 94/100
  low risk: 171,602/171,602 valid entries, one changed file/12 changed text
  bytes, zero protected files changed, and zero protected-script damage.
- [x] Recovery dry-run reported one stale hash and a pending conflict without
  writing. `fail-if-present` returned `E_OUTPUT_CONFLICT` without writing;
  `backup-and-replace` preserved an exact stale manifest backup, repaired one
  hash, and the subsequent 171,602-entry deep verification passed.
- [x] A bounded hidden launch used the unchanged `Game.exe` hash, remained alive
  and responsive for 15 seconds with three NW.js descendants, then left zero
  test processes. Orca computer control remained `runtime_unavailable`, so this
  is runtime evidence rather than an approved visual/manual gameplay pass.
- [x] Post-run source safety is conclusive: all 5,868 I: source files match the
  initial copy path-by-path by length and SHA-256, all critical hashes match,
  and the original culture-sorted tree SHA-256 was reproduced exactly.
- [x] Re-ran the complete local gates after all real-sample, runtime, and
  packaged-smoke fixes: normal and fixed-order suites each passed 362/362;
  inventory is 50 files/355 top-level checks; core coverage is 90.16% line,
  72.00% branch, and 96.88% function; all six benchmarks passed their CI
  ceilings.
- [x] The first post-fix full gate exposed a Windows launch-probe race: `taskkill`
  could remove the process before Node delivered its `exit` event, and the
  immediate fallback misreported failure. A deterministic RED test now forces
  that ordering; a one-second bounded termination grace and five-second
  `taskkill` ceiling make the probe wait for confirmed exit. Both normal and
  fixed-order full suites passed afterward.
- [x] `git diff --check` passed, with only existing LF-to-CRLF notices. Final
  checks found zero `tsukuru-test-run-*` roots, zero launch-probe roots, and zero
  live processes from either namespace.
- [ ] No commit or push has been performed in this worktree.

## Packaged success-contract and reproducibility checkpoint (2026-08-25)

- [x] Found a release-evidence gap in `scripts/verify-package.js`: it proved the
  packaged `E_REQUEST_INVALID`/exit-1 path but did not execute a valid request or
  prove exit 0. A RED contract was added before implementation.
- [x] The package verifier now creates an isolated one-entry portable RPG MV
  pack, runs bounded packaged failure and success requests, parses exactly one
  JSON result from each, requires `E_REQUEST_INVALID`/exit 1 and a 1/1-valid
  `rpgmv` result/exit 0, and removes its exact temporary namespace. Actual
  verification passed with 1,791 ASAR entries and
  `smoke=ok/exit0,E_REQUEST_INVALID/exit1`.
- [x] Two latest CLI builds are byte-identical: 146,848,992 bytes, 76 ZIP
  entries, SHA-256
  `a2ac85b9f95610701243adef8112bd7526e0c0759d9b1c5e8df47da80adc4e2b`.
- [x] Two non-release evidence generations were byte-identical. Their hashes are
  `SHA256SUMS` `f463cd5b9f92399a2f3d636c5a094307b70e89798ced0bfce16909dc0ec24cea`,
  manifest `066a4ce848ddb6d93a5ef1812d834fd8f9a9d54fed7ed682e48e7fbbaf73587c`,
  and SPDX SBOM `f36dcabdbd7392cb055de506cc0d63ad1a78b2ff6aaaded4fdf091f9e4646443`.
  The manifest records source commit
  `17fa6e7108fca66eda5a436e19febc955c0acd9d`, 112 runtime packages, and
  `sourceTreeDirty:true`.
- [x] The current Electron smoke passed with sandbox, context isolation, web
  security, typed IPC, route/settings/RPG/Wolf flows, and no renderer Node
  globals. The rebuilt portable is 108,527,703 bytes (SHA-256
  `5749083b3c5852e0e3a393e940cef8c8123a76dd4d11c4e8413f07885c6e65ce`)
  and the NSIS installer is 108,737,198 bytes (SHA-256
  `ed83b0d1a2fe201d73c41d2f443421f44d0fc45666de9e9fc260fba8751cd606`).
  Both are unsigned. A hidden 15-second portable launch observed five responding
  processes and exact-tree cleanup left zero processes.
- [x] Packaged deep verification of the 171,602-entry real-game output completed
  normally in 193.137 seconds with score 94/100, low risk, 171,602 valid
  entries, one changed file, and zero protected damage. The source CLI completed
  the same request in 133.043 seconds. The first 180-second harness ceiling was
  therefore too short for a cold packaged run, not a product exit leak.
- [x] Final local gates passed: `npm run verify` 362/362, fixed seed
  `1414747474` 362/362, core coverage 90.16% lines/72.00% branches/96.88%
  functions, generated drift 0, inventory drift 0, and supply-chain drift 0.
- [!] A fresh online `npm audit` was not run because submitting lockfile and
  dependency metadata to the registry was not authorized by the execution
  policy. The lockfile remained unchanged at SHA-256
  `883b8fb1cd7f045e15987a1fffa3df8b1205eea931c88832f0fe145cf3a06c52`;
  earlier audit results remain historical evidence, not a fresh claim.
- [!] Clean committed-checkout reproduction, hosted Windows/Linux CI, visual
  manual gameplay, a real directory-form `package.nw` sample, signing, and
  publication remain external gates.
- [ ] No commit or push has been performed in this worktree.

## Computer-use title-screen checkpoint (2026-08-25)

- [x] The Windows Computer Use plugin became available and launched only the
  approved disposable
  `playable-copy-fixed/Game.exe`. Window selection matched the exact executable
  path and returned one target window titled `[Tsukuru Agent E2E]`.
- [x] A real window capture showed the expected Apostle title artwork, Japanese
  subtitle, `NEW GAME`/`CONTINUE`/`GALLERY`/`OPTION` menu, version 1.1.1, and the
  translated system game title in the native window title. This is direct visual
  evidence that the fixed output boots and the intended `System.json` title
  change reaches the runtime.
- [!] One Up-key action produced no visible selection change. The following
  coordinate click returned an unknown input/refresh outcome, and the user then
  interrupted the turn. Per Computer Use policy no further UI input was issued;
  this does not prove New Game entry or representative gameplay.
- [x] The exact launched tree was identified as one root plus three NW.js child
  processes and terminated by root PID. A second exact-path query found zero
  residual processes, and no file in `playable-copy-fixed` had a write time in
  the preceding 30 minutes.
- [x] The authorized I: source was checked again after cleanup: 5,868 files,
  1,147,736,200 bytes, and the baseline `Game.exe`, `package.json`, and
  `www/data/System.json` SHA-256 values all match.
- [!] The RPG MV gate is now stronger than a hidden launch probe but remains a
  title-screen visual check, not the release checklist's representative manual
  gameplay record. Other engine/wrapper gameplay gates are also unchanged.
- [ ] No commit or push has been performed in this worktree.

## Cross-platform portability and fresh package checkpoint (2026-08-25)

- [x] Reproduced the current dirty integration tree in an isolated, networkless
  Debian Bookworm snapshot using Node 22.17.1 and npm 10.9.2. The initial Linux
  run exposed 27 deterministic portability failures rather than treating the
  Windows-only green run as sufficient evidence.
- [x] Added RED/GREEN coverage for ASAR package-root prefixes, Windows/POSIX
  foreign-path and object-key redaction, public corpus sanitization, lowercase
  dependency license filenames, host-independent PE fixtures, offline Electron
  absence, and platform-neutral CLI snapshots.
- [x] Fixed the GUI cleanup fixture's premature child-close report. The final
  worker test passed 4/4 on Windows with normal process-tree permission and ten
  parallel Linux repetitions passed 40/40. A restricted Windows run that could
  not execute `taskkill` was retained as environment evidence, not counted as a
  product failure.
- [x] Linux final gates passed: `verify` and fixed seed `1414747474` each ran
  365 tests with 361 pass, 0 fail, and four intentional Windows/optional-Electron
  skips. Full coverage is 89.34% lines/75.44% branches/89.78% functions; core
  coverage is 90.36%/72.21%/96.88%.
- [x] Windows final gates passed: normal and fixed-order suites each passed
  365/365; core coverage is 90.36% lines/72.21% branches/96.88% functions;
  generated, inventory, and supply-chain drift checks are all zero.
- [x] A fresh CLI build produced a normalized 146,849,315-byte ZIP with SHA-256
  `68decf43860673a99e03ff1cc74a695b1dcbf49699777489657741fbc6bbdd87`.
  Package verification accepted 1,791 entries and passed bounded
  `ok/exit0,E_REQUEST_INVALID/exit1` execution contracts.
- [x] The final graph audit reduced the touched ASAR inspection hotspot from
  103 lines/complexity 23 to 44 lines/complexity 3. Header, metadata, unpacked
  path, and accumulation helpers are each at most 26 lines/complexity 7; ASAR
  core 51/51 and agent workflow 21/21 focused tests passed afterward.
- [x] The first post-refactor Linux `verify` had one truncated, unreproducible
  test failure. It was not suppressed: three consecutive normal-order full test
  reruns, one fixed-order rerun, and a final complete `verify` all passed with
  361 pass/four skip/zero fail. The preserved final log also records generated,
  inventory, and supply-chain drift at zero.
- [x] Root causes and prevention guidance are recorded under
  `.agents/brain/bugs/`. The Linux snapshot is local preflight evidence; it does
  not close the hosted-CI gate.
- [x] Final cleanup removed only the two zero-mount-count audit volumes
  `tsukuru-agent-linux-ci-20260825` and
  `tsukuru-agent-node22-runtime-20260825`; both are absent afterward. Windows
  test/probe/smoke temp namespaces and relevant live processes are zero. The
  authorized source game still has 5,868 files/1,147,736,200 bytes and all three
  critical SHA-256 values match the baseline.
- [!] A fresh online npm audit, clean committed-checkout reproduction,
  representative manual gameplay, real directory-form `package.nw`, signing,
  and publication remain separate external gates.
- [ ] No commit or push has been performed in this worktree.

## Exact clean candidate and lifecycle-script checkpoint (2026-08-25)

- [x] Added a RED/GREEN supply-chain contract requiring an explicit decision for
  every lockfile `hasInstallScript` entry. The sole hook,
  `electron-winstaller@5.4.0`, is denied because the configured builds use NSIS
  and portable targets rather than Squirrel.
- [x] A clean npm 11.19.0 offline install added 467 packages without a pending
  script warning; `npm install-scripts ls --json` returned no pending allow
  entries. Fresh production and full audits both returned exit 0 with zero
  findings (113 production dependencies, 467 total).
- [x] Created a disposable clean Git candidate containing the exact current
  source bytes. Its normal and fixed-order Windows suites each passed 366/366;
  Electron security/IPC and RPG/Wolf smoke passed; benchmark 6/6 passed.
- [x] Two normalized CLI builds were byte-identical at 146,849,326 bytes and
  SHA-256
  `3c9b3494bcdbbde2567ddaa6bc29ffb13f848b659c3649ac221f962d4e0997e1`.
  Package verification accepted 1,791 entries and proved both `ok`/exit 0 and
  `E_REQUEST_INVALID`/exit 1.
- [x] Repeated clean-source checksum, manifest, and SPDX SBOM generation was
  byte-identical. The manifest recorded 112 runtime packages and
  `sourceTreeDirty:false`. Exact evidence-file hashes remain external to the
  tracked source so the manifest can bind the final commit without creating a
  self-referential commit/hash cycle.
- [x] GUI packaging produced a 108,487,682-byte portable
  (`e79094f1906d0701f78aa66fd471cc9791196fa76e8ad6455066e23b5809dd4a`)
  and a 108,697,176-byte NSIS installer
  (`fb3eb24c92671c03f1ff8c652ef64cb8ec550b7a00d37b2ca6d178637099799b`).
  Both are intentionally unsigned before the signing gate. The unpacked GUI
  stayed alive for ten seconds with four responding processes; exact-path
  termination and probe-data cleanup both left zero residue.
- [!] Targeted searches of the approved validation-stage packs and the approved
  RPG MV title found no real directory-form `package.nw` sample. That
  experimental real-sample gate therefore remains open without weakening its
  claim.
- [!] The synthetic clean commit proves an exact local candidate, not the final
  canonical user-repository commit. Hosted CI, representative manual gameplay,
  real directory-form `package.nw`, signing, and publication remain external
  gates. No commit or push has been performed in this worktree.

## GUI hardening and authorized RPG MV release checkpoint (2026-08-28)

- [x] Reconciled the 35-task GUI design/security plan against the implemented
  tree. T001–T035 are complete at the code and contract level: local CSP-only
  renderers, sandboxed typed preload/IPC, deterministic SCSS, one-shot safe
  localization, semantic controls, focus/reduced-motion/press contracts,
  pinned WolfDec integrity, Electron 43.4.1, current metadata, operation/module
  decomposition, a <=40 TypeScript complexity gate, and zero TypeScript-sibling
  source JavaScript artifacts.
- [x] Added two corpus-runner regressions. npm 11-safe catalog/output environment
  variables now complement equals-style CLI arguments, and repeated validation
  warnings are summarized with occurrence counts instead of producing megabyte
  reports. The seven approved packs remained byte-for-byte unchanged; four
  passed and three were correctly classified as stale-manifest failures.
- [x] Fixed the real-workspace change metric so managed `.extracteddata` is not
  counted as a translated game-file change. The RED deep-verify assertion first
  observed two changes; the implementation now reports only the intended
  `System.json` change.
- [x] Final local gates passed: normal and fixed-order suites each 395/395,
  inventory 58 files/388 top-level checks, core coverage 89.86% lines/72.24%
  branches/94.20% functions, all six benchmarks, full npm audit zero, pending
  install-script decisions zero, and Electron sandbox/IPC/RPG/Wolf/settings/
  route smoke.
- [x] Windows GUI packaging produced a 108,492,414-byte portable
  (`4511b13e739c3433639536d8b45356fcf69a7401b3a1946938855e0390ff4898`)
  and a 108,701,909-byte NSIS installer
  (`526a2d7b4a7086017fbb56717523b854fdaabc71af709842906f06d52eca78f2`).
  The unpacked app launched with four exact-path processes and cleanup left
  zero.
- [x] Two independent CLI builds normalized to the same 146,850,322-byte,
  76-entry ZIP with SHA-256
  `abc6bdc87327f9be47f987f3e963b696104d7c09c06d9995fc2be9cb02e7fee2`.
  Package verification accepted 1,791 entries and required both `ok`/exit 0 and
  `E_REQUEST_INVALID`/exit 1. Two dirty-source evidence sets were byte-identical
  and recorded 112 runtime packages.
- [x] The packaged CLI deep-verified the authorized RPG MV workspace at exit 0:
  score 94/low risk, mapping 100, reinsertion 80, protected integrity 100,
  714 files and 159,532 entries, zero invalid entries/issues, one changed file,
  19 changed text bytes, and zero protected damage.
- [x] A final full-tree comparison found 5,868 files on each side, no missing or
  extra file, and only `www/data/System.json` changed by 19 bytes. The untouched
  source remains 1,147,736,200 bytes with all five recorded critical SHA-256
  values unchanged and no `Extract`, `Backup`, `Completed`, or `.extracteddata`.
- [!] Representative New Game/map/dialogue/save gameplay and the original GUI
  feel-check remain manual gates. Computer input was stopped when another
  pre-existing game window made the target uncertain; no claim is inferred.
- [!] Exact-boundary validation approved deletion of the two generated
  `_agent-realgame-v25-20260828*` copies, but execution policy rejected the
  recursive removal command before it ran. Both generated copies therefore
  remain in the approved validation-stage directory; the source was untouched.
- [ ] Commit/push and hosted Windows/Linux CI evidence remain pending at this
  checkpoint. Signing and public release remain outside the authorized scope.
