# Bug: Linux portability gaps in archive, diagnostics, license, and runtime tests

**Date Reported**: 2026-08-25
**Date Fixed**: 2026-08-25
**Reporter**: Codex cross-platform audit
**Assignee**: Codex
**Severity**: MEDIUM
**Status**: FIXED

## Problem

A clean Node 22 Linux snapshot produced deterministic failures even though the
same source passed on Windows. ASAR package entries retained a leading slash,
foreign-platform absolute paths and object keys escaped diagnostic redaction,
lowercase dependency license files were not found on a case-sensitive file
system, and runtime tests assumed that the host Node executable was a Windows PE
binary with an installed Electron binary.

Expected behavior was one portable archive policy, recursively redacted public
diagnostics, case-insensitive license filename discovery, and platform-aware
runtime tests that exercise a pinned PE fixture without downloading Electron.

## Reproduction and evidence

- Environment: Podman, Node 22.17.1, npm 10.9.2, Debian Bookworm, no network.
- Initial focused suite: 27 deterministic failures, plus a separately tracked
  worker-fixture race.
- RED regressions reproduced slash-prefixed ASAR listings, POSIX/Windows
  foreign paths in both values and keys, lowercase `license`, and Linux host
  binary assumptions.
- Final Linux `npm run verify`: 365 tests, 361 pass, 0 fail, 4 intentional
  platform/optional-binary skips.
- Final Windows `npm run verify` and fixed seed `1414747474`: 365/365.

## Root causes

1. `@electron/asar.listPackage()` returns package-root-prefixed entries; the
   adapter passed them to archive-relative validation unchanged.
2. Redaction used only the current host's `path.resolve`, and traversed object
   values without transforming keys.
3. Notice generation looked only for exact `LICENSE*` spellings; Windows hid
   the casing defect in dependencies such as `electron-store`.
4. Runtime tests used `process.execPath` and an implicit Electron binary as PE
   fixtures, coupling the suite to Windows and to an online Electron install.

## Fix

- Normalize exactly one ASAR package-root separator while preserving doubled
  absolute/UNC prefixes for rejection.
- Generate Windows, POSIX, and host path variants; recursively redact both
  object keys and values; reuse the same sanitizer for public corpus records.
- Discover regular license files deterministically with exact names first and
  a case-insensitive fallback.
- Use the checked-in PE fixture for portable parser/resource tests and skip
  only genuinely Windows-specific Authenticode/process-tree cases or an
  intentionally absent offline Electron binary.

## Files modified

- `tsukuru-agent/src/core/container/adapters/asar.ts`
- `tsukuru-agent/src/core/diagnostics.ts`
- `tsukuru-agent/scripts/run-compat-corpus.js`
- `tsukuru-agent/scripts/generate-notices.js`
- `tsukuru-agent/test/unit/archive-path.test.js`
- `tsukuru-agent/test/unit/diagnostics.test.js`
- `tsukuru-agent/test/integration/corpus-runner.test.js`
- `tsukuru-agent/test/contract/supply-chain.test.js`
- `tsukuru-agent/test/integration/runtime.test.js`
- `tsukuru-agent/test/contract/cli-snapshot.test.js`

## Verification

- Windows: normal 365/365; fixed-order 365/365; core coverage
  90.36% lines, 72.21% branches, 96.88% functions.
- Linux: normal 361 pass/4 skip/0 fail; full coverage
  89.34%/75.44%/89.78%; core coverage 90.36%/72.21%/96.88%; fixed-order
  361 pass/4 skip/0 fail.
- Fresh package: 146,849,315 bytes, SHA-256
  `68decf43860673a99e03ff1cc74a695b1dcbf49699777489657741fbc6bbdd87`,
  1,791 entries, and bounded `ok/exit0,E_REQUEST_INVALID/exit1` smoke passed.

## Prevention

Treat archive members as archive-relative data at adapter boundaries, test path
security with both platform syntaxes on every host, avoid filesystem-casing
assumptions in supply-chain tooling, and pin format fixtures instead of using a
host executable. Hosted Windows/Linux CI remains the release authority; this
local Podman run is a high-fidelity preflight, not a substitute for it.
