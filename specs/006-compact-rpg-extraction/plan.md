# Implementation Plan: Compact RPG translation packs

**Branch**: `main` | **Date**: 2026-10-02 | **Spec**: [spec.md](spec.md)

## Summary

Add explicit v2 `translationPack:true`. Select only RPG data inputs and optional
plugin registry; reuse the existing extractor, mappings, patch and verification.
A separate pack schema identifies the source and seals immutable inputs/mappings.
At apply, authenticate against a freshly extracted small source view and reconnect
the original game inside existing transaction/protected-file/container checks.

## Technical Context

**Language/Version**: TypeScript 5.5, Node 24, current Electron 43.
**Primary Dependencies**: Existing @electron/asar, fs, crypto, Acorn; no additions.
**Storage**: Portable folder and versioned JSON metadata; no absolute source path.
**Testing**: Existing node:test infrastructure; synthetic integration/contract tests.
**Target Platform**: Windows; platform-independent extraction logic.
**Project Type**: CLI and Electron application.
**Performance Goals**: No full payload expansion during compact extraction;
private packs each less than 10% of original game size.
**Constraints**: Preserve original files, stale-source guards, rollback, existing
004/005 work, v1 and full-workspace contracts. No game/plugin execution.
**Scale/Scope**: Two Electron ASAR MZ/Live2D games and one loose MV/NW game.
Packaged NW archives keep their existing workflow and receive an explicit error
for this new mode. Generic plugin-code translation is outside this change.

## Constitution Check

- Source/pack preservation and transactional output: required before publication.
- Explicit additive v2 request plus new pack schema; old behavior stays intact.
- Focused RED tests precede implementation. Reuse shared checks and service.
- Publishable synthetic fixtures only; private outputs stay outside tracked files.
- Local evidence only; no game data sent to integrations. Research tools were read-only.

Pre-design and post-design checks pass. No exceptions or new dependencies.

## Project Structure

- `tsukuru-agent/src/core/rpgTranslationPack.ts`: metadata, path/hash validation,
  bounded selected source access.
- `tsukuru-agent/src/cli/operations/extract.ts`: compact staging and publication.
- `tsukuru-agent/src/cli/operations/apply.ts`: source reconnection and protected
  registry approval after exact mapped changes are validated.
- `tsukuru-agent/src/cli/formatDetect.ts`, `run.ts`: pack identity and resource scope.
- `tsukuru-agent/src/core/contracts/`: schema, types, example and catalog.
- `tsukuru-agent/test/integration/rpg-translation-pack.test.js`: end-to-end boundaries.
- This directory: research, data model, contracts, quickstart, tasks and evidence.

**Structure Decision**: Extend existing boundaries. Do not introduce a plugin
framework, new archive abstraction or automatic translator.
