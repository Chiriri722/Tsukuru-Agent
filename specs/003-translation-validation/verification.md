# D21 verification

Date: 2026-09-13. Initial checkout: hardening integration at `80d2043` plus preserved earlier work.
Implementation: workflow `34e876e`, RPG fixes `2118186`, main documentation merge `ecaf782`,
contract/fixture alignment `251d41c`, package-smoke fixture `dfba1bf`.
Final application source is unchanged by the later test/documentation alignment.
Main was fast-forwarded to acceptance commit ae3e497. Only the canonical main worktree remains.
No release or push occurred.

## Boundary investigation

Fresh read-only Codex Security investigator `d21_boundary_investigation` and parent trace agree:
- loose dictionary patch and service output were separate commits;
- source strings must come from Backup + origin/dataPath, not updated hashes or mutable originText;
- service is shared by CLI, ASAR, GUI and manifest-free legacy packs;
- external-message expansion, JSON/YAML/plugin/CSV output and legacy instantapply require explicit handling;
- ASAR protected-script rules remain separate and unchanged;
- message grouping must use Backup event/page/list/indent boundaries.

Selected strategy: stage dictionary work on the source volume and output on its target volume;
install Extract/mapping/output as one artifact group. Fingerprint copied inputs before publication
to preserve concurrent user changes. Shared source-bound lint precedes mutation. Read back emitted
forms and compare every changed value against allowed paths, then inspect a Backup+output merge.
Legacy GUI mode publishes validated files as one group, retaining JSON/YAML replacement semantics.

## Ordered focused evidence

Commands run from `tsukuru-agent`. Logs are ignored under `tmp/d21/`.

| Stage | Actual result |
| --- | --- |
| Transaction RED | 4 tests: 3 failed (late Backup error, install fault, cancel), normal control passed |
| Transaction GREEN | 28/28 with dictionary, atomic and workspace-transaction tests |
| Lint RED | 4 new failures: direct/manual damage, report contract, external CSV source preservation |
| Lint focused | 72/73; only old exact PatchOutcome shape needed its new diagnostic assertion |
| Contract RED | malformed semantics/status/diagnostic shape accepted before schema addition |
| Output RED | wrong serialized value, missing merged report, and instantapply late failure reproduced |
| Combined focused | 87/88; baseline-warning fixture lacked an actual bad reference, fixture corrected |
| Output forms | 13/13: JSON/YAML wrong-value/outside-path faults, plugin/CSV tampering, legitimate controls, GUI conversions |
| P1 RED | aggregate conflicts, message quality, AppleDouble cases failed as expected |
| P2/concurrency RED | parser excerpt disclosure and concurrent edit overwrite both reproduced |
| Latest D21 focused | 18/18, no skips (`node --test --test-concurrency=1 test/integration/rpg-translation-validation.test.js`) |
| TypeScript build | passed after each implementation boundary |
| Complexity | passed, all functions <= 40 |

Local tests required elevated Node child-process execution because the sandbox returned spawn EPERM.
No user data was used in synthetic tests. Backup parse errors now omit raw parser excerpts; missing
targets include confirmed relative file/bucket/ID/dataPath. Hash conflicts retain the old code and
details.id with bounded total/list/omitted diagnostics.

## Independent candidate review

The fresh read-only review was interrupted before a result and resumed without prior rationale.
It confirmed four routes, all reproduced by the parent before corrections:

- Custom output under original `js` replaced runtime files: extend the shared guard to game runtime/media directories.
- Reverting an instant plugin translation copied already-translated current source: preserve a plugin source only when its parsed value equals the plan.
- CSV whitespace before quotes differed from the runtime parser: align field and blank-row interpretation and compare with fast-csv.
- Unmapped malformed Backup files disclosed parser excerpts: sanitize the shared structural parser, retaining file/code/severity.

The corresponding synthetic RED tests failed for the reported reasons. The first correction set
passed 40/40 focused checks; the final CSV equivalence check brought this to 41/41, with no skips. The reviewer used
the existing graph and local source after automatic approval review rejected reindexing; no work
remained blocked by that rejection. No private data was shared with the reviewer.

## Private workspace validator run

The supplied guide was read and current workspace locations were inventoried. Original scripts
with old paths were preserved. The current compiled CLI ran v2 `verify`, explicit `rpgmv`,
profile `full`, `verifyDepth: deep` against copies of Backup/Extract/mapping and any source CSV/System.
14 complete workspaces (522,620 manifest entries) were checked; one nonstandard directory had no
complete workspace at its root and was recorded as not-run. Original and copied artifact trees
were SHA-256-identical before/after every read-only check.

Eight returned success with review warnings. Six correctly failed: one malformed Backup JSON,
four stale Extract-hash sets, and three mechanical-damage workspaces, with overlap between those
groups. One damaged workspace had a clean structural report, demonstrating why the new mechanical
result must remain separate. All semantic and gameplay checks remained not-run. Translation text,
absolute private paths and raw errors remain only in ignored local evidence. The sanitized table
is in [corpus-results.json](corpus-results.json). No existing translation was changed or automatically
realigned. These findings are defects in supplied workspaces, not reasons to weaken the validator.

The initial run was interrupted after four results and during the fifth copy. Existing results
were hash-checked before resuming. Windows Node native copy exited during the large fifth copy;
a bounded stream copier preserved partial attempts and finished the run. No engine policy changed
for this host-side copying problem. The largest 159,532-entry workspace completed successfully.

## Branch preservation

The three old worktrees were compared against current implementations, including renamed tests.
All original tracked/untracked source edits are preserved in local commits and tags:

| Work | Commit | Tag |
| --- | --- | --- |
| build chain | `2f1c4d0` | `archive/2026-09-13-hardening-build-chain` |
| lockfile | `59ecb44` | `archive/2026-09-13-hardening-lockfile` |
| version identity | `4e8016b` | `archive/2026-09-13-hardening-version-identity` |

Current build staging, canonical version policy and updated locked dependencies retain and extend
those changes. Their original test logs, binary diffs and ignored lockfiles are separately preserved
in the canonical checkout's ignored `tmp/d21-branch-archive`. No archive tag has been pushed.

## Final acceptance

| Command / check | Result |
| --- | --- |
| Final focused candidate | 41/41 |
| Contract / workflow alignment | 35/35 |
| `npm run verify` | exit 0; 433/433, no skips; version/type/style/complexity/generated/inventory/supply-chain passed |
| `npm run test:order` | exit 0; 433/433, no skips, seed 1414747474 |
| `npm run benchmark:check` | exit 0; all six cases within baseline |
| `npm run test:electron` | exit 0; sandbox/bridge/IPC/settings and RPG/Wolf GUI smoke |
| `npm run build:cli` then `npm run verify:package` | exit 0; package contents and valid/invalid CLI contracts |
| Final private-corpus recheck | workspace-01, workspace-06, workspace-14; expected failure/pass/failure and byte preservation |

The first full run returned 427/433. Six failures were stale fixtures/contracts: four success
fixtures wrote an invalid empty mapping, the CLI snapshot lacked additive diagnostics, and the
error-code reference omitted the two new codes. The fixtures now use the existing mapping writer;
snapshot/documentation changes preserve the stricter validator. The corresponding 35 checks and
the full rerun passed. Runtime validation was not relaxed to accept invalid fixtures.

Package verification exposed the same invalid empty-mapping fixture. A decoding assertion failed
before correcting the fixture to use the existing writer; all 13 CI contract checks then passed.
The actual packaged executable passed both success/exit 0 and missing-request/exit 1 checks,
with 1,797 ASAR entries and 76 deterministic ZIP entries. ZIP SHA-256:
be7fbdeea9ef47631212671e062b849e07cf89e880f1ed79a0eba2661629d083.

The final recheck uses the current compiled CLI, original-source hashes and the existing verified
copies. The JSON error keeps its code/file/severity but contains no parser excerpt; the successful
case remains successful; the mechanically damaged case still fails despite a clean structure.
The original 14-case results and the separate final three-case evidence are preserved together in
`corpus-results.json`. No additional workspace was repaired or promoted.

Three obsolete worktrees/branches were removed only after their tags, clean status and local
archives were checked. The canonical checkout's 44 ignored generated/source-test files and old
lockfile were separately copied and hash-verified before integration. The 44 original files were
then moved intact into main-displaced-files, retaining the verified copies as well.

## Canonical checkout verification and preservation

After fast-forward, `npm ci --offline --no-audit` installed the locked dependencies successfully.
The canonical checkout repeated verify and fixed-order tests at 433/433, all six benchmarks,
Electron smoke and package verification. The first fresh-install verify run passed 432 tests and
skipped one optional Electron-fuse check because electron/path.txt was absent at test discovery;
after Electron initialization, the final verify rerun passed all 433 without skips.
Spec-kit prerequisites resolved feature 003 under the
canonical path. Application/test sources match the accepted implementation; only final status
documentation changed after those checks.

Local logs: `tsukuru-agent/tmp/d21-main/`. Earlier full logs and private copies are retained under
`tmp/d21-integration-evidence/tsukuru-agent-tmp/`; original repository temp assets and the historical
GUI build are also preserved there. Old branch/ignored-source archives remain under
`tmp/d21-branch-archive/`. The current CLI package is in `tsukuru-agent/dist-cli/` with unchanged
ZIP SHA-256 after relocation. All four redundant worktrees/branches were removed after preservation.
Automatic review rejected deletion of the 44 original files; reversible relocation succeeded.
Final worktree removal waited for the canonical test launcher to exit.

## Quality interpretation

Mechanical integrity, output structure, language/context review, semantic alignment and actual gameplay
are separate. Source retention and name/credit fields carry review reasons; balanced quote-style changes
are informational. Pure semantic swaps cannot be identified solely from tokens, IDs or Japanese counts.
The original external-message CSV is preserved in new Backup workspaces. Old expanded packs need their
original CSV when no Backup CSV is present; absence is not a successful source verification.

## D22 additional corpus and option compatibility (2026-09-23)

Baseline: `main@a9690a6`; follow-up changes are local and uncommitted. The official
Spec-kit prerequisites selected feature 003 and its requirements checklist passed 8/8.
See the [D22 report](../../docs/reviews/2026-09-23-electron-corpus.md) for counts and limitations.

- The existing v2 RPG option discriminator rejected `experimentalMalformedAsarRepack`
  before dispatch. The contract and malformed-ASAR workflow regressions both failed RED;
  adding the existing boolean option to `applyRpg` made both GREEN. Existing GDevelop
  opt-in, default refusal, source hashes and protected-file checks remain covered.
- New ElectronForMZ/MZ sample: 19,465 mappings extracted and verified; a staged dictionary
  changed one title field, repacked all 3,994 valid entries and preserved all other payloads.
  Source/copy/working, wrapper and actual AppData hashes were rechecked. The user removed
  the expanded save backup while work was running; its retained ZIP and all eight members
  match the initial hashes. No game process was launched.
- [Standard corpus output](electron-corpus-2026-09-23.json) records the unmodified extracted
  workspace. [Workspace recheck](corpus-recheck-2026-09-23.json) records five changed inputs
  passing and one new input failing. Nine unchanged inputs retain D21 results, not fresh tests.
- `npm run verify` and `npm run test:order`: 433/433 each, zero skips. `benchmark:check`:
  all six pass. A concurrent benchmark/corpus attempt overlapped the order suite's build
  recreation and failed module loading; both passed after the suite finished.
- No GUI/lifecycle/package code changed. The historical D21 Electron/package evidence is
  not relabeled as fresh, and the existing ZIP does not include this schema fix.

Ignored evidence: `tsukuru-agent/tmp/d22/` (requests, RED/GREEN, verify/order/benchmark,
private catalogs, workspace copies and source/round-trip snapshots). Launch-profile
isolation and manual gameplay are follow-up tasks D22-04–06, not completed acceptance.
