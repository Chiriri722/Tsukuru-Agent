# Verification — local review preparation (2026-09-29)

Baseline: `main@fc0e9ea` (`v.2.5.29`). Changes are local and uncommitted.
User-provided `Pro 답변.txt` was read and left unchanged/untracked. Only external
READMEs informed feature comparison; no foreign implementation source or dependency
was imported. See [adoption decisions](research.md).

## Scope delivered

- V2 RPG verify opt-in, selected manifest rows with source/current fingerprints,
  categories and original event/page/indent grouping; explicit/unknown speakers.
- Bounded offline glossary selection with priority and per-occurrence overlap
  handling, request/glossary/context fingerprints and omission counts.
- Explicit local payload only, diagnostic omission, no-clobber publication,
  link/containment guards and cancellation cleanup. No alternate patch route.

## Reproduction and focused verification

- Before implementation: new tests 1 pass / 4 fail; v2 rejected the absent review
  option. These are behavioral REDs, not compilation errors.
- Added source pagination, long message blocks, portable packs, hash changes,
  mechanical failure with useful review, and forbidden network-call checks.
- Dot-prefixed report destinations reproduced an inherited containment mistake:
  a child named `..review.json` was treated as a parent traversal. Fixed the shared
  predicate after tracing diagnostic/review callers. Child variants now fail;
  a genuine sibling destination still works.
- Report/diagnostic destination collision and 1 ms timeout each failed a focused
  preservation assertion before their fixes. They now produce no review artifact.
- `npm run compile`: PASS.
- `node test/integration/rpg-review.test.js`: 7/7 PASS.
- `node test/unit/diagnostics.test.js`: 4/4 PASS.
- `node test/unit/translation-lint.test.js`: 4/4 PASS.
- `npm run check:complexity`: PASS (existing function ceiling retained).

## Real extracted-workspace check

The previously approved new Electron/MZ sample was read from its existing extracted
working copy. Report output stayed under ignored repository `tsukuru-agent/tmp`.
No game process or provider was started; no writes targeted the private game drive.

| Evidence | Result |
|---|---|
| Existing manifest | 19,465 entries |
| Selected original 401 dialogue IDs | 5 |
| Source message groups | 2 |
| Mechanical integrity | pass |
| Review schema | 1; 6,430-byte local artifact |
| Workspace input file hashes | all 47 unchanged |

Raw reports and helper contain private source text/paths and remain ignored. Public
summary is `tmp/review-corpus.sanitized.json`; only counts are reproduced here.
This is read-only preparation evidence, not translation-quality or gameplay approval.

## Full gates

First `npm run verify`: 439/440 passed. The sole failure was the CI contract's old
literal inventory count (61/426 instead of 62/433); updated the expectation and README.
Final results, run sequentially against this source:

| Command | Result |
|---|---|
| `npm run verify` | PASS; 440/440 runtime tests; version/type/style/complexity/generated/inventory/supply-chain checks pass |
| `npm run test:order` | PASS; 440/440 with fixed seed |
| `npm run benchmark:check` | PASS; all 6 scenarios |
| `git diff --check` | PASS |

Inventory is 62 files / 433 top-level tests; seven nested checks account for the
440 runtime total. Logs remain ignored under `tsukuru-agent/tmp/review-*.log`.

## Execution notes and limits

The sandbox's child-process restriction produced `spawn EPERM` for `node --test`;
focused tests ran directly with Node and full gates use approved escalation.
Spec-kit quality checklist passed 16/16; requirements/tasks coverage is 9/9.
One delegated read-only planning investigation checked integration/compatibility;
implementation and candidate diff review were performed by the primary agent.
No claim of a formal security scan or legal clean-room certification is made.

No GUI/IPC/worker or packaging configuration changed, so Electron/package rebuild
gates do not apply to this source increment. Hosted Linux/Windows CI, fresh release
checkout, signing/publication and gameplay are separate. Existing ZIPs are unchanged.
D22 profile isolation, failed-pack semantic repair and later proposal import/runtime
rendering remain open; none is implied by a successful review artifact.
