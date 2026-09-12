# Post-v2.5 Hardening Findings

> 2026-09-08 review: [current findings and reproductions](docs/reviews/2026-09-08.md) distinguish main from the committed hardening integration branch. The baseline and dated entries below remain historical evidence. Current paths, verification, and next steps are in [current-state.md](docs/current-state.md).

## Scope

- Proposal: `New-task-plan.md`
- Baseline commit: `17fa6e7` (`v.2.5.01`)
- Application root: `tsukuru-agent/`
- Evidence rule: current working tree and clean checkout results are reported separately.

## Confirmed Before Clean-room Reproduction

| Item | Working-tree evidence | Status |
|---|---|---|
| Package version | `package.json` = `2.5.0` | confirmed |
| Legacy version file | `version.json` = `2.1.0` | confirmed mismatch |
| Package metadata | package name/repository still point at the original project identity | confirmed |
| Lockfile | `package-lock.json` exists physically but is ignored and untracked | confirmed |
| Tracked tests | 4 `test/v25-*.test.js` files | confirmed |
| Physical tests | 10 files: 4 tracked tests plus 6 ignored smoke scripts | confirmed |
| CI | no tracked GitHub Actions workflow | confirmed |
| Build scripts | `build` and `build:cli` do not run compile first | confirmed |
| Local runtime | Node `v24.14.0`, npm `11.19.0` | confirmed |

## Interpretation

- The proposal correctly identifies reproducibility and repository-truth problems.
- The existing “78 tests pass” record is valid for the populated developer worktree, but it is not yet proof of clean-checkout coverage because six smoke scripts are ignored.
- Phase 0 evidence must land before lockfile/version/build-pipeline changes, or the before/after comparison will be contaminated.
- `task_plan.md` already contains the historical implementation record through v2.5, so it remains the progress source of truth. `New-task-plan.md` is retained as the external proposal rather than replacing history.

## Lockfile-only Result

- Isolated worktree/branch:
  `C:/Users/White/Documents/GitHub/.worktrees/Tsukuru-Agent/hardening-lockfile`
  on `chore/hardening-lockfile`, based on exact commit `17fa6e7`.
- Canonical generation environment: Node `v24.14.0`, npm `11.19.0`.
- `package.json` stayed byte-identical at SHA-256
  `4B9A226A1A1FB8BEF82D4082F138CA5C078C6B5B14623B699C8AC333F47525E5`.
- A fresh `npm install --package-lock-only` produced lockfile v3 with 624
  package records and SHA-256
  `1EEEC942B8EE190A04892C26BD7FBD79B982A8AB38DA79C096A8721F32A37051`.
- The ignored developer lock remains unchanged at 627 records and SHA-256
  `463BB87330CA02987F49E891CCAA1A791E89F3DC8FEE775A37D8B4037F03A4E1`.
- The fresh graph hoists one `es-abstract@1.24.2`; the developer lock has four
  nested copies instead. Resolved versions also move within existing semver
  ranges: `@types/node` 26.1.2→26.2.0, `@xmldom/xmldom` 0.9.10→0.9.11,
  `resedit` 1.7.0→1.7.2, and `ws` 8.21.1→8.21.3.
- The review unit contains only `.gitignore` removing the lock exclusion and
  the newly generated `package-lock.json`; no dependency declaration, version,
  product code, build script, or CI file changed.
- `npm ci` from this lock added 612 packages and audited 613. It reproduced the
  existing 23 findings (7 moderate, 14 high, 2 critical), deprecation warnings,
  and npm 11's unapproved Electron postinstall warning. Security upgrades stay
  outside this reproducibility-only unit.
- Exit checks passed: typecheck, compile, tracked tests 61/61, CLI package,
  required RPG/Wolf/Tyrano/GDevelop service entries, invalid JSON
  `E_REQUEST_INVALID`/exit 1, missing path `E_PATH_NOT_FOUND`/exit 1, extract
  43 entries/exit 0, and schema v1/v2 verify score 75/exit 0 with identical
  result JSON.
- CLI ZIP: 98,355,070 bytes, SHA-256
  `5FDB311EB0AB88AF519DB2AD885AC54F9A7D6F31272B4FC6A4CAE0BB609B6CB2`.

## Build-chain Result

- Isolated worktree/branch:
  `C:/Users/White/Documents/GitHub/.worktrees/Tsukuru-Agent/hardening-build-chain`
  on `chore/hardening-build-chain`, based on exact commit `17fa6e7`.
- The canonical lock from the lockfile-only worktree was copied as an ignored
  setup artifact. Its SHA-256 remained
  `1EEEC942B8EE190A04892C26BD7FBD79B982A8AB38DA79C096A8721F32A37051`;
  dependency and devDependency declarations stayed identical to the baseline.
- TDD fixed the build boundary with eight new regression cases. They cover
  target-specific compile ordering, output cleanup allowlisting, staged
  development launchers, serialized staging mutation, isolated TypeScript
  output, staged test imports, source hash preservation, and GUI/CLI package
  entry-point selection.
- TypeScript now emits to `.build/app` through `tsconfig.build.json` with
  `rootDir: .`, `outDir: .build/app`, and `noEmitOnError: true`. The staging
  script copies only runtime static assets and writes target-specific package
  metadata. Compile no longer changes tracked `main.ts`, `main_update.ts`, or
  `src/**/*.ts/js` files.
- `build`/`build2` prepare GUI metadata and clean only `dist`; `build:cli`
  prepares CLI metadata and cleans only `dist-cli`. The cleanup helper rejects
  every other target path.
- Both packagers consume a single FileSet rooted at `.build/app`. Removing the
  legacy exclusion-only `win.files` was necessary because electron-builder
  interpreted it as another default-root input and reintroduced `dist-cli` and
  `.build`.
- Final `CLI → GUI → CLI` verification passed. The two CLI ASARs were byte
  identical across order: 24,779,876 bytes, 5,217 entries, SHA-256
  `9722EA55FA34C38CD5E343147C6EF89FE51E7A81BD4E7E2E568FF04419FB1CA8`,
  entry-list SHA-256
  `E6C13D3AAE679017664A1080D518210D28A9AFCAEA4439E9430AB2679648571E`,
  and zero root `dist`/`dist-cli`/`.build` entries.
- The final GUI ASAR is 29,698,494 bytes with 5,256 entries, main `main.js`,
  and zero output-tree entries. This replaces the baseline 740,468,101-byte
  CLI-contaminated ASAR. The portable GUI is 70,158,796 bytes.
- Packaged CLI contracts passed: invalid JSON `E_REQUEST_INVALID`/exit 1,
  missing path `E_PATH_NOT_FOUND`/exit 1, extract 43 entries/exit 0, and schema
  v1/v2 verify score 75/exit 0. The GUI unpacked executable stayed alive for
  the five-second launch window; its launched process tree terminated cleanly.
- Final verification: typecheck pass and tracked tests 69/69. No dependency,
  version, repository identity, product TypeScript, commit, or push change was
  included.

## Clean-room Results

- Detached worktree: exact commit `17fa6e7108fca66eda5a436e19febc955c0acd9d`.
- Pre-install state: no node_modules, lockfile, dist, or dist-cli; 55 TS and 21
  tracked JS files under `src/`.
- `npm install`: success, 612 packages added; 23 audit findings (7 moderate,
  14 high, 2 critical). npm 11 did not auto-approve Electron's install script.
- `npm run typecheck`: pass before compile.
- `npm test` before compile: 45/46 pass. `v25-cli.test.js` fails because
  `src/js/rpgmv/RpgMakerService.js` does not exist.
- `npm run build` before compile: fails because packaged `main.js` is absent.
- `npm run build:cli` before compile: exits 0 and creates a ZIP, but omits
  RPG/Wolf service modules; its executable emits no JSON and remains alive.
- `npm run compile`: pass; JS count 21→57 and all required engine services are
  emitted as ignored files.
- `npm test` after compile: 61/61 pass in tracked-only checkout.
- `npm run build` and `npm run build:cli` after compile: pass.
- Packaged CLI after compile: success verify exit 0, invalid JSON
  `E_REQUEST_INVALID` exit 1, missing path `E_PATH_NOT_FOUND` exit 1; each
  stdout parses as one JSON object and stderr is empty.
- Required package entries confirmed: CLI, validator, RPG/Wolf/Tyrano/GDevelop
  services, LICENSE, NOTICE.md, and THIRD-PARTY-NOTICES.

## Baseline Split

- Tracked-only checkout: 4 test files, 61 cases after compile.
- Local augmented worktree: 10 test files, 78/78 pass on 2026-08-19.
- The six local-only test files have no reachable Git history. Two unreachable
  historical commits were also checked and do not contain them.
- The ignored local lockfile has 627 package records; clean `npm install`
  generated 624. Root declarations match, resolved versions/placement do not.
- A clean checkout with the ignored lock completed `npm ci` and reproduced the
  same pre/post-compile test and package behavior. It added 615 packages and
  audited 616, versus 612/613 for the clean unlocked install.

## Build-order Contamination

- The GUI package configuration excludes `dist/*` but not `dist-cli/**`.
- Building GUI after CLI produced a 740,468,101-byte ASAR with 77 CLI-distribution
  entries, including the CLI ZIP and Electron runtime.
- Removing only `dist-cli` and rebuilding produced a 34,974,465-byte ASAR with
  zero such entries.
- Running GUI and CLI builders concurrently also caused a transient ENOENT as
  the GUI packager scanned CLI temporary files. Packaging must be sequential or,
  preferably, use explicit mutually exclusive input allowlists.

## External Binary Finding

- Three executables under `exfiles/` were hashed without execution.
- Adjacent MIT license files exist for the eztrans and translation-engine
  bundles.
- The package includes `exfiles/**`, but NOTICE.md and THIRD-PARTY-NOTICES do
  not name those bundles. This is a later notice-consolidation task.

## Joint Review Decision

Sol Pro reviewed the local evidence in the existing conversation and recommended
that the first change end at baseline evidence only. Lockfile, build-chain,
version/identity, and CI changes should follow as separate review units in that
order. This matches the locally reproduced package failure modes.

The final checkpoint review marked the evidence-only change approvable with no
additional blocking evidence. It specifically requires the successful-but-
incomplete CLI ZIP to remain a separate finding from the missing compile step,
and limits the next lockfile change to dependency reproducibility rather than
claiming to fix packaging.

## Browser Collaboration Notes

- Existing conversation: <https://chatgpt.com/c/6a7fffad-d58c-83e9-9c41-e78bbac9d3ec>
- The conversation, signed-in Pro profile, and selected Pro model were verified before sending the local evidence summary.
- `agbrowse web-ai` 0.2.0 could inspect the page but rejected mutation during provider-surface preflight. The request was sent through the regular browser path after re-verifying the exact conversation and model.
- Pro's response distinguishes `tracked baseline` from `local augmented
  baseline`, requires the six local-only hashes to be recorded, and explicitly
  excludes lockfile/version/build/CI from the first evidence change.

## Version/identity Result

- Isolated worktree/branch:
  `C:/Users/White/Documents/GitHub/.worktrees/Tsukuru-Agent/hardening-version-identity`
  on `chore/hardening-version-identity`, based on exact commit `17fa6e7`.
- Local Git evidence has only the `v2.0.0` tag. `v.2.5.01` is the baseline
  commit subject, while `package.json`, the v2.5 plan, release notes, and prior
  ZIP all identify release `2.5.0`. The canonical version therefore remains
  `package.json@2.5.0`; this change does not invent a 2.5.1 release.
- TDD first produced six failures for legacy `version.json@2.1.0`, package
  name/repository, GUI branding/links, missing artifact template, and absent
  checker. The completed suite passes 6/6 and the full tracked suite passes
  67/67 (the baseline 61 plus six identity contracts).
- `sync:version` derives `version.json` and the release-note heading from the
  package version. `check:version` rejects version, release title, archive
  template, package identity, GUI identity, URL, or protocol-alias drift.
- Package identity is now `tsukuru-agent` / `Tsukuru Agent` with repository,
  homepage, issues, author, and original-author contributor metadata. GUI
  update/release/support links point to `Chiriri722/Tsukuru-Agent`; the duplicate
  `updates` IPC registration was removed.
- Compatibility is explicit in ADR 0001: GUI appId `net.electron.MVExtractor`
  and the `MVExtractor` protocol scheme stay in place, while `tsukuru-agent` is
  added. GPLv3 and Sziya/upstream credit remain preserved.
- The canonical lock was copied only as an ignored verification artifact and
  stayed SHA-256
  `1EEEC942B8EE190A04892C26BD7FBD79B982A8AB38DA79C096A8721F32A37051`.
  `npm ci` succeeded; integration must reconcile its root package name with
  `tsukuru-agent` without mixing dependency upgrades into this review unit.
- Typecheck, compile, sync/check idempotence, and 67/67 tests passed. The real
  CLI artifact is `tsukuru-agent-2.5.0-win.zip`, 98,355,501 bytes, SHA-256
  `CE2E4CDAA229761B59F6ADE9663B3F3F8207AE137D168B41D33601BD832E6941`.
  Its ASAR reports `tsukuru-agent@2.5.0` and current repository URLs. The
  packaged executable returned `E_REQUEST_INVALID` JSON and exit 1 for a
  missing request file.
- No commit, push, dependency declaration change, security auto-fix, or change
  to the evidence, lockfile, or build-chain worktrees was made.

## Integrated Phase 1-2 Result (2026-08-22)

- The integration branch preserves each independent review worktree and layers
  minimal CI plus test hardening on the canonical lock/build/version result.
- Test discovery is now recursive and exact: 23 tracked `.test.js` files and
  126 checks across contract, unit, integration, and end-to-end layers. A stale
  README count or omitted/extra inventory entry fails verification.
- Five CLI operations have normalized success/failure snapshots covering the
  one-JSON stdout contract, progress-only stderr, exit code, result keys, and
  artifact/stat shapes.
- Archive entries are rejected for traversal, drive/absolute/NUL aliases,
  Windows case or Unicode collisions, trailing-dot/space aliases, oversized
  paths and segments. Valid non-ASCII names remain accepted.
- The optional real-corpus workflow is self-hosted and manual. Public results
  contain fixture identity, engine/wrapper, hashes, structural outcome, and a
  separate playtest field, but never the private source path.
- Node's built-in test coverage measured line 76.91%, branch 64.67%, and
  function 77.98% on the 123-check measurement point. Threshold enforcement is
  intentionally deferred until the Electron and application seams stabilize.
- The current CLI ZIP is 98,547,691 bytes with SHA-256
  `6B5083CB53ABF7ED6888C97E3A78C691AA26440A6EFBD7DE0D54F4B1703ADBDE`;
  package contents and the packaged `E_REQUEST_INVALID`/exit-1 contract pass.

## Integrated Phase 1-2 Error Notes

- Direct Node test processes can fail with sandbox `spawn EPERM`; approved
  child-process execution passes without changing source or dependencies.
- Initial recursive inventory omitted legacy smoke files because they lacked
  `.test.js`; the files were renamed and the inventory now enforces one suffix.
- The first fixture tree hash used shell-specific separators and disagreed with
  the portable contract; the catalog now stores the test-computed canonical
  relative-path hash.
- A broad static search for retry logic matched filesystem cleanup options
  (`maxRetries`/`retryDelay`); the contract was narrowed to test-rerun behavior.
- A PowerShell regular-expression command failed from nested quote parsing and
  was rerun as simpler literal searches. A long plan read was split into bounded
  ranges after output truncation.

## Integrated Phase 3 Electron Security Result (2026-08-23)

- Every production `BrowserWindow` is now created through one factory that
  forces Node integration off, context isolation and sandbox on, web security
  on, and denies popups, webviews, and unapproved navigation.
- Sandboxed renderers expose only a frozen typed `window.tsukuru` bridge. The
  preload rejects unknown send/invoke/on channels before Electron receives them
  and strips the privileged Electron event from callbacks.
- Main-process IPC has a shared channel registry, payload schemas, trusted-file
  sender check, fixed renderer routes, canonical local-directory checks, and an
  HTTPS host allowlist. `openFolder` uses handle/invoke and structured responses;
  raw stacks and absolute paths are removed from renderer-facing failures.
- IPC registration no longer lives in `main.ts`; window, settings, project, and
  operation registrations have separate modules, while existing Wolf/font/
  extension adapters retain their feature modules under the same validation
  wrapper.
- GUI direct writes are transactional. Bulk replacement and version translation
  port stage the entire `Extract` tree, reject unsafe/mismatched/overlapping
  inputs before commit, preserve non-target binary files, and restore the
  original tree if commit fails.
- Five local HTML pages have restrictive CSP and no remote executable script.
  Update checks use the maintained repository endpoint with canonical semver,
  a five-second timeout, no redirects, bounded response handling, and explicit
  current/offline/invalid-response outcomes. Network use is documented in
  `tsukuru-agent/docs/electron-network-policy.md`.
- Shutdown unregisters shortcuts, closes Papago, and terminates tracked child
  process trees. The continue-after-`uncaughtException` handler was removed.
- The real Electron smoke loaded home, RPG, settings, and Wolf pages with
  `require`/`process` undefined, rejected arbitrary send/invoke channels, issued
  RPG and Wolf extract/apply requests, saved/closed settings, and completed
  `home → RPG → Wolf → RPG` navigation. The real main app also remained healthy
  through a hidden five-second launch.
- Final Phase 3 evidence: `npm run verify` 150/150, seeded `test:order` 150/150,
  actual Electron smoke `ok:true`, CLI package 5,217 entries with packaged
  `E_REQUEST_INVALID`/exit 1. ZIP size is 98,547,808 bytes; SHA-256 is
  `1FA079EB8316004C112634B783854AB753B88917C0DD47ECB89F53A7DD8A327E`.
- With these seams stabilized, CI now enforces a scoped core coverage gate over
  schema, atomic filesystem helpers, IPC path policy, GUI bulk replacement, and
  version-port transactions. The minimums are line 70%, branch 50%, function
  85%; the activation run measured 81.68%, 64.26%, and 96.08% respectively.

## Phase 4 CLI Application Map (2026-08-23)

- Before extraction, `src/cli/run.ts` was 1,285 lines with 40 functions. Its
  public `runAgent` combined argument parsing, request input, schema validation,
  project detection, diagnostics, five-operation dispatch, error conversion,
  stdout serialization, and exit status.
- The operation cluster is dominated by `opVerify` (378 lines, cyclomatic 45,
  cognitive 136) and `opApply` (102 lines, cyclomatic 16, cognitive 38).
  `runAgent` itself was 33 lines (cyclomatic 8, cognitive 20), but directly
  called parsing/input, validation/detection, diagnostics, all five handlers,
  error normalization, and result construction.
- Direct dependencies span filesystem/path/temp/crypto, ASAR and NW.js
  containers, request schema and operation errors, RPG/Wolf/Tyrano/GDevelop
  services, patch/dictionary/manifest recovery, validator/scoring, runtime
  diagnostics, and provenance.
- Observable side effects include stdin and request-file reads; one stdout JSON
  document and human/progress stderr; source/output traversal and copy; staging
  directory creation/removal; atomic rename; ASAR/ZIP extraction and repack;
  hash/runtime inspection; and opt-in child-process launch probes.
- The first seam moves CLI I/O to `entrypoint.ts`, machine serialization to
  `presenter.ts`, and operation routing to `dispatcher.ts`. Application errors
  remain inside `executeAgentRequest` so a failed operation retains the format,
  container, and engine diagnostics already attached to the partial result.
- Characterization evidence is the normalized success/failure snapshot for all
  five operations plus injected entrypoint and dispatcher unit contracts. The
  first full run caught loss of partial diagnostics; after correction, the
  focused seven checks pass without snapshot changes.

## Phase 4 Application and Transaction Checkpoint (2026-08-23)

- `entrypoint.ts` now owns argument/request/stdout concerns, `dispatcher.ts`
  owns exhaustive operation routing, and `presenter.ts` owns both machine JSON
  and human score/damage/runtime/validation formatting. `run.ts` has no direct
  stdout/stderr write or console redirection.
- Request/detected-format compatibility is a single characterized matrix. The
  immutable engine registry records engine family, supported operations, patch
  manifest format, and extraction layout; existing legacy asymmetry and wrapper
  aliases remain unchanged rather than being silently tightened during refactor.
- All five operations are real modules, not forwarding facades. Extract,
  apply, and verify select immutable engine-family handler registries; public
  handlers no longer carry family condition chains. Verify's ASAR, manifest,
  Tyrano, and GDevelop implementations are independently importable. Shared
  engine paths and operation context construction moved to focused modules,
  and all operation source has no direct process, console, or Electron API.
- `WorkspaceTransaction` stages beside the final output for same-volume rename,
  keeps an existing force target readable until commit, moves it to a unique
  backup only during commit, restores it on commit failure, and removes owned
  staging/backup paths during rollback/dispose. Root and symlink outputs are
  rejected.
- ASAR and NW.js extraction now build directly inside a workspace transaction,
  write provenance before commit, and expose final artifact paths only after a
  successful rename. ASAR/NW.js repack writes under the final game-copy staging
  tree and is inspected before commit. RPG/Wolf/Tyrano/GDevelop loose apply also
  uses the same transaction; custom RPG output no longer leaves `data/Completed`.
- Validator policy is split into common types, weighted score, canonical issue
  severity/deterministic report ordering, engine/container protected paths,
  file-map diff/snapshot, and RPG/Wolf/Tyrano engines. The compatibility
  `validator.ts` is 28 lines.
- Container policy is split into path/collision/length rules, symlink-aware
  directory walking, engine detection, ASAR/NW.js/directory adapters, immutable
  registry, inspect/extract/pack/verify operations, and versioned provenance.
  The compatibility `container.ts` is 40 lines. Hostile NW.js preflight runs
  before staging creation.
- `run.ts` is 92 lines and `operations/verify.ts` is 48 lines. ADR 0002 records
  application dependency direction and provenance/transaction invariants.
- Current integration evidence is `npm run verify` plus fixed-seed
  `npm run test:order`: 35 test files, 175 checks, both 175/175 pass,
  generated-source drift 0, inventory drift 0. CLI snapshots stayed unchanged.

## Phase 5 Versioned Contract and Runtime Checkpoint (2026-08-23)

- Checked-in JSON Schema 2020-12 documents now cover request/result/manifest
  v1 and v2, container provenance v1, and engine/operation options v2. One
  immutable registry and a deterministic in-repository validator resolve local
  and external `$ref` values before operation dispatch.
- Request v2 is a strict operation/format discriminated union with bounded
  fields such as `operationTimeoutMs`; request v1 preserves unknown extensions.
  The actual detected format is validated a second time before engine work, so
  `auto` cannot smuggle Wolf-only options into RPG extraction.
- Result v2 adds `schemaVersion` and machine-readable `warningDetails` while
  retaining `warnings`; v1 preserves the legacy key set. Manifest v1 remains
  permissive enough for historical minimal entries, while v2 requires complete
  source-snapshot and mapping metadata.
- Eight checked-in JSON examples and four README snippets are parsed and schema
  validated in CI. ADR 0003 records the canonical schema/runtime decision and
  `docs/contracts/v2-migration.md` records the compatibility policy.
- `activeContext` and its setter were removed. `OperationRuntime` explicitly
  injects logger, progress, filesystem, clock, temporary-directory provider,
  and `AbortSignal`; AsyncLocalStorage is only the scoped compatibility adapter
  for deep legacy helpers. Success, failure, nested, and parallel tests prove
  context restoration and isolation.
- CLI SIGINT/SIGTERM, GUI cancel IPC, and request `operationTimeoutMs` converge
  on the same abort contract. Workspace transactions check cancellation before
  commit, preserving an existing final output and preventing partial publish.
- The first full run found two useful v1 compatibility regressions: a Wolf
  minimal manifest was rejected and a malicious minimal RPG manifest could no
  longer reach its semantic path guard. Loosening only the v1 entry required
  set restored `E_MAPPING_CORRUPT`; v2 remains strict.
- Final evidence: `npm run verify` and fixed-seed `npm run test:order` each pass
  all 39 files/198 checks; generated artifact and README inventory drift are 0.

## Phase 6 Supply-chain Checkpoint (2026-08-23)

- Direct runtime dependencies were reduced to 15 and inventoried with exact
  lock versions, licenses, scope, and call sites. Legacy `request`, axios, and
  nine other unused/deprecated direct packages were removed; type-only packages
  are development-only. Network calls now use one bounded client with HTTPS by
  default, explicit loopback HTTP, timeout, response-size limits, and a bounded
  redirect host allowlist.
- `npm audit --omit=dev` first found GHSA-xcpc-8h2w-3j85 in `adm-zip` 0.5.18.
  Upgrading to 0.6.0 and removing the obsolete `@types/adm-zip` package preserved
  ZIP path, seeded fuzz, NW.js, and GDevelop round trips; the production audit
  now reports zero findings.
- Full audit still reports 4 moderate and 11 high findings through Electron
  22.3.27 and electron-builder 22.14.13. Because Electron is present in public
  binary artifacts despite npm classifying it as a dev dependency, public
  binary release is explicitly blocked. The findings are not exceptions; the
  documented exit is a one-major-at-a-time upgrade ladder with GUI, CLI stdio,
  ASAR/NW.js, fuse/resource, Authenticode, and cleanup verification at each step.
- Four external executables have machine-readable origin/version/license/size/
  SHA-256/call-site records. Bundled tools are hash-verified before execution;
  commands use fixed paths, argument arrays, `shell:false`, bounded timeouts,
  and process-tree cleanup. WolfDec v0.3 is downloaded only on demand with a
  pinned 256,000-byte SHA-256. CI hashes but never executes these binaries.
- Font and SweetAlert assets are inventoried. THIRD-PARTY-NOTICES is generated
  deterministically from the lockfile and drift-checked. Release evidence emits
  SHA256SUMS, a source/version/build/artifact manifest, and SPDX 2.3 with 182
  packages and 181 dependency relationships. Dirty trees are rejected by
  default; non-release testing must opt in and records `sourceTreeDirty:true`.
- The first actual packaged CLI smoke exposed a missing `src/electron` module:
  core services had begun importing the process registry while CLI packaging
  intentionally excluded GUI code. Moving process cleanup and public-error
  redaction to `src/core` restored the dependency direction. The smoke itself
  now has a 15-second kill bound and the real ZIP returns one JSON document with
  `E_REQUEST_INVALID`/exit 1.
- Final evidence: clean `npm ci`; production audit 0; real Electron smoke;
  97,054,332-byte CLI ZIP; package allowlist/stdout verification; and both
  normal and fixed-seed suites at 42 files/209 checks with generated, inventory,
  dependency, binary, asset, and notice drift all zero.

## Phase 7 Performance and Long-operation Checkpoint (2026-08-23)

- Deterministic benchmark fixtures now cover RPG MV, Wolf, Tyrano, GDevelop,
  ASAR, and NW.js. Reports include elapsed time, peak RSS, exact file/byte/text
  counts, temporary bytes, and fixture/hashing/parsing/packing timings.
- The CI profile passed all six regression ceilings. Exact structural counts
  are 48/77,601/1,200 for RPG, 1/8,290/300 for Wolf, 40/91,560/4,000 for
  Tyrano, 3/701,548/1,000 for GDevelop, and 802/819,279/800 for both archive
  profiles.
- Result v2 now includes operation ID, elapsed time, and stage timings. stderr
  progress uses `{stage, completed, total, unit, operationId}` without changing
  the single-JSON stdout contract. Optional diagnostic reports are atomic,
  refuse overwrite/source placement, and redact project/output/temp roots.
- Resource preflight measures files, input bytes, largest file, conservative
  temporary demand, and available space before dispatch. Strict v2 request
  limits fail with stable resource error codes before output mutation.
- RPG/Wolf extract/apply, whole-workspace text replacement, and version port run
  in a GUI worker. Shared-memory cancellation remains visible during synchronous
  loops. GUI quit is deferred until staging and tracked process trees are
  removed; PID events allow the main process to terminate a worker-owned child
  on emergency fallback.
- The I/O review keeps complete buffers only where parsers/archive APIs need a
  bounded unit; file hashing already uses a reusable one MiB chunk and ASAR pack
  uses read streams. Project conversion and translation remain legacy async
  paths and may not expand until split into pure transactional operations.
- Final measured evidence is `benchmark:check` 6/6 and 46 test files/225 checks.
  The first full run failed only the intentionally stale README/CI inventory;
  synchronizing both made the executable inventory contract pass.

## Phase 8A directory-form NW.js checkpoint (2026-08-23)

- A direct or nested `package.nw` directory is now inspected as
  `nwjs-package` with the `nwjs-directory-form` feature. Detection remains
  available without mutation authority; extract and container apply require
  the explicit v2 `experimentalNwDirectory` option.
- Directory provenance uses a deterministic digest over normalized relative
  paths, file sizes, and per-file SHA-256 values. Apply re-inspects both source
  and staged output while preserving the surrounding wrapper in a separate
  transaction-owned game copy.
- Linked entries, junctions, unsafe paths, case-folding collisions, source
  changes, in-place output, and partial staging publication are rejected.
- Two focused directory-form tests, the complete eight-case compatibility
  suite, and eleven versioned-schema contracts pass. Existing ZIP
  `package.nw` behavior is unchanged.
- The user-approved Electron sample contains a 796,154,510-byte
  `resources/app.asar`, not a directory-form `package.nw`; no such sample was
  found in the approved translated-pack corpus. Its launch/playtest exit gate
  therefore remains explicitly unverified rather than inferred from synthetic
  coverage.

## Phase 8B appended-ZIP checkpoint (2026-08-23)

- NW.js officially documents concatenating `nw.exe` and the application ZIP.
  The implementation locates the classic EOCD, checks central-directory and
  local-header physical offsets, validates PE32/PE32+ headers, and records the
  exact executable-prefix length and SHA-256 without executing the file.
- Only one unsigned candidate with a `package.json` entry is mutable, and only
  when `experimentalNwAppendedZip` is explicit on extract and apply. Repack
  copies the original prefix through a one MiB buffer, appends a staged ZIP,
  then re-parses and re-hashes the result before transaction publication.
- Microsoft documents the PE Certificate Table address as a file offset. A
  present or out-of-bounds table is therefore classified statically and blocked;
  this does not claim certificate trust or runtime validity.
- Signed fixtures fail with `E_EXPERIMENTAL_FEATURE_UNSAFE`; multiple valid
  executable candidates report `nwjs-appended-zip-ambiguous` and remain
  unchanged. ZIP64, split, non-PE, offset-inconsistent, or bypass-dependent
  layouts are outside the mutation subset.
- Prefix-preserving translation round-trip, signed refusal, and ambiguous
  no-mutation tests pass together with all legacy/directory NW.js cases:
  compatibility 11/11 and versioned schema 11/11.

## Phase 8C Electron GDevelop checkpoint (2026-08-23)

- Standard Electron/GDevelop now uses the same non-executing `gdjs.projectData`
  JSON Pointer manifest as loose/NW.js projects inside the existing ASAR
  provenance and whole-wrapper transaction.
- Apply compares the original archive hash, engine root, packed and unpacked
  file lists, source snapshot, and protected `gdjs`/`code*.js` bytes. A true
  unpacked `.node` entry and unrelated external `resources` file survive the
  synthetic round-trip; only `data.js` translation text changes.
- Protected generated-code tampering fails with `E_VERIFY_FAILED` before final
  publication. CLI E2E is 17/17 and the separate loose/NW.js compatibility
  suite remains 11/11.
- Read-only inspection showed the approved 796,154,510-byte sample is
  ElectronForMZ wrapping RPG Maker MZ, not GDevelop. It contains 2,519 valid
  files and 18 out-of-bounds/decoy ASAR metadata entries, including impossible
  sizes. The adapter can selectively extract valid entries, but cleaned repack
  is now default-blocked unless `experimentalMalformedAsarRepack` is explicit.
- Structural checks, optional launch probe, and manual gameplay are documented
  as separate evidence. The private sample was not modified or copied.

## Phase 8D GDevelop generated-code profile checkpoint (2026-08-23)

- `code*.js` remains protected by default. The v2-only
  `experimentalGdevelopCodeStrings` option enables static parsing on extract and
  apply; patch remains manifest-ID based and verify revalidates the manifest.
- Acorn parses source without evaluation. Only a direct first-argument string
  literal on indexed `GD…Objects<number>.setString` or `setBBText` generated
  calls becomes an automatic candidate. Empty, identifier-like, resource/URL,
  arbitrary setter, variable, template, and other literals remain report-only.
- `_Extract/gdevelop-code-report.json` records ambiguous candidates and parse
  errors. Manifest entries bind source SHA-256, literal hash/span, quote,
  setter, and per-file AST candidate index; forged mappings fail with
  `E_MAPPING_CORRUPT` and publish no output.
- Output validation follows the originally approved AST context rather than
  reclassifying translated content, so a legitimate translation such as `OK`
  is accepted while an original resource path remains excluded.
- Whole-project diffing permits only the code files approved by the validated
  manifest. Loose, Electron ASAR, and NW.js package round-trips preserve all
  other runtime/wrapper files and source hashes. The relevant compatibility,
  E2E, schema, and supply-chain suites passed 45/45.
- Acorn 8.18.0 is pinned as a direct runtime dependency, recorded in the
  machine inventory, lockfile, and regenerated third-party notices.

## Phase 9 documentation and release checkpoint (2026-08-23)

- Task-oriented docs now distinguish CLI from sandboxed GUI use and make
  stable, experimental, diagnostic-only, and unsupported compatibility levels
  explicit. Structural verification, bounded launch probes, and manual gameplay
  are separate evidence classes.
- Canonical error/warning catalogs and local Markdown links are contract-tested.
  Tagged JSON request examples are recursively validated against their declared
  v1/v2 schema, and `package.json@2.5.0` also controls CHANGELOG identity.
- A lockfile-only `npm ci` installed 520 packages. The immediately following
  `npm run verify` passed 46 files/236 checks with all drift gates clean; the
  fixed-seed order run also passed 236/236.
- The GDevelop benchmark now writes its static code diagnostic report by design,
  increasing the exact 1,000-entry CI fixture from 701,548 to 733,548 bytes.
  Isolated measurement was about 62 ms/74 MB RSS, so only the exact byte contract
  changed; the 2,000 ms/256 MiB ceilings remain intact. All six cases pass.
- The local CLI artifact is 97,065,414 bytes with 3,471 entries and SHA-256
  `7532f72efdb8ef1aa7553302b189c117597d3220216537d0945f191b612da9e8`.
  Package verification preserved the headless `E_REQUEST_INVALID`/exit1
  contract. Two evidence generations produced identical SHA256SUMS, manifest,
  and SPDX SBOM hashes for 181 runtime packages.
- Current registry evidence remains split: `npm audit --omit=dev` reports zero;
  the complete Electron/builder toolchain reports 4 moderate and 11 high.
  Therefore docs and local CLI evidence are complete, but public GUI binary
  release and the whole-program DoD remain blocked on the major ladder.

## Electron-builder major ladder findings (2026-08-23)

- Electron 23.3.13 passed the full compatibility matrix before builder changes.
  Holding Electron constant isolated builder behavior and audit changes.
- Builder 23.6.0 reported 13 high/1 critical; 24.13.3 improved to 9 high/1
  critical; 25.1.8 regressed to 13 high/1 critical. All three remained
  compatibility-only rungs despite passing runtime and package tests.
- Builder 26.15.7 reduced the full audit to 2 high/0 critical. The remaining
  nodes are Electron 23 and `extract-zip`; builder and vulnerable `tar` paths
  are gone. Production audit remains zero.
- Builder 25+ updates the Windows ASAR-integrity executable resource during
  packaging. Native dependency rebuild, unsigned-signing skip, ZIP generation,
  and packaged CLI behavior all completed without weakening the tested
  BrowserWindow/preload/IPC settings.
- The final builder artifact is 99,313,201 bytes with 3,012 entries and SHA-256
  `3f37eba78f409e0e02b257efa9ff228929b01ad053876f7eaee29ddb129669d6`.
  Public binary release remains blocked on the Electron major ladder.

## Electron 24 rung findings (2026-08-23)

- Electron 24.8.8 preserved all 236 functional/security contracts, fixed-seed
  order behavior, sandboxed preload/IPC isolation, and packaged CLI stdio.
- The full audit stayed at 2 high/0 critical; this rung did not yet remove the
  Electron/`extract-zip` advisory path.
- The builder 26 package flow rebuilt native dependencies and updated the
  executable ASAR-integrity resource for Electron 24 without changing the
  3,012-entry package allowlist.

## Electron 25 rung findings (2026-08-23)

- Electron 25.9.8 preserved all functional, security, deterministic-order, and
  packaged CLI contracts under builder 26.15.7.
- The full audit remained 2 high/0 critical, so the upgrade was compatible but
  did not yet clear the Electron/`extract-zip` advisory path.
- The verified ZIP remained at 3,012 allowlisted entries; its byte/hash evidence
  is recorded in the upgrade status document.

## Electron 26 rung findings (2026-08-23)

- Electron 26.6.10 passed the complete compatibility and package matrix without
  changing the 3,012-entry allowlist or sandbox/preload/IPC policy.
- Full audit remained 2 high/0 critical. The artifact grew to 101,597,643 bytes;
  its hash is recorded as per-rung evidence rather than treated as a regression.

## Electron 27 rung findings (2026-08-23)

- Electron 27.3.11 passed all contracts, but its GPU subprocess exited on both
  real GUI smoke runs. The renderer recovered and all security assertions still
  passed, so this is not a functional failure; it is retained as a release-risk
  observation rather than hidden with a `--disable-gpu` test switch.
- The second run reported two Windows status exits (`-1073740791`) and one exit
  `34`. Later majors must be run under the same unmodified smoke conditions to
  determine where the regression disappears.

## Electron 28 rung findings (2026-08-23)

- Electron 28.3.3 passed the complete matrix and the unchanged real GUI smoke
  emitted no GPU subprocess error. This is direct evidence that the Electron 27
  observation does not persist into 28 on the same host.
- Full audit remained 2 high/0 critical and package contents stayed at 3,012
  allowlisted entries.

## Electron 29 rung findings (2026-08-23)

- Electron 29.4.6 preserved all 236 contracts in normal and fixed-seed order,
  emitted no GPU warning in the real GUI smoke, and retained the 3,012-entry
  packaged CLI boundary.
- Full audit remained 2 high/0 critical; no new advisory path was introduced.

## Electron 30 rung findings (2026-08-23)

- Electron 30.5.1 preserved all 236 contracts in normal and fixed-seed order,
  emitted no GPU warning in the real GUI smoke, and retained the 3,012-entry
  packaged CLI boundary.
- Full audit remained 2 high/0 critical; no new advisory path was introduced.

## Electron 31 rung findings (2026-08-23)

- Electron 31.7.7 preserved all 236 contracts in normal and fixed-seed order,
  emitted no GPU warning in the real GUI smoke, and retained the 3,012-entry
  packaged CLI boundary.
- Full audit remained 2 high/0 critical; no new advisory path was introduced.

## Electron 32 rung findings (2026-08-23)

- Electron 32.3.3 preserved all 236 contracts in normal and fixed-seed order,
  emitted no GPU warning in the real GUI smoke, and retained the 3,012-entry
  packaged CLI boundary.
- Full audit remained 2 high/0 critical; no new advisory path was introduced.

## Electron 33 rung findings (2026-08-23)

- Electron 33.4.11 preserved all 236 contracts in normal and fixed-seed order,
  emitted no GPU warning in the real GUI smoke, and retained the 3,012-entry
  packaged CLI boundary.
- Full audit remained 2 high/0 critical; no new advisory path was introduced.

## Electron 34 rung findings (2026-08-23)

- Electron 34.5.8 preserved all 236 contracts in normal and fixed-seed order,
  emitted no GPU warning in the real GUI smoke, and retained the 3,012-entry
  packaged CLI boundary.
- Full audit remained 2 high/0 critical; no new advisory path was introduced.

## Electron 35 rung findings (2026-08-23)

- Electron 35.7.5 preserved all 236 contracts in normal and fixed-seed order,
  emitted no GPU warning in the real GUI smoke, and retained the 3,012-entry
  packaged CLI boundary.
- Full audit remained 2 high/0 critical; no new advisory path was introduced.

## Electron 36 rung findings (2026-08-23)

- Electron 36.9.5 preserved all 236 contracts in normal and fixed-seed order,
  emitted no GPU warning in the real GUI smoke, and retained the 3,012-entry
  packaged CLI boundary.
- Full audit remained 2 high/0 critical; no new advisory path was introduced.

## Electron 37 rung findings (2026-08-23)

- Electron 37.10.3 preserved all 236 contracts in normal and fixed-seed order,
  emitted no GPU warning in the real GUI smoke, and retained the 3,012-entry
  packaged CLI boundary.
- The CLI ZIP grew by 11,854,770 bytes from Electron 36 while the package
  allowlist remained unchanged; this is recorded as runtime payload growth.
- Full audit remained 2 high/0 critical; no new advisory path was introduced.

## Electron 38 rung findings (2026-08-23)

- Electron 38.8.6 preserved all 236 contracts in normal and fixed-seed order,
  emitted no GPU warning in the real GUI smoke, and retained the 3,012-entry
  packaged CLI boundary.
- Full audit remained 2 high/0 critical; no new advisory path was introduced.

## Electron 39 rung findings (2026-08-23)

- Electron 39.8.10 preserved all 236 contracts in normal and fixed-seed order,
  emitted no GPU warning in the real GUI smoke, and retained the 3,012-entry
  packaged CLI boundary.
- A standalone full-audit rerun confirmed 2 high findings after a compact
  parallel-audit capture made the dependency path look ambiguous.

## Electron 40 rung findings (2026-08-23)

- Electron 40.10.6 preserved all 236 contracts in normal and fixed-seed order,
  emitted no GPU warning in the real GUI smoke, and retained the 3,012-entry
  packaged CLI boundary.
- Full audit improved to 1 high/0 critical. The `extract-zip` advisory is gone;
  the remaining direct Electron advisory covers sandboxed iframe OpenURL paths.

## Electron 41 rung findings (2026-08-23)

- Electron 41.10.6 preserved all 236 contracts in normal and fixed-seed order,
  emitted no GPU warning in the real GUI smoke, and retained the 3,012-entry
  packaged CLI boundary.
- Both production and full audits are clean; the Electron dependency ladder no
  longer has an audit blocker after the 41.10.2 advisory boundary.

## Electron 42 rung findings (2026-08-24)

- Electron 42.9.3 preserved all 236 contracts in normal and fixed-seed order,
  emitted no GPU warning in the real GUI smoke, and retained the 3,012-entry
  packaged CLI boundary with both audits clean.
- A clean install deferred the Electron binary fetch until the first
  binary-dependent test. The fetch completed and both GUI launch and CLI
  packaging passed, so this is an installation behavior observation rather than
  a runtime or release failure.

## Electron 43 current-major findings (2026-08-24)

- Current stable Electron 43.4.1 preserved all 236 contracts in normal and
  fixed-seed order, emitted no GPU warning in the real GUI smoke, retained the
  3,012-entry packaged CLI boundary, and kept both audits clean.
- The final CLI ZIP is 148,287,234 bytes. Its larger runtime payload did not
  introduce an allowlist, entry-point, stdout, or exit-code regression.
- Electron 42 and 43 both used a successful lazy binary fetch after clean
  install; the behavior is repeatable and did not block GUI launch or packaging.

## P3-P5 final integration findings (2026-08-24)

- The translated real RPG pack's three missing map-transfer targets are also
  present in its original `Backup`. Treating those as current translation damage
  overstates risk, so exact issue identity is compared against a non-recursive
  baseline inspection and only matching issues become warnings.
- RPG `translationDirectory` must run after copied apply artifacts enter the
  disposable engine tree and before `RpgMakerService.apply`; keeping it inside
  the existing `WorkspaceTransaction` preserves original archive, working pack,
  and prior output on every failure path.
- Recover conflict intent is observable without mutation through `dryRun`, while
  real replacement reserves a unique backup path, writes the backup and manifest
  atomically, and removes only a backup created by the failed attempt.
- Repeated CLI builds initially had identical uncompressed files, DOS times, and
  compressed payloads but different archive bytes. Every entry carried a volatile
  NTFS `0x000a` extra timestamp. Canonicalizing low-level ZIP entries by UTF-8
  order and fixed DOS time and stripping extras/comments yielded stable bytes.
- A final security pass found a lexical-containment gap: `Extract/linked/file`
  could traverse a junction and patch an external file. The failing test observed
  the write; lstat checks on every existing path segment now reject the request
  before reading or writing. Manifest, Backup, and `.extracteddata` callers use
  the same boundary.
- Release ZIP duplicate checks also need Windows extraction semantics. Case,
  NFC-equivalent names, and trailing dot/space aliases now share one collision
  key and are rejected before replacing the archive.
- Latest deterministic CLI evidence is 148,285,977 bytes, 76 outer entries,
  3,012 app-ASAR entries, and SHA-256
  `73658e117b4e8bb479fc15277e0851d900e09e4a283339313ec8474378a4f8c6`.
- All locally authorized automated gates are complete. The remaining claims
  require a committed clean source tree, hosted CI, authorized real-game manual
  gameplay, signing, or release publication and cannot be inferred from local
  synthetic/launch-probe success.
