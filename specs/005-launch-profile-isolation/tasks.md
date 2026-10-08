# Tasks: Launch profile isolation

**Input**: spec.md, plan.md, research.md, data-model.md, contracts/launch-probe.md
**Tests**: Required by FR-007 and constitution; tests precede implementation.

## Phase 1: Setup

- [x] T001 Select and validate spec/plan in specs/005-launch-profile-isolation; preserve prior changes.
- [x] T002 Trace apply/runtime/helpers and resolve OS/runtime mechanisms in specs/005-launch-profile-isolation/research.md.

## Phase 2: Foundation

- [x] T003 Reproduce environment-only failure and specify supported contract tests in tsukuru-agent/test/integration/launch-profile.test.js.

## Phase 3: User Story 1 — existing profile preservation

Independent test: real Electron fixture writes to its redirected app/session/environment paths; same-name canary and source ASAR stay unchanged.

- [x] T004 [US1] Implement bounded profile/bootstrap preparation and pre-launch refusal in tsukuru-agent/src/core/electronProfileProbe.ts.
- [x] T005 [US1] Add isolation result types/schema/examples and v1/v2 acceptance/rejection tests in tsukuru-agent/src/core/runtimeDiagnostics.ts, tsukuru-agent/src/core/contracts and tsukuru-agent/test/contract/versioned-schema.test.js.

## Phase 4: User Story 2 — lifecycle and cleanup

Independent test: early parent exit with detached child, observation timeout, cancellation and launch failure all report lifecycle honestly and preserve existing data.

- [x] T006 [US2] Add process/cleanup regressions in tsukuru-agent/test/integration/launch-profile.test.js, then implement tsukuru-agent/src/core/windowsProbeJob.ps1 and its caller.
- [x] T007 [US2] Route apply through isolated execution and cleanup proof in tsukuru-agent/src/cli/operations/apply.ts; verify rollback/no-probe behavior in tsukuru-agent/test/e2e/agent-workflows.test.js.

## Phase 5: Verification and documentation

- [x] T008 Review changed callers and both outcomes of guards; run focused and mandatory sequential checks; record actual evidence in specs/005-launch-profile-isolation/verification.md.
- [x] T009 Update README.md, docs/current-state.md, task_plan.md, progress.md, findings.md and feature selection/inventory references to reflect verified scope and remaining D22 work.

## Dependencies and implementation strategy

T001→T002→T003→T004; T005 follows result design. T006 tests precede job implementation; T007 depends on T004–T006. T008–T009 close both stories. US1 alone is only an internal preparation milestone; shipping requires US2 so cleanup safety is complete. Documentation/contract review can run independently of focused fixture execution, but build gates run sequentially. No parallel source editing is needed.
