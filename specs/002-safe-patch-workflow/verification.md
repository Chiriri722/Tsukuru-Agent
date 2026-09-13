# Patch mapping and maintenance verification — 2026-09-08

**Candidate**: uncommitted changes on `chore/hardening-integration`, base
`80d2043c67ac8bd9a0a4a466107777ef07489d0a`.
**Outcome**: `fixed` — all applicable ordered verification gates passed.
**Environment**: Windows, Node 24.14.0, npm 11.19.1, installed application lockfile
dependencies; no runtime dependency change.

## Vulnerable path and invariant

A legacy v1 manifest requires only id/extractFile/hash for diagnostic reads.
CLI `handlePatch` and dictionary application call shared `applyPatches`.
Missing lineStart previously passed numeric comparisons, reached splice and
the line-delta walk, inserted text instead of replacing it, and serialized NaN
as null. A valid target with an invalid or overlapping unpatched neighbor also
reached that walk. Raw path strings could partition one target into multiple
groups and leave a neighbor's mapping stale.

Before any splice or write, every entry recalculated for an affected file must
have an integer half-open interval within the current text, with no overlap.
Different path spellings of that target cannot form independent groups.
Read-only minimal v1 manifests, expected-hash errors, valid adjacency/gaps and
unordered entries, RPG/Wolf legacy mapping regeneration, and rollback remain
supported.

## Change and independent review

`tsukuru-agent/src/cli/patcher.ts` validates the affected entries at the shared
mutation boundary and reuses that validated ordering in the delta walk.
Canonicalization checks containment before filesystem access and resolves
links through the existing path policy. Native realpath identifies existing
aliases without adding Unicode normalization. Unrelated absolute/escaping
legacy entries are not probed, while affected unsafe paths are rejected by
the existing resolver. Windows device/extended-namespace paths are explicitly
rejected before probing; their aliases cannot be mistaken for unrelated paths.
Generic v1/v2 schemas and the atomic writer are unchanged.

The required independent pre-patch investigator traced callers, v1 compatibility,
the full-file delta walk and RPG/Wolf mappings. One fresh read-only candidate
review found two regressions: probing unrelated absolute/UNC paths and
conflating distinct NFC/NFD filenames. Both were reproduced by new failing
tests and corrected. This was one review cycle; no second reviewer approval
is implied. Additional alias controls cover dot/parent components, case,
absolute in-root paths and Windows default-stream spelling, including requests
for one or both aliased entries.

A final parent challenge reproduced an extended-namespace alias escaping the
lexical containment comparison (7 pass / 1 fail in `patch-namespace-red.log`).
Device namespace forms are now rejected for mutation and are included in the
same alias regression. Generic legacy reads remain unchanged. The full gates
were rerun after this final source change.

## Ordered verification

All commands below run from `tsukuru-agent` unless marked repository root.
Logs live in ignored `tmp/review-2026-09-08/`; this document preserves the
portable findings and outcomes.

| Gate | Command / evidence | Result |
| --- | --- | --- |
| RED on original implementation | `node --test --test-isolation=none test/integration/patch-mappings.test.js` | 1 pass / 5 fail; missing target/neighbor, invalid bounds, overlap, aliases and agent trigger reproduced (`patch-red.log`) |
| RED on first candidate | same focused command after reviewer regressions added | 6 pass / 2 fail; unrelated path probing and Unicode collision (`patch-review-red.log`) |
| Type/build | `npm run typecheck`; `node node_modules/typescript/bin/tsc -p tsconfig.build.json` | pass after reviewer corrections |
| Trigger, alternate inputs and controls | focused command above | 8/8 pass, no skips (`patch-green.log`) |
| Nearest existing behavior | `node --test --test-concurrency=1 test/integration/patch-mappings.test.js test/integration/rpg-smoke.test.js test/integration/wolf-smoke.test.js test/integration/bounded-fuzz.test.js test/integration/core.test.js test/contract/versioned-schema.test.js test/e2e/cli-operations.test.js` | initial candidate 124/124 pass (`patch-focused.log`); final versions included in full verification below |
| Full required checks | `npm run verify` | 403/403 pass, no skips; version/type/style/complexity/generated/inventory/supply-chain pass (`final-verify.log`) |
| Fixed order seed 1414747474 | `npm run test:order` | 403/403 pass, no skips (`final-order.log`) |
| Six engine/container performance cases | `npm run benchmark:check` | all six pass CI correctness/time/RSS limits (`final-benchmark.log`) |

The first full run had 402/403 passes: the sole failure was the existing CI
contract's hardcoded inventory expecting the old suite. Updated
`test/contract/ci-contract.test.js` and the README inventory to 59 files and
396 top-level checks (403 including nested tests); the full rerun passed.
The failed run is preserved as `verify-inventory-red.log`.

The original real-extract → malformed v1 → agent patch trigger now returns
`E_MAPPING_CORRUPT`, and a snapshot compares every workspace/source byte before
and after rejection. Missing start/end/both on targets and recalculated
neighbors, overlap classes and aliases receive the same no-write proof.
Wrong types already rejected by the schema retain `E_MANIFEST_CORRUPT`.
Successful multiline adjacency/gap/unordered controls assert shifted neighbor
coordinates and preserved untouched legacy entries; the full suite covers
RPG/Wolf apply, original hashes, legacy mappings and rollback.

## Tooling evidence

- Official Spec-kit CLI 1.0.4 installed in ignored `tmp/spec-kit-venv`.
  Ten generated Codex skills and official PowerShell assets are versioned with
  the upstream MIT license; 23 executable/template/workflow assets have size
  and SHA-256 provenance in `.specify/upstream-assets.json`.
- Repository-root `check-prerequisites.ps1 -Json -RequireSpec -RequireTasks
  -IncludeTasks` with `SPECIFY_FEATURE=002-safe-patch-workflow` resolved the
  feature successfully. The local feature pointer is ignored; no Git branch
  switch or commit was performed by setup.
- Linear project and DAV-38 through DAV-41 are real linked records. See
  [integration IDs](../../docs/maintenance-integrations.json).
- Sentry replacement-token read succeeded on
  `the-voltex-club/tsukuru-agent` via `https://de.sentry.io`: last 24 hours,
  prod, unresolved, result `[]`. The original token returned HTTP 403. No
  broader all-time/all-environment health claim is made. Credentials were
  supplied transiently and their local file is Git-excluded.
- A proposed retry over both token entries was rejected by automatic approval
  review because it exceeded replacement-token scope. It did not execute.
  The narrower replacement-token-only query was approved and succeeded.
- The codebase graph `tsukuru-review-integration` was refreshed; direct source
  and tests remain authoritative where fast indexing excludes files.
- Final document links and JSON parsed successfully; `git diff --check`
  passed in both edited worktrees. All 23 upstream asset hashes/sizes matched.
  No token-shaped value was found in the 47 reviewable changed/new files;
  the canonical checkout confirms the supplied credential file is ignored.

## Files and continuation

Production: `tsukuru-agent/src/cli/patcher.ts`.
Tests: new `test/integration/patch-mappings.test.js`, existing inventory
expectation in `test/contract/ci-contract.test.js`.
Documentation: README, CHANGELOG, release notes/checklist, this feature's
spec/plan/tasks/report, development workflow and integration mapping.
Tooling: root AGENTS.md, `.specify`, `.agents/skills/speckit-*`, LF attributes.
Canonical main's handoff/review documents point to this worktree; main's
production code and the three other dirty worktrees remain unchanged.

No source commit, merge, push, deployment, online npm audit, hosted CI,
packaging rebuild, actual Electron smoke or real-game gameplay was performed.
GUI/IPC and packaging code are unchanged, so their specialized local gates
are not required for this patch; a release still needs its own exact-source
evidence and the existing release checklist. Testing used synthetic fixtures
and installed dependencies. Local supply-chain checks are inventory checks,
not a new vulnerability feed query. No Sentry SDK or automatic game-data
transmission was added.
