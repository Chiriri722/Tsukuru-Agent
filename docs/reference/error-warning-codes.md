# Error and warning code reference

The CLI writes one final JSON result to stdout. A failed operation uses exit code
1 and returns `ok: false` with `error.code`, `error.message`, and optional
`error.details`. Logs and an optional human summary go to stderr. Code is the
stable machine branch; message text can become clearer without changing the
code.

## Handle request and path errors before retrying

| Code | Meaning | Typical response |
|---|---|---|
| `E_REQUEST_INVALID` | JSON, schema version, operation/format, option, patch, or CLI argument is invalid | Fix the request against the versioned schema |
| `E_PATH_NOT_FOUND` | A required source, workspace, manifest artifact, or output parent is missing | Check the supplied path and workflow stage |
| `E_FORMAT_UNKNOWN` | No supported engine/container profile was detected | Run read-only diagnostics or add a supported adapter |
| `E_FORMAT_MISMATCH` | The requested format or supplied source conflicts with detected/provenance format | Use `auto` or the matching source and format |
| `E_OUTPUT_CONFLICT` | The final output already exists or overlaps a forbidden location | Choose another path or use intentional `force` where supported |
| `E_EXTRACT_EXISTS` | Extraction artifacts already exist | Preserve them, choose another copy, or use intentional extract `force` |
| `E_LOCAL_PATH_INVALID` | An IPC/local path is outside the approved root, wrong type, linked, or otherwise unsafe | Select a real local path inside the permitted boundary |
| `E_EXTERNAL_URL_INVALID` | An external URL is not an approved HTTPS destination | Use an allowlisted project route |

## Treat manifest and patch errors as stale-workspace signals

| Code | Meaning | Typical response |
|---|---|---|
| `E_MANIFEST_MISSING` | The expected extraction manifest does not exist | Run `extract` or point at the correct workspace |
| `E_MANIFEST_CORRUPT` | Manifest JSON, schema, IDs, paths, or metadata are invalid | Restore the generated manifest or re-extract |
| `E_PATCH_EMPTY` | Patch was requested without usable entries | Supply at least one manifest patch or a supported translation directory |
| `E_PATCH_NOT_FOUND` | A patch ID is not present in the manifest | Refresh IDs from the current manifest |
| `E_PATCH_DUPLICATE_ID` | The request contains the same patch ID more than once | Deduplicate the request before retrying |
| `E_PATCH_HASH_MISMATCH` | `expectedHash` no longer matches extracted text | Re-read the workspace and resolve the stale translation |
| `E_MAPPING_CORRUPT` | Line, byte, JSON Pointer, token span, or AST mapping cannot be trusted | Restore generated mapping files or re-extract; do not edit offsets manually |
| `E_WOLF_BYTES_MISMATCH` | Wolf source bytes no longer match the extraction mapping | Use the original matching Wolf data or re-extract |
| `E_SOURCE_CHANGED` | A snapshotted source file/archive changed after extraction or during apply | Stop and create a fresh workspace from the current source |

## Do not bypass validation and runtime errors

| Code | Meaning | Typical response |
|---|---|---|
| `E_VERIFY_FAILED` | Structural, mapping, protected-file, or output verification failed | Inspect `validation.issues` and correct the workspace |
| `E_CONTAINER_PROVENANCE_INVALID` | `.tsukuru-container.json` is missing, malformed, or inconsistent | Re-extract from the original container |
| `E_RUNTIME_INTEGRITY` | Electron fuse, embedded ASAR hash, or runtime integrity policy blocks publication | Rebuild with the legitimate runtime; do not patch around it |
| `E_LAUNCH_PROBE_FAILED` | An explicitly requested launch observation failed or exited with error | Inspect runtime details, then test a disposable copy manually |
| `E_ENCODING_UNREPRESENTABLE` | Translated text cannot be encoded in the source encoding without loss | Use representable text or a separately validated encoding migration |
| `E_EXPERIMENTAL_FEATURE_DISABLED` | A detected layout is mutable only with its explicit v2 option | Review the feature document, then opt in on every required operation |
| `E_EXPERIMENTAL_FEATURE_UNSAFE` | The sample is outside the experimental mutable subset | Keep it diagnostic-only; do not force or bypass the refusal |
| `E_NOT_IMPLEMENTED` | The engine/container/operation combination has no safe implementation | Use a documented supported workflow |

## Retry cancellation and resource errors only after changing conditions

| Code | Meaning | Typical response |
|---|---|---|
| `E_OPERATION_CANCELLED` | CLI signal, GUI cancellation, or caller abort stopped the operation | Confirm rollback, then start a new operation if desired |
| `E_OPERATION_TIMEOUT` | The configured operation deadline expired | Inspect workload/resources before choosing a larger bounded timeout |
| `E_RESOURCE_LIMIT_EXCEEDED` | File count, input size, file size, or temp estimate exceeds policy | Raise a reviewed request limit or reduce the input |
| `E_RESOURCE_PREFLIGHT_UNAVAILABLE` | Required filesystem/resource measurement could not be completed | Fix permissions or choose a measurable local filesystem |
| `E_TEMP_SPACE_INSUFFICIENT` | Temporary storage cannot safely hold the staging estimate | Free space or move temp storage before retrying |
| `E_EXTERNAL_BINARY_INTEGRITY` | An external helper is absent or fails its pinned SHA-256 policy | Restore the inventoried binary; never run the unverified file |

## Treat IPC and internal errors as application defects or hostile calls

| Code | Meaning | Typical response |
|---|---|---|
| `E_IPC_PAYLOAD_INVALID` | A renderer payload fails channel schema validation | Fix the caller; do not broaden the handler implicitly |
| `E_IPC_CHANNEL_UNKNOWN` | A renderer requested a channel outside the preload allowlist | Add a reviewed typed route or reject the call |
| `E_IPC_SENDER_INVALID` | The sender frame or window does not own the requested IPC action | Reject and inspect the caller/navigation state |
| `E_IPC_ROUTE_INVALID` | A requested main-process route is not allowlisted | Use a registered route |
| `E_IPC_INTERNAL` | An IPC handler failed after public-error normalization | Check main-process diagnostics without exposing private paths |
| `E_INTERNAL` | An unknown failure was normalized into the public result contract | Preserve diagnostics and report a minimal synthetic reproduction |

## Read warningDetails without treating warnings as success proof

Schema v2 keeps the legacy `warnings` string array and adds structured
`warningDetails`. Warnings can accompany `ok: true`; they mean the caller must
review degraded evidence or skipped work.

| Code | Meaning |
|---|---|
| `W_LEGACY_MESSAGE` | A legacy warning string has no more specific structured category |
| `W_STRUCTURAL_VALIDATION` | Structural validation found a non-fatal issue or conservative score reduction |
| `W_TRANSLATION_ENTRY_SKIPPED` | A dictionary or patch candidate was skipped because it was empty, unchanged, unknown, stale, or comment-only |
| `W_EXTRACTION_INCOMPLETE` | Extraction completed with a documented omission or unsupported subset |
| `W_CONTAINER_DIAGNOSTIC` | Container metadata, wrapper layout, or experimental condition needs review |
| `W_RUNTIME_DIAGNOSTIC` | Runtime fuse, signature, executable, or launch evidence is incomplete or cautionary |

The canonical code definitions live in
`tsukuru-agent/src/core/types.ts`. Contract tests reject unknown literals and
ensure this reference contains every registered error and warning code.
