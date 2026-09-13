# Implementation Plan: Safe patch maintenance workflow

**Date**: 2026-09-08 | **Spec**: [spec.md](spec.md)
**Branch**: `chore/hardening-integration`, base `80d2043`

## Summary
Install official Spec-kit 1.0.4 assets with Codex skills and PowerShell scripts. Link Linear issues and read-only Sentry diagnosis. Fix applyPatches without tightening the generic v1 reader.

## Technical Context
TypeScript 5.5, Node 22/24, npm 10/11; node:test and synchronous patch transactions.
Shared boundary: tsukuru-agent/src/cli/patcher.ts.
Callers: operations/patch.ts and dictionary application in operations/apply.ts.
Precedent: manifestRecovery.ts integer/range checks.
Tests: test/integration/patch-mappings.test.js and existing RPG/Wolf/core/CLI/contracts.
No new runtime packages; the developer CLI lives under ignored tmp/spec-kit-venv.

## Constitution Check
Source preservation, transactional failure, legacy reads, structured errors, no secret upload and independent review apply. No exception requested.

## Design
1. Find affected text files after existing patch-ID validation.
2. Validate every same-file entry before splicing: integer bounds, range limits and non-overlap.
3. Confirm alias behavior with a regression; reject ambiguous spellings when preserving separate legacy bucket identities would be unsafe.
4. Preserve requested hash checks, atomicWriteFilesSync and unrelated minimal v1 entries in untouched files.
5. Treat prior main review R2–R4 as already addressed in the integration base, backed by focused evidence.

## Validation
Capture RED before source changes. Run typecheck/compile, focused triggers and legitimate controls, one independent candidate review, then verify/test:order/benchmark:check. Verify Spec-kit prerequisites, plugin links, whitespace and credential exclusion.

## External State
Linear project Tsukuru Agent now tracks DAV-38 through DAV-41. Sentry's original
token returned HTTP 403; the replacement token successfully queried
the-voltex-club/tsukuru-agent on the EU API. The checked scope (last 24 hours,
prod, unresolved) returned zero issues. See docs/maintenance-integrations.json
for non-secret IDs and docs/development-workflow.md for continuation commands.
