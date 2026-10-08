# Tasks: Compact RPG translation packs

## Setup and foundation

- [x] T001 Inspect all three laboratory copies and existing boundaries; record evidence in research.md.
- [x] T002 Define requirements and contracts in spec.md, plan.md, data-model.md and contracts/translation-pack.md.
- [x] T003 Add and observe focused failing regression in tsukuru-agent/test/integration/rpg-translation-pack.test.js.

## US1 — Compact extraction

- [x] T004 [US1] Add explicit request/pack schema and runtime validation in tsukuru-agent/src/core/contracts and core/rpgTranslationPack.ts.
- [x] T005 [US1] Stage only selected source inputs and publish atomically in tsukuru-agent/src/cli/operations/extract.ts.
- [x] T006 [US1] Preserve pack engine identity and resource accounting in tsukuru-agent/src/cli/formatDetect.ts and run.ts.

## US2 — Safe round trip

- [x] T007 [US2] Authenticate pack/source and reuse ASAR/loose apply transactions in tsukuru-agent/src/cli/operations/apply.ts.
- [x] T008 [US2] Validate original plugin registry and allow only mapped parameter output in tsukuru-agent/src/js/rpgmv/outputValidation.ts.
- [x] T009 [US2] Verify moved packs, stale/malicious inputs, output conflicts, cancellation and rollback in tsukuru-agent/test/integration/rpg-translation-pack.test.js.

## US3 — Coverage and corpus

- [x] T010 [US3] Document plugin identifiers and implementation-script limits in README.md and compatibility documentation.
- [x] T011 [US3] Verify compact extraction and no-op/edit round trips for all three private copies; record anonymized evidence in verification.md.

## Final gates

- [x] T012 Run required repository and packaged boundary checks; record actual results in verification.md.
- [x] T013 Update task_plan.md, current state, changelog and release notes; audit every acceptance requirement.

## Dependencies and implementation strategy

T001–T003 precede behavior changes. US1 enables US2; US3 needs both. Read-only
input/contract research ran in parallel. Coverage documentation can proceed
alongside synthetic validation after contracts settle; code edits and build gates
are sequential. Initial extraction is the smallest demonstrable slice; the
requested delivery still includes all stories and all three corpus games.
