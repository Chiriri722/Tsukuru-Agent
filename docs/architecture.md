# Tsukuru Agent architecture

Tsukuru Agent has one translation core with two entry surfaces: a JSON CLI for
agents and CI, and a sandboxed Electron GUI for interactive work. Both surfaces
must reach engine code through the same validation, runtime, and transaction
boundaries.

## Follow the request from the edge to the filesystem

```text
CLI request / GUI action
        |
        v
entrypoint + versioned contract validation
        |
        v
format/container detection + resolved-option validation
        |
        v
resource preflight + OperationRuntime
        |
        v
operation dispatcher + engine service
        |
        v
staging / WorkspaceTransaction
        |
        v
structural validation + provenance/source recheck
        |
        v
atomic publication + versioned result
```

The final path is not visible until validation succeeds. A thrown error,
timeout, cancellation, changed source, or failed integrity check disposes the
owned staging directory and leaves the previous destination intact.

## Keep dependencies pointed toward the core

| Layer | Main paths | Responsibility |
|---|---|---|
| Entry | `src/cli/entrypoint.ts`, `src/cli/run.ts`, `main.ts` | Read CLI input or Electron events and publish one result |
| Adapters | `src/cli/operations/`, `src/electron/` | Convert entry-surface requests into shared operation and GUI worker calls |
| Contracts and policy | `src/core/` | JSON Schema, errors, validation, resource limits, diagnostics, archive policy, provenance, and transactions |
| Engine services | `src/js/rpgmv/`, `src/js/wolf/`, `src/js/tyrano/`, `src/js/gdevelop/` | Parse, extract, map, patch, apply, and verify engine-specific data |
| Container adapters | `src/core/container/` | Inspect, extract, and repack directory, Electron ASAR, and NW.js package layouts |

`src/core` does not import Electron. CLI code can import core policy and engine
services. Electron code is an adapter around the same services and cannot be a
required dependency of the CLI core.

## Validate the request twice

The CLI first validates the requested `schemaVersion`, operation, format, and
options. With `format: "auto"`, it then detects the engine and container and
validates the options again against the resolved format. This prevents an option
accepted by a broad auto request from reaching an incompatible engine.

`OperationRuntime` owns the operation ID, logger, progress sink, filesystem and
clock dependencies, resource policy, temporary-space accounting, and
`AbortSignal`. CLI signals, configured timeouts, and GUI cancellation converge
on that signal. No module-level mutable context is used to carry an active
request.

## Route every operation through one dispatcher

The five operations are registered independently:

- `verify` reads and scores a source or working directory.
- `extract` creates a mapped translation workspace.
- `patch` updates only manifest-addressed extracted text.
- `apply` creates and validates a completed output or separate game copy.
- `recover` rebuilds stale RPG manifests from trusted extraction metadata.

Engine adapters declare which operations they support. Container adapters are
registered separately for loose directories, Electron ASAR, and NW.js packages.
Unsupported engine/container combinations fail before mutation.

## Treat container workspaces as capabilities

ASAR and NW.js extraction writes `.tsukuru-container.json` into the owned
working copy. This provenance records the archive-relative path, source
SHA-256, detected engine root, required entries, packed and unpacked file lists,
and diagnostic counts. It intentionally omits an absolute source path.

Container apply requires an explicit `options.containerSourcePath`. The adapter
re-inspects that source and compares it with provenance before copying the full
wrapper to a new staging directory. Engine apply runs inside the unpacked
staging tree. The adapter then checks protected-file damage, repacks the archive,
re-inspects the result, checks runtime integrity where available, and commits the
complete wrapper copy.

## Keep the renderer behind preload and IPC policy

Every BrowserWindow is created with Node integration disabled, context
isolation enabled, and Chromium sandboxing enabled. Renderers call a typed
preload bridge whose channels are allowlisted. The main process validates the
sender, payload shape, route, local path, and external HTTPS host before a
handler runs. Navigation, popups, and webviews are denied by default.

RPG/Wolf extract and apply, bulk string replacement, and version-port transforms
run in a GUI worker. The worker reports progress through the same structured
progress model used by the CLI and receives cancellation from the owning window.
Window shutdown waits for worker and tracked child-process cleanup instead of
abandoning mutable work. Legacy project conversion and external translation
remain bounded asynchronous main-process compatibility paths; they are outside
the canonical agent CLI and must not gain new formats before receiving a pure
transactional worker API and cancellation coverage. See
[`tsukuru-agent/docs/performance/io-boundaries.md`](../tsukuru-agent/docs/performance/io-boundaries.md).

## Extend the system without bypassing its gates

When adding an engine or wrapper:

1. Add detection evidence and an adapter capability entry.
2. Define source snapshots, protected paths, and manifest mapping semantics.
3. Use `WorkspaceTransaction` or an equivalent owned staging boundary.
4. Add hostile-path, stale-source, mapping-tamper, rollback, and source-hash
   tests before enabling mutation.
5. Update versioned option schemas, compatibility documentation, fixtures, and
   release evidence.

The [compatibility matrix](compatibility.md) distinguishes stable mutation,
experimental mutation, and diagnostic-only detection. The security rationale is
in [SECURITY.md](../SECURITY.md), and contract evolution is described in the
[maintenance policy](maintenance-policy.md).
