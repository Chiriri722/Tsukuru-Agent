# Research — D22-04

## Decision: set Electron paths before original main

Environment-only redirection cannot override Windows Known Folder lookup. `--user-data-dir` covers early Chromium user data, not appData. Add a bootstrap entry only in the disposable ASAR, synchronously set/read back app paths, then require the unchanged CommonJS main. Keep app.asar at its normal path. Reject NODE_OPTIONS injection, fuse weakening, environment-only redirection and archive rename plus undocumented app.setAppPath.

Sources: [Electron app paths](https://www.electronjs.org/docs/latest/api/app), [Electron mapping](https://github.com/electron/electron/blob/main/shell/common/electron_paths.h), [Chromium Windows lookup](https://github.com/chromium/chromium/blob/main/base/base_paths_win.cc), [early user-data switch](https://github.com/electron/electron/blob/v40.0.0/shell/app/electron_main_delegate.cc), [environment variables](https://www.electronjs.org/docs/latest/api/environment-variables).

## Decision: Windows job owns descendants

Use unnamed non-inheritable KILL_ON_JOB_CLOSE job, no breakaway, and STARTUPINFOEX / PROC_THREAD_ATTRIBUTE_JOB_LIST for atomic assignment. After root exit, timeout or cancellation, terminate remaining members and confirm ActiveProcesses=0 before cleanup. Broker observes stdin closure and has an observation limit; caller adds a bounded watchdog. No fallback to an unisolated spawn.

Reject taskkill-only because an exited parent can leave descendants. Suspended-create then assign also leaves an orphan window if the broker dies between calls. No native addon is necessary.

Sources: [Microsoft atomic assignment](https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812/), [job inheritance/lifecycle](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects), [accounting](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_accounting_information).

## Scope

Windows 10+, recognized Electron fuse wire with embedded ASAR integrity disabled, contained CommonJS entry. Refuse unsafe/ESM/HTML entry, unknown/enabled integrity and unsupported OS before game execution. OnlyLoadAppFromAsar requires no weakening. Report instrumentation explicitly. Native Known Folder calls, hard-coded absolute destinations and external-service process launches are outside the profile contract. No private game executes during implementation.

Spec-kit research delegation was read-only. Parent traced apply→copy→runLaunchProbe and existing lifecycle helpers; independent official-source research confirmed environment and root-exit gaps.

## Integration review

PowerShell is outside Electron's virtual filesystem, so its script is copied
from the packaged ASAR to the owned physical probe root before `-File` launch.
The bootstrap loads original main with `Module._load(..., null, true)` to
preserve `require.main`, `module.id` and `process.mainModule`, as Electron's CJS
entry loader does. Real normal/unpacked fixtures validate those semantics.

Sources: [ASAR filesystem limits](https://www.electronjs.org/docs/latest/tutorial/asar-archives),
[CommonJS main identity](https://nodejs.org/api/modules.html#accessing-the-main-module),
[Electron entry loader](https://github.com/electron/electron/blob/v40.0.0/lib/browser/init.ts).

Final packaged testing found that ordinary Electron fs treats external game
archives as virtual directories. Use its built-in original-fs at shared external
file boundaries, following the same runtime selection already used by
@electron/asar. Do not toggle process.noAsar globally: internal schemas and the
bundled broker asset still need the host ASAR filesystem. A read-only follow-up
trace confirmed the affected path/copy/hash/resource/transaction callers.
