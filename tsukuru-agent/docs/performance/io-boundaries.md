# I/O and worker boundary review

This review separates event-loop isolation from memory-bounding. A stream is not automatically safer when the parser or archive library requires a complete buffer, and changing those APIs inside a transaction can alter validation or commit order.

| Workload | Current boundary | Decision |
|---|---|---|
| RPG/Wolf extract and apply | GUI worker with shared-memory cancellation checkpoints | Keep in the worker. Engine parsers require complete JSON or binary-map buffers. |
| Bulk string replacement and version port | GUI worker plus atomic staging/commit | Keep bounded buffer text decoding (64 MiB per file, 512 MiB per workspace). Cancellation is checked during scan, transform, and before commit. |
| ASAR/NW.js inspect, extract, and pack | CLI process or GUI worker; archive adapter enforces entry and expanded-size limits | Keep adapter-owned buffers where the ASAR/ZIP API requires them. ASAR packing already supplies `createReadStream`; do not bypass archive preflight to add streaming. |
| File SHA-256 | One MiB reusable chunk buffer in `sha256File` | Keep the bounded synchronous reader inside the isolated operation process/worker. It has stream-equivalent memory bounds without event-emitter failure ordering. |
| Directory copy | `fs.cpSync` inside a transaction and outside the renderer/main event loop | Keep until a measured fixture exceeds the benchmark ceiling. A future async copy must preserve no-links policy, metadata, cancellation, and atomic publication. |
| Manifest, schema, JSON, Tyrano, GDevelop, and Wolf parsing | Bounded buffer after resource preflight | Keep: each consumer needs a complete parse unit and already has per-file/workspace limits. |
| HTTP downloads | Chunked response with a maximum byte limit | Keep; the network client aborts oversized and timed-out responses before publication. |
| Project conversion | Async file copy/decrypt path in the Electron main process; small metadata rewrites remain synchronous | Retain temporarily because directory selection and legacy conversion UI are coupled. It yields for every copied/decrypted file. Split UI selection from a pure transactional worker before adding new conversion formats. |
| Translation service | Async network/loopback child-process path with bounded process lifetime | Retain temporarily. External children use the tracked registry; text-file loops still need a later pure service extraction before they can move to the GUI worker. |

The default rule is therefore: isolate CPU or synchronous filesystem work from the GUI main thread first, then adopt streams only where an end-to-end consumer can remain incremental. Every stream conversion must retain file-count, per-file, total-byte, archive-entry, path, provenance, transaction, and cancellation checks.

Residual project-conversion and translation-service work is not part of the agent CLI pipeline. It must not be expanded until it has a pure operation API, rollback fixture, and worker cancellation test.
