# Tasks: Local translation review preparation

**Input**: [spec](spec.md), [plan](plan.md), research, data model and contracts.
Tests are required by the repository constitution. Paths below are repo-relative.

## Phase 1: Setup

- [x] T001 Compare proposals and record clean-room scope and decisions in `specs/004-review-preparation/research.md` (FR-009).

## Phase 2: Foundational

- [x] T002 Add failing option/privacy/preservation coverage in `tsukuru-agent/test/integration/rpg-review.test.js` (FR-007–009).
- [x] T003 Add v2 options and versioned review artifact contract, types and examples in `tsukuru-agent/src/core/schema.ts` and `tsukuru-agent/src/core/contracts/` (FR-004, FR-006, FR-009).

## Phase 3: User Story 1 — Source context

Goal: selected rows keep original IDs and source boundaries. Independent test:
cross-event/page/indent fixtures, explicit/unknown speaker, unchanged inputs.

- [x] T004 [US1] Add source/context/stale mapping regression to `tsukuru-agent/test/integration/rpg-review.test.js` before implementation (FR-001–004, FR-008).
- [x] T005 [US1] Share message traversal in `tsukuru-agent/src/js/rpgmv/messageQuality.ts` and build bounded review rows in `tsukuru-agent/src/js/rpgmv/review.ts` (FR-001–004, FR-006).
- [x] T006 [US1] Integrate guarded publication, cancellation and diagnostic omission in `tsukuru-agent/src/cli/operations/verify/manifest.ts`, `verify.ts` and `src/cli/run.ts` (FR-007–009).

## Phase 4: User Story 2 — Offline glossary preview

Goal: deterministic relevant terminology. Independent test: competing definitions,
overlapping occurrences, caps, digest changes, explicit languages and no network.

- [x] T007 [US2] Add glossary/preview failing regression in `tsukuru-agent/test/integration/rpg-review.test.js` (FR-005–007).
- [x] T008 [US2] Implement bounded occurrence selection and offline preview in `tsukuru-agent/src/js/rpgmv/review.ts` (FR-005–007).

## Phase 5: Acceptance and handoff

- [x] T009 Review the diff; run targeted tests and sequential verify/order/benchmark gates; record actual results in `specs/004-review-preparation/verification.md` (all FRs; SC-001–004).
- [x] T010 Update `README.md`, `CHANGELOG.md`, `task_plan.md`, `New-task-plan.md`, `docs/current-state.md`, `findings.md` and `progress.md`; keep D22 and release limitations explicit (FR-009, SC-004).

## Dependencies and execution

T001 → T002–T003 → T004–T006 → T007–T008 → T009–T010.
Write each scenario before its behavior; failed contracts can share the initial
test file. No implementation tasks are parallel: they share files and build output.
Read-only contract/source research may run together, as performed in Phase 0.
Deliver US1 without preview first; then US2; finally full regression and docs.
