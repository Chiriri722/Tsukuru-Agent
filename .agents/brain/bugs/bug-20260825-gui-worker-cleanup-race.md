# Bug: GUI worker fixture reported child cleanup before process exit

**Date Reported**: 2026-08-25
**Date Fixed**: 2026-08-25
**Reporter**: Codex randomized Linux validation
**Assignee**: Codex
**Severity**: MEDIUM
**Status**: FIXED

## Problem

The GUI cancellation regression fixture posted `child-process: close`
immediately after requesting termination. The parent executor could therefore
settle while the child PID was still alive, producing intermittent Linux test
failures and weakening the cleanup assertion.

## Reproduction and evidence

- Before the fix, 8 of 10 repeated Linux runs failed the child-cleanup test.
- The existing assertion in `test/unit/gui-worker.test.js` observed a live PID
  after `GuiWorkerExecutor.terminate()` returned.
- A sandboxed Windows run also demonstrated why process-tree tests require
  normal OS termination permission; the same test passed 4/4 with that
  permission.

## Root cause

`test/helpers/blocking-operation-worker.js` treated a kill request as a close
confirmation. It did not await the child process's `close` or `error` event, and
the cleanup message could race ahead of actual process reaping.

## Fix

The fixture now creates a bounded child-close promise before issuing the kill,
waits for the actual event, removes staging, and only then posts the close and
operation result/error messages. Registering before `taskkill` also avoids
losing an already-queued event on Windows.

## Files modified

- `tsukuru-agent/test/helpers/blocking-operation-worker.js`

The existing `tsukuru-agent/test/unit/gui-worker.test.js` termination assertion
is the regression test; it failed before the fix and requires both staging
removal and PID death.

## Verification

- Windows with normal process-tree permission: 4/4 focused tests pass.
- Linux final fixture: 10 parallel runs, 40/40 tests pass.
- Linux full verify and fixed-order runs: 0 failures.
- Windows normal and fixed-order suites: 365/365.

## Similar-pattern review

Process termination and `close` handling were searched across `src`, `test`,
and `scripts`. Production `processRegistry.ts` registers its untracking listener
at spawn time and checks tracked state before adding a waiter, so it does not
share this fixture's premature-close behavior. Runtime launch-probe coverage
already exercises delayed Windows exit-event delivery and descendant cleanup.

## Prevention

Never equate sending a termination signal with confirmed cleanup. Register
completion listeners before a synchronous tree-kill call, keep the wait bounded,
and assert both artifact removal and PID death in cross-platform regressions.
