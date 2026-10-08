# D22-04 verification — 2026-09-30

Status: implementation and required local gates PASS. Three consecutive
packaged full flows passed after one unreproduced native exit anomaly.
Baseline: `main@fc0e9ea`, with prior uncommitted 004 changes preserved. No commit,
push, hosted CI or private-game launch is part of this result.
Runtime checked locally: Windows, Node v24.14.0, Electron 43.4.1.

## Reproduction and correction

- RED: an actual installed Electron process with only APPDATA/LOCALAPPDATA
  overridden still returned the real Windows Roaming directory from
  `app.getPath('appData')`. The control reads that path and writes no existing
  game data. It now documents why environment-only isolation is insufficient.
- GREEN: a disposable ASAR bootstrap sets/read-backs seven app paths before the
  unchanged original CommonJS main; both normal and unpacked entries preserve
  `require.main` semantics. Two fresh profiles contain synthetic environment,
  save, localStorage, IndexedDB and default/persist-session writes. A same-name
  real Roaming canary retains its inventory/hash/mtime; source ASAR and unpacked
  script hashes and parent environment are unchanged.
  Later app.setPath/setAppLogsPath attempts to escape to that canary are refused;
  valid in-profile setters and default log setup preserve the redirected paths.
- Native Windows job fixtures confirm detached descendants stop after early
  root exit, observation timeout and cancellation. An asynchronously observed
  owner is forcibly killed only after its game starts; both game and broker
  PIDs disappear. The dead caller is not promised a final JSON report.
- HTML/ESM/external/missing main, unsafe app name, integrity-enabled/unknown
  runtime, already-aborted launch, executable creation failure and synthetic
  cleanup failure are refused or reported explicitly. No fuse is disabled.
- A full extract/apply flow passes canonical result validation and leaves the
  original and final archive entry unchanged. Its bootstrap exists only in the
  disposable probe. Existing v1/v2 unrecognized-wrapper checks preserve prior
  output and publish no failed output.
- RED/GREEN: legacy NW.js apply silently ignored launchProbe; it now rejects
  it before mutation. The normal no-probe NW.js round-trip still succeeds.
- Both result versions accept old/no-isolation artifacts and reject success
  with false verification/termination, retained cleanup or unknown isolation
  fields. Omitted optional `error` is absent rather than explicitly undefined.

## Review and verification adjustments

Read-only research/candidate review found that packaged PowerShell cannot open
an ASAR virtual path, and ordinary require changed main-module semantics.
The broker script is now copied to the owned physical directory and original
main is loaded with CommonJS main semantics. No new dependency was added.

Packaged acceptance also exposed an existing boundary bug: Electron's patched
`fs` interpreted an external app.asar as a directory, so detection fell through
to a loose-game parser with E_FORMAT_MISMATCH. The full-flow regression now runs
its CLI host in real Electron and reproduced that failure before the fix.
Shared external container/path/copy/transaction/resource/snapshot boundaries
now use native `original-fs` under Electron (ordinary fs under Node). The tool's
own packaged schema and broker-asset reads retain virtual fs access; the game
bootstrap's own fs is unchanged. The strengthened focused flow passes, including
an ordinary nested `assets/nested.asar` whose bytes survive extract/apply/probe.
The suggested provenance Dirent regression did not reproduce on Electron
43.4.1, so no speculative provenance or GDevelop copy change was added.

Windows file-lock failures are reported honestly; asynchronous bounded removal
retries handle transient locks after job termination. An early 1-second child
startup fixture and synchronous owner launcher were too sensitive to host load;
the final fixture waits for an observed start and preserves bounded deadlines.
Compile/build gates run sequentially; overlapping earlier runs are not evidence.

The post-correction benchmark first exceeded the unchanged ASAR 10-second
budget (21,723.517 ms). A diagnostic worker measured 23,264.839 ms, of which
21,986.174 ms was installed @electron/asar packing; parsing was 109.611 ms.
Node's physicalFs was asserted to be the exact existing fs object. A standalone
control loading only the installed asar package (no Tsukuru modules) also took
23,746.834 ms to pack the same 802 files. This reproduces the packing delay
independently of the feature. After packaging completed, the same full gate
passed all six cases (ASAR total 2,051.363 ms, packing 1,143.099 ms), without any
source, dependency or budget change. Keep the slow attempts as environment
variability evidence rather than suppressing them.

The first rebuilt-package full flow returned valid success JSON but one apply
process exited with Windows status 0x80000003. The original harness did not retain
stderr, so its cause is unknown. Bounded stderr collection was added to the local
harness; the next identical full flow exited normally with all isolation,
source/canary/main/nested-archive preservation assertions passing. Two further
identical runs also passed (three consecutive successes). No source change is
claimed to fix this single native exit; keep it as an unresolved stability
observation for subsequent real-game/release verification.

## Gates

| Gate | Result |
|---|---|
| `npm run verify` | PASS 449/449 after physical-fs correction; version/type/styles/complexity/generated/inventory/supply-chain checks pass |
| `npm run test:order` | PASS 449/449 after physical-fs correction, seed 1414747474; includes nested ASAR byte preservation |
| `npm run benchmark:check` | PASS six cases on final confirmation; earlier standalone packing slowdown retained above |
| `npm run test:electron` | PASS after correction: real renderer/IPC/RPG/Wolf/settings/navigation, sandbox/contextIsolation preserved |
| `npm run build:cli` | PASS rebuilt CLI ZIP, 146,875,643 bytes / 76 entries |
| `npm run verify:package` | PASS 1,805 ASAR entries; required assets plus success exit 0 / E_REQUEST_INVALID exit 1 |
| Packaged synthetic extract/apply/probe | PASS three consecutive runs with Korean/spaced TEMP path, original/main/nested-ASAR bytes and real Roaming canary preserved; one earlier native exit anomaly retained above |

Inventory: 63 files / 442 top-level declarations; nested tests explain the
runtime total. CLI ZIP SHA-256:
`0c050657c59390d47c4cdfc5f6128f2149ceabe5b6e335999aa2936b3ed8663e`.
This is a local dirty-worktree build, not a published or signed release.
Raw local logs are under ignored `tsukuru-agent/tmp/profile-*.log`.
Early failed-run synthetic folders and their test-only Roaming canaries were
removed after validating exact ownership boundaries and inactive fixture PIDs.
After the full suites, no `tsukuru-profile-*` or `tsukuru-agent-launch-*` test
directories remained in the temporary root.
Final packaged/control cleanup also left zero owned temporary directories and
zero synthetic Roaming canaries. Owned profile log scans found no remaining
credential-key markers. The final source also passed git diff --check.

## Limits

Supported: Windows 10+, recognized Electron fuses with embedded ASAR integrity
disabled, contained CommonJS entry. The contract covers seven app paths,
related environment variables and default/persist sessions. It is not an OS
sandbox for native Known Folder calls, arbitrary absolute writes, explicit
session.fromPath or external-service process launches. Missing termination
proof retains the owned directory and cannot produce successful apply.
Private-game startup/save-load remains D22-06; failed work packs remain D22-05.

During an early failed assertion, a whole-environment comparison exposed
credential values in local test output and tool history. The local log was
sanitized and the assertion now compares booleans without printing values.
The affected HINDSIGHT_API_EMBEDDINGS_API_KEY and HINDSIGHT_API_LLM_API_KEY
credentials require rotation; no values are included in this document or
checked-in fixtures. Local log cleanup does not erase tool history.
