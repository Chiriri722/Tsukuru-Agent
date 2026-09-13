# D21 verification — in progress

Date: 2026-09-13. Implementation checkout: `chore/hardening-integration@80d2043` plus preserved earlier work.
Canonical main: `5884d62` (latest commit is documentation). Not yet committed/merged/released.

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
passed 40/40 focused checks; final CSV equivalence and full gates follow below. The reviewer used
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

## Pending acceptance

- Final documentation and complete acceptance checks.
- Review findings reproduced and corrected; final focused test result pending.
- Full verify/order/benchmark/Electron and relevant package gates (not yet run for this feature).
- Recheck affected private-corpus cases after final parser corrections.
- Main documentation merge and removal of the now-preserved redundant worktrees.

## Quality interpretation

Mechanical integrity, output structure, language/context review, semantic alignment and actual gameplay
are separate. Source retention and name/credit fields carry review reasons; balanced quote-style changes
are informational. Pure semantic swaps cannot be identified solely from tokens, IDs or Japanese counts.
The original external-message CSV is preserved in new Backup workspaces. Old expanded packs need their
original CSV when no Backup CSV is present; absence is not a successful source verification.
