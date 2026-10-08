# Implementation Plan: Launch profile isolation

**Branch**: `main` | **Feature**: `005-launch-profile-isolation` | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

## Summary
Keep the existing disposable game copy. Add a unique empty profile, a bootstrap entry in only the copy's ASAR, and a Windows job owner. Set/read back supported Electron paths before loading unchanged original CommonJS main. Never modify source/final ASAR, executable fuses or signatures. Refuse unsupported runtime/entry/integrity combinations before game launch.

## Technical Context
- Existing TypeScript, Node 22/24, @electron/asar, container extract/pack policy, spawnTracked and atomic cleanup. No new packages.
- Windows 10+; a small PowerShell/C# owner uses native job APIs. Static asset staging already copies these extensions.
- Profile paths, bootstrap proof and bounded process report live inside the unique probe root.
- Support: contained CommonJS main, recognized Electron fuse wire, embedded ASAR integrity explicitly disabled. Unknown fuses, enabled integrity, HTML/ESM main, unsafe paths and other OSs are refused.
- Preserve 250–15000 ms observation window with a separate bounded broker startup/cleanup allowance.
- node:test synthetic fixtures and installed real Electron; mandatory verify, test:order, benchmark:check, test:electron gates run sequentially.

## Constitution Check
Pre-research and post-design: PASS. Preserve source/output and integrity gates; additive result schema/types/examples/tests; RED before implementation; no private fixtures or publication. This is runtime data-preservation work, not a claimed hostile-executable security fix. Codex Security fix-finding was checked for applicability and is not invoked. Spec-kit's read-only research agent checked official runtime/OS behavior.

## Project Structure
- src/core/electronProfileProbe.ts: preparation, environment, bootstrap and isolated execution.
- src/core/windowsProbeJob.ps1: atomic job launch and zero-active-descendant confirmation.
- src/core/runtimeDiagnostics.ts: additive result types.
- src/core/physicalFs.ts: native file access for external game archives under Electron; shared container/path/transaction/resource/copy boundaries use it, while bundled schema/assets keep virtual fs reads.
- src/cli/operations/apply.ts: safe opt-in route and lifecycle-aware cleanup.
- test/integration/launch-profile.test.js: real-runtime/canary/lifecycle regressions.
- test/e2e/agent-workflows.test.js: unsupported refusal and no-probe compatibility.
- src/core/contracts/schemas/v1/result.schema.json and v2/result.schema.json: additive report contract.
All source/test paths above are relative to tsukuru-agent. Feature documents live here.

## Complexity Tracking
No exceptions. Native job ownership is necessary because taskkill after a parent exits cannot prove detached descendants stopped. Reuse existing archive, tracking and cleanup helpers. Standard profile redirection is not an OS sandbox for native absolute writes or external-service process launches.

Packaged acceptance found a pre-existing external-ASAR virtual-fs mismatch.
The full-flow fixture now runs its host CLI under actual Electron, and physical
filesystem selection is shared across the existing external file boundaries.
