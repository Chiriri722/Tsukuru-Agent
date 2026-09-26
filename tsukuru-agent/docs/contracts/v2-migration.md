# Contract v2 migration

Tsukuru Agent keeps request, result, extraction-manifest, and container-provenance contracts versioned. JSON Schema 2020-12 files under `src/core/contracts/schemas/` are the canonical machine-readable definitions, and the matching static TypeScript surface is exported from `src/core/contracts/types.ts`.

## Compatibility policy

- A v1 request is normalized with the established defaults and keeps an unknown option so older extensions continue to work.
- A v2 request rejects every unknown option and unknown top-level field before format detection or operation dispatch.
- Readers accept extraction manifests v1 and v2. A v1 manifest may omit `createdAt`; a v2 manifest requires `createdAt` and `sourceSnapshots`.
- Result v1 retains exactly the legacy fields. Result v2 adds `schemaVersion: 2` and `warningDetails`, while the legacy `warnings` string array remains in parallel for user-facing and older consumer compatibility.
- Container provenance currently remains at v1 and is validated before archive-path or file-list semantics.

Do not change the meaning of a published field in place. Add a new schema version, keep a compatibility fixture for the previous version, and document the migration here.

## Request changes

The v2 request is a discriminated union over `operation` and the requested or detected `format`. Unsupported option combinations fail with `E_REQUEST_INVALID` before any engine writes output.

| Operation | Supported format groups | Notable v2 options |
|---|---|---|
| `verify` | every detectable format | `verifyDepth`, `humanSummary`, `operationTimeoutMs` |
| `extract` | RPG MV/MZ, Wolf, Tyrano, GDevelop, NW.js | engine-specific extraction flags, `force`, `operationTimeoutMs` |
| `patch` | every extracted format | RPG may use `translationDirectory`; otherwise explicit `patches` |
| `apply` | every extracted format | `force`; RPG and RPG-container workflows may use `translationDirectory`; extracted Electron ASAR/NW.js container workspaces may use container source and launch-probe options |
| `recover` | RPG MV/MZ only | `dryRun`, `conflictPolicy`, `operationTimeoutMs` |

Defaults remain `format: "auto"`, `profile: "standard"`, `options: {}`, and `patches: []`. `launchTimeoutMs` requires `launchProbe: true`. `launchProbe` is implemented only for extracted Electron ASAR/NW.js container workspaces; loose directory apply rejects it with `E_NOT_IMPLEMENTED` before dictionary patching or output creation. Explicit `patches` and `translationDirectory` are mutually exclusive. An RPG container `apply` stages dictionary patching, engine apply, repack, and publication in one transaction. Recovery defaults to `dryRun: false` and `conflictPolicy: "backup-and-replace"`; `fail-if-present` rejects an existing manifest with `E_OUTPUT_CONFLICT`. `operationTimeoutMs` accepts 1–3,600,000 ms and applies to the complete operation.

## ASAR repack compatibility

The existing `experimentalMalformedAsarRepack` boolean is accepted by RPG MV/MZ
`apply`, including an automatically detected RPG engine. It remains false by
default and only enables rebuilding the valid entries of an ASAR container into
a separate output. Source/provenance, protected-script and runtime integrity
checks still apply. Earlier v2 RPG option discrimination incorrectly rejected
this documented opt-in before dispatch; no request version or field meaning changed.

## Cancellation and warnings

RPG results may add `translationQuality` in either version. Its `mechanical`
status covers source-bound control/placeholder/blank/U+FFFD checks; it is separate
from structural `validation`. `language` and `context` can require review, and
`semantics` remains `not-run`. Diagnostics contain at most 100 relative file/ID
records with total and omitted counts. No game text is returned.
`E_TRANSLATION_LINT` aborts mutation on introduced damage. Empty dictionary
values still mean skip; a newly blank direct/manual translation is rejected.
Unchanged original text, including original defects, can be preserved.

External-message expansion uses the original `ExternMessage.csv`, now also
preserved under Backup during extraction. Older packs may use their original
CSV beside Extract. A pack without either source cannot validate expanded
references: restore its original CSV or preserve the original reference.
Mutable `.extracteddata.originText` and recovered manifest hashes do not prove
the CSV source or semantic alignment.

CLI `SIGINT`/`SIGTERM` and the GUI cancel action abort the active operation through an `AbortSignal`. User cancellation reports `E_OPERATION_CANCELLED`; an expired `operationTimeoutMs` reports `E_OPERATION_TIMEOUT`. Transactional staging prevents either path from publishing a partial final output.

For v2 consumers, read `warningDetails[].code` for automation and retain `warnings[]` for display. A warning without a specialized mapping is represented as `W_LEGACY_MESSAGE`, so migration does not discard existing text.

## Migration checklist

1. Send `schemaVersion: 2` explicitly.
2. Remove any unknown option and choose options valid for the operation/format pair.
3. Continue displaying `warnings`, but branch automation on `warningDetails`.
4. Accept both manifest versions while existing work packs are in circulation.
5. Validate representative request/result/manifest fixtures with the checked-in schemas before release.
