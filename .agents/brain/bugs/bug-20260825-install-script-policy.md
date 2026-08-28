# Bug: npm dependency install script lacked an explicit policy decision

**Date Reported**: 2026-08-25
**Date Fixed**: 2026-08-25
**Reporter**: Codex clean-install supply-chain audit
**Assignee**: Codex
**Severity**: MEDIUM
**Status**: FIXED

## Problem

A clean npm 11 install completed, but reported a pending lifecycle-script
decision for `electron-winstaller@5.4.0`. The project had supply-chain drift,
audit, notice, and binary inventories, yet it did not require every lockfile
package marked `hasInstallScript` to be explicitly allowed or denied.

Expected behavior is a closed policy: a clean install has no unclassified
dependency script, and a dependency or lockfile change cannot silently add one.

## Reproduction and evidence

- Environment: Windows x64, Node 24.14.0, npm 11.19.0.
- Before the fix, a clean install warned that the
  `electron-winstaller@5.4.0` install script was pending approval.
- The RED contract failed because root `package.json` had no `allowScripts`
  decision while `package-lock.json` contained one `hasInstallScript` entry.
- `npm explain electron-winstaller` traced it through
  `electron-builder-squirrel-windows@26.15.7` and `app-builder-lib@26.15.7`.
  Tsukuru Agent builds NSIS and portable targets and does not use Squirrel.

## Root cause

npm 11 blocks unclassified dependency lifecycle scripts by default, but the
project's supply-chain contract did not model that npm policy surface. The
transitive Squirrel peer remained installed with its lifecycle hook present,
even though none of the configured build targets needed that hook.

## Fix

- Add an explicit `allowScripts` denial for `electron-winstaller`.
- Add a contract that enumerates every lockfile `hasInstallScript` entry and
  requires the exact reviewed decision map.
- Document the clean-install command and lifecycle-decision gate in the audit
  policy, Electron upgrade record, and release checklist.
- Update the declared test inventory after adding the regression.

## Files modified

- `tsukuru-agent/package.json`
- `tsukuru-agent/test/contract/supply-chain.test.js`
- `tsukuru-agent/test/contract/ci-contract.test.js`
- `tsukuru-agent/docs/supply-chain/audit-policy.md`
- `tsukuru-agent/docs/supply-chain/electron-upgrade-status.md`
- `docs/release-checklist.md`
- `README.md`

## Verification

- Supply-chain focused suite: 6/6 pass.
- Supply-chain plus CI contracts: 19/19 pass.
- Exact-source clean offline install: 467 packages installed, no pending-script
  warning, and `npm install-scripts ls --json` returned an empty allow list.
- Fresh production and full registry audits: exit 0 and zero findings at every
  severity (113 production dependencies, 467 total dependencies).
- Exact-source Windows normal and fixed-order suites: 366/366 each.

## Similar-pattern review

Repository and lockfile search found exactly one `hasInstallScript` package and
one matching explicit decision. No second lifecycle hook is currently hidden by
the package graph. The contract will fail if another entry appears or the
reviewed version/path changes.

## Prevention

Treat dependency lifecycle execution as a reviewed build input. Run a clean
install and `npm install-scripts ls --json` in release validation, require an
explicit allow-or-deny decision for every lockfile hook, and review the
dependency path and configured package targets before allowing any script.
