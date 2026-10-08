# Launch probe contract

Request unchanged: container apply `options.launchProbe=true`, optional `launchTimeoutMs` (250–15000 ms). Both v1 and v2 use the same boundary; default remains false.

Existing launch status/exit fields remain. Optional `isolation`: `strategy="electron-bootstrap-v1"`, `verified` boolean, `processTreeTerminated` boolean, `cleanup="removed"|"retained"`. Success requires verified=true, processTreeTerminated=true and cleanup=removed. Older artifacts lacking the field remain readable and imply no isolation proof.

Unsupported/failed probes return existing `E_LAUNCH_PROBE_FAILED` with reason/details; output is not committed. An instrumented startup observation does not certify gameplay, translation semantics or arbitrary native filesystem isolation.

Windows 10+ with recognized Electron fuses, disabled embedded ASAR integrity and
a contained CommonJS entry is supported. NW.js and loose workspaces reject the
option with `E_NOT_IMPLEMENTED` (or the earlier v2 option contract rejection).
No fuse is weakened. Default and `persist:` sessions use the redirected
`sessionData`; explicit `session.fromPath()` and native/hardcoded absolute writes
are outside this boundary. If the caller itself is forcibly terminated, job
closure still stops owned processes, but no final report or automatic directory
removal is promised. A live caller refuses success without all three proofs.
