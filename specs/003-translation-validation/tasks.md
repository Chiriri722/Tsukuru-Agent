# Tasks: 번역 적용 무결성과 검증

**Input**: [spec.md](spec.md), [plan.md](plan.md), research/data-model/contracts/quickstart.
Tests are required by CONTRIBUTING and D21. Each behavior starts with a failing regression.

## Phase 1: Setup
- [x] T001 Inspect task_plan.md, report, current worktrees and workspace guide; record scope in spec.md.
- [x] T002 Generate official Spec-kit design artifacts in specs/003-translation-validation.

## Phase 2: Foundation
- [x] T003 Reconcile independent boundary investigation and parent trace in verification.md.

## Phase 3: US1 — rollback
Goal: failed dictionary apply leaves every existing artifact unchanged.
Independent test: snapshot source, Backup, Extract, mapping, old/custom output around failure/cancel/install fault.
- [x] T004 [US1] Add RED transaction regressions to tsukuru-agent/test/integration/rpg-translation-validation.test.js.
- [x] T005 [US1] Stage dictionary edits and group final artifact installation in tsukuru-agent/src/cli/operations/apply.ts and src/core/atomic.ts.
- [x] T006 [US1] Run focused transaction and legitimate dictionary tests; record verification.md.

## Phase 4: US2 — shared integrity and staged validation
Goal: token damage/new blank/U+FFFD cannot reach output through any RPG caller.
Independent test: direct patch/manual Extract/dictionary/service and serialized JSON/YAML/plugin/CSV controls.
- [x] T007 [US2] Add RED integrity/serialization regressions in tsukuru-agent/test/integration/rpg-translation-validation.test.js.
- [x] T008 [US2] Implement shared source-bound lint in tsukuru-agent/src/core/translationLint.ts, src/cli/patcher.ts and src/js/rpgmv/applyPlan.ts.
- [x] T009 [US2] Validate staged output before installation in tsukuru-agent/src/js/rpgmv/RpgMakerService.ts and src/core/validation/engines/rpg.ts.
- [x] T010 [US2] Cover legacy GUI instantapply and option compatibility in tsukuru-agent/test/integration/rpg-translation-validation.test.js.
- [x] T011 [US2] Synchronize diagnostics contracts/types/examples/tests in tsukuru-agent/src/core/contracts and docs.

## Phase 5: US3 — diagnostics and corpus
Goal: bounded aggregate conflicts, contextual quality review, consistent candidate selection.
Independent test: multiple hashes, page/indent/message boundaries, sidecars, known semantic swap control.
- [x] T012 [US3] Add RED aggregate/context/AppleDouble regressions in tsukuru-agent/test/integration/rpg-translation-validation.test.js.
- [x] T013 [US3] Aggregate conflicts in tsukuru-agent/src/cli/patcher.ts; preserve dictionary skip stats.
- [x] T014 [US3] Implement message/Japanese review diagnostics in tsukuru-agent/src/core/translationLint.ts and RPG context helpers.
- [x] T015 [US3] Exclude AppleDouble parser candidates in tsukuru-agent/src/js/rpgmv/RpgMakerService.ts and src/core/validation/engines/rpg.ts.
- [x] T016 [US3] Add relative origin/bucket/ID error context in tsukuru-agent/src/js/rpgmv/applyPlan.ts.
- [x] T017 [US3] Run adapted current CLI internal validator on private workspace copies; record sanitized results in verification.md.

## Phase 6: Final acceptance and integration
- [x] T018 Complete one independent candidate review; confirm findings and record verification.md.
- [x] T019 Run required verify/order/benchmark/Electron and relevant package gates from tsukuru-agent/package.json.
- [x] T020 Update task_plan.md, New-task-plan.md, README.md, CHANGELOG.md and docs/release-checklist.md.
- [x] T021 Preserve/audit all worktrees, integrate main changes, commit and clean redundant branches; record exact revisions in verification.md.

## Dependencies & Execution Order
T001–T003 → US1 → US2 → US3 → final acceptance → branch integration/recheck.
D21-08 tests accompany each step. No task is completed by a historical checkbox.
Read-only source investigation can run alongside Spec-kit writing. Within US1/US2/US3,
independent test commands may be batched after edits; shared source files are edited sequentially.

## Phase 7: D22 real-sample follow-up (2026-09-23)
Scope: the user-provided second Electron sample and reorganized/repaired workspaces.
Keep original games, existing save backups and AppData profiles unchanged; no game launch.
- [x] T022 Reproduce the RPG ASAR opt-in rejection in existing contract/workflow tests and correct only the missing engine-option declaration.
- [x] T023 Verify an isolated Electron sample copy: extract, deep verify, default repack refusal and opt-in dictionary apply; compare archive payloads, wrapper and source hashes.
- [x] T024 Locate prior workspace IDs, verify changed/new workspace copies, and retain unchanged historical results separately.
- [x] T025 Run verify/order/benchmark and update sanitized corpus evidence, task plans and current-state documentation; record untested gameplay/profile-isolation follow-up explicitly.

T022 → T023 → T024 → T025. This follow-up does not reopen D21 acceptance or authorize publishing private artifacts.

## Implementation Strategy
Finish and validate US1 first, then extend to all P0/P1/P2 stories. The user authorized
all stories and final branch/corpus work; the MVP milestone does not end this goal.
