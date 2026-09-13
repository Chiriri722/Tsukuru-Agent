# Feature Specification: Safe patch maintenance workflow

**Feature**: `002-safe-patch-workflow`
**Implementation branch**: `chore/hardening-integration` (existing worktree)
**Created**: 2026-09-08
**Status**: Implemented and locally verified; uncommitted integration worktree
**Input**: Integrate Spec-kit, Codex Security, Linear and Sentry, then continuously resolve prioritized review findings.

## User Scenarios & Testing

### US1 — Reject incomplete patch mappings (Priority: P1)
An agent patches a legacy workspace without corrupting text or manifest when a coordinate is missing.

**Independent test**: Extract a synthetic Tyrano project, remove lineStart from its v1 manifest, submit a normal patch request and compare all workspace bytes.

1. Missing either/both coordinates on an affected entry returns E_MAPPING_CORRUPT without writes.
2. A valid target with an invalid unpatched neighbor in the same file also fails before recalculation.
3. Minimal v1 manifests remain readable for existing diagnostic consumers.

### US2 — Reject ambiguous affected-file mappings (Priority: P1)
Multiline replacements preserve unambiguous mappings for all entries in the affected file.

1. Reject overlapping requested/unpatched entries, equal starts and nested intervals.
2. Preserve adjacent intervals, gaps and unordered entries, shifting each neighbor by the actual delta.
3. Preserve expectedHash checks, RPG .extracteddata/mv.endLine, Wolf textLineNumber and rollback.

### US3 — Resume evidence-backed maintenance (Priority: P2)
The maintainer can find the active spec, Linear issues, security proof and Sentry connection status.

1. Official Spec-kit PowerShell scripts and Codex skills resolve this feature in the existing worktree.
2. Linear issues reference acceptance checks and distinguish local verification from publication.
3. Sentry reads use credentials only for authentication and report missing permissions without exposing private payloads.

## Requirements

- **FR-001**: Validate every entry whose mapping will change before any splice or write.
- **FR-002**: Writable ranges are integer half-open intervals: 0 <= lineStart < lineEnd <= lineCount.
- **FR-003**: Ranges in an affected physical file cannot overlap; alternative path spellings cannot create independent mapping groups for one target.
- **FR-004**: Preserve v1 reader compatibility, v2 schema errors, requested hash semantics and batch rollback.
- **FR-005**: New runtime dependencies, GUI telemetry and automatic game-text upload are outside scope.
- **FR-006**: Preserve main's document changes and all other worktrees.
- **FR-007**: Persist spec/plan/tasks/verification and non-secret plugin links; never commit credentials.
- **FR-008**: Run focused RED/GREEN regressions, independent security review, verify, fixed-order tests and benchmark:check.

## Success Criteria

- **SC-001**: Original missing-coordinate trigger fails with unchanged text, manifest and legacy mappings.
- **SC-002**: Confirmed neighbor/alias bypasses fail before writes; valid multiline translations remain apply-ready.
- **SC-003**: Official prerequisites resolve this spec/plan/tasks and Linear links are real.
- **SC-004**: Sentry has a proven authorized read or an explicit permission blocker, never a false zero-issue report.
- **SC-005**: Applicable repository gates pass; external release gates remain separately identified.
