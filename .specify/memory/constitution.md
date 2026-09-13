# Tsukuru Agent Constitution

## Core Principles

### I. Preserve game and workspace data
Preserve original games/archives by default. Validate before mutation; install related artifacts transactionally and roll back failures. Never bypass signatures, integrity or protected-script checks.

### II. Keep contracts explicit
Request/result/manifest v1/v2 compatibility is deliberate. Preserve diagnostic reading when closing unsafe mutation paths. Return structured errors; stdout contains one final JSON object and logs use stderr.

### III. Prove fixes before closing findings
Write a focused failing regression, trace the shared boundary and its callers, then implement the smallest complete fix. Apply Codex Security's independent investigation and candidate review to security findings. Existing suite success does not invalidate a new reproducer.

### IV. Keep source and evidence reproducible
TypeScript is authoritative; generated JavaScript belongs under .build/app. Preserve lockfiles and supply-chain inventories. Record branch/commit and actual commands/results. Synthetic fixtures must not contain private games.

### V. Integrate tools with least data exposure
Spec-kit owns requirements and acceptance tasks; Linear tracks the same work with stable links. Sentry is read-only diagnosis unless telemetry is separately scoped. Never publish tokens, game text, private paths or raw crash payloads.

## Development Workflow
Follow CONTRIBUTING.md and the active spec. Final gates: npm run verify, npm run test:order and npm run benchmark:check. GUI changes additionally require test:electron; package changes require build/verification. Record external checks separately.

## Governance
Current user instructions take precedence. Constitution changes must explain compatibility consequences. Historical checkboxes do not override source evidence. Tool setup does not automatically authorize publication, account-wide changes or recurring uploads.

**Version**: 1.0.0 | **Ratified**: 2026-09-08 | **Last Amended**: 2026-09-08
