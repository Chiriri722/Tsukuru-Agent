# ADR 0003: Versioned JSON contracts and explicit operation runtime

- Status: Accepted
- Date: 2026-08-23

## Context

Tsukuru Agent is consumed by terminal agents, GUI renderers, and existing v1 automation. Unversioned structural checks and process-wide mutable context made compatibility drift, parallel execution, cancellation, and deterministic testing difficult to reason about.

## Decision

JSON Schema 2020-12 documents checked into `tsukuru-agent/src/core/contracts/schemas/` are the canonical wire-contract definitions. Request, result, and extraction-manifest contracts publish v1 and v2; container provenance publishes v1; engine options publish v2. Static TypeScript types are maintained beside these schemas and exported through a single contract type surface. Contract tests validate schemas, examples, staged build assets, and v1/v2 compatibility to detect drift.

The runtime validator intentionally implements the deterministic JSON Schema subset used by the checked-in documents. This avoids adding a runtime package solely for validation while retaining stable `$id` and `$ref` behavior. Expanding the schemas beyond the supported subset requires extending the validator and its tests in the same change.

v1 remains the compatibility boundary: legacy requests preserve unknown extensions, legacy results retain their original key set, and existing manifests remain readable. v2 is strict: unknown fields or engine options are rejected before dispatch, results add structured warning details, and manifests require source snapshots. Published field meaning is not changed in place; incompatible changes require a new version and migration note.

Each invocation receives an explicit `OperationRuntime` containing its logger, progress sink, filesystem provider, clock, temporary-directory provider, and `AbortSignal`. CLI and GUI entry points create and dispose it. Transactions consult the signal before publishing final output, and timeouts use the same cancellation path.

`AsyncLocalStorage` scopes the existing `ctx()` compatibility adapter across asynchronous engine code. There is no module-level active-context singleton. New or touched orchestration code passes `OperationRuntime` explicitly; the adapter can be removed incrementally after deep engine helpers accept dependencies directly.

## Consequences

- Agents can discover and validate supported payloads without running the GUI.
- Invalid operation/format/option combinations fail before engine mutation.
- Sequential, nested, and parallel operations isolate state and cancellation.
- Human-readable warning strings remain available while automation receives stable warning codes.
- Schema, TypeScript, README, and fixture drift becomes a release-blocking test failure.
- The local schema validator is deliberately narrower than a general-purpose JSON Schema implementation and must evolve together with the schema corpus.
