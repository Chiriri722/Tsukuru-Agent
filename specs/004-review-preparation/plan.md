# Implementation Plan: Local translation review preparation

**Branch**: `main` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification; baseline `fc0e9ea`.

## Summary

Add optional RPG-only v2 `verify.options.review`. Reuse the validated apply plan,
manifest hashes, source message boundaries and exclusive local report writer.
No new operation, provider, dependency or GUI. Foreign implementation source is
outside this independently implemented feature.

## Technical Context

**Language/Version**: Existing TypeScript 5.5 and Node 22/24.
**Primary Dependencies**: Existing runtime and Node standard library only.
**Storage**: Explicit local JSON artifact outside inputs; no-clobber publication.
**Testing**: Existing node:test suite and synthetic RPG fixture.
**Target Platform**: Existing Windows/Linux CLI; local Windows verification.
**Project Type**: CLI and shared RPG service.
**Performance Goals**: One source traversal; at most 500 selected rows, 50 context
lines/group, 64 glossary terms and 16 MiB serialized artifact; existing benchmark gate.
**Constraints**: No network/game execution, input mutation or game text in diagnostics.
**Scale/Scope**: Extracted RPG MV/MZ, manifest v1/v2, v2 request opt-in only.

## Constitution Check

Before research and after design: PASS. FR-007–009 preserve inputs and interfaces.
New request/artifact schemas, types and negative tests cover trust boundaries.
TDD uses synthetic data. The whole inline review configuration is omitted from
ordinary diagnostic serialization. No external publication, telemetry or bypass.

## Project Structure

- `src/js/rpgmv/messageQuality.ts`: shared original message traversal.
- `src/js/rpgmv/review.ts`: context rows and glossary preparation.
- `src/cli/operations/verify/manifest.ts`: reuse validation plan.
- `src/cli/operations/verify.ts`, `src/cli/run.ts`: runtime, target and privacy handling.
- `src/core/schema.ts`, `src/core/contracts/`: options, artifact types/schema/examples.
- `test/integration/rpg-review.test.js`: integrated behavior and failure regression.
- This feature directory: research, data model, contracts, quickstart, tasks, evidence.

**Structure Decision**: Extend verification; payload stays outside AgentResult.
Existing patch/apply remains the sole mutation path.

## Complexity Tracking

No constitution exceptions. Existing exclusive writer is reused without path
redaction for the explicit artifact, with additional link/containment guards.
Inline configuration avoids another file loader; diagnostics omit it entirely.
