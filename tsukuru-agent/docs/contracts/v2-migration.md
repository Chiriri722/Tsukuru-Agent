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
| `apply` | every extracted format | `force`; RPG and RPG-container workflows may use `translationDirectory`; extracted container workspaces may use container source options; supported Windows Electron ASAR workspaces may use launch-probe options |
| `recover` | RPG MV/MZ only | `dryRun`, `conflictPolicy`, `operationTimeoutMs` |

Defaults remain `format: "auto"`, `profile: "standard"`, `options: {}`, and `patches: []`. `launchTimeoutMs` requires `launchProbe: true`. `launchProbe` is implemented only for supported Windows Electron ASAR workspaces; loose directory and NW.js apply reject it before dictionary patching or output creation (`E_NOT_IMPLEMENTED` or the earlier v2 option-contract rejection). Explicit `patches` and `translationDirectory` are mutually exclusive. An RPG container `apply` stages dictionary patching, engine apply, repack, and publication in one transaction. Recovery defaults to `dryRun: false` and `conflictPolicy: "backup-and-replace"`; `fail-if-present` rejects an existing manifest with `E_OUTPUT_CONFLICT`. `operationTimeoutMs` accepts 1–3,600,000 ms and applies to the complete operation.

## Local RPG review preparation

V2 RPG verify accepts optional `options.review`: required `reportPath`, optional
`entryIds` or `offset`/`limit`, and optional `preview` with explicit
`sourceLanguage`/`targetLanguage`, a versioned glossary and `maxTerms`.
Other operations/formats reject it; legacy v1 keeps but does not execute it.
Raw archives must first be extracted. The separate `review:1` artifact contract
and examples live in the canonical registry; ordinary result fields do not change.

Preview is offline and unapproved. It contains selected IDs, glossary selection
and fingerprints alongside the report's original/current entries and source
groups. No credentials/provider endpoint are accepted. Report text is private;
the inline review configuration is omitted wholesale from diagnostic reports.
Targets must be fresh, outside inputs/output and free of links. Stale mappings,
publication errors and cancellation preserve inputs and prior reports.
See [the full contract](../../../specs/004-review-preparation/contracts/review.md).

## ASAR repack compatibility

Optional `runtime.launchProbe.isolation` is additive in both result versions:
`strategy: "electron-bootstrap-v1"`, `verified`, `processTreeTerminated`, and
`cleanup: "removed" | "retained"`. When present, a successful probe requires both
booleans true and cleanup removed. Legacy records without this field remain
readable but provide no profile-isolation proof. Unsupported entries, unknown or
integrity-protected Electron runtimes, missing bootstrap proof and cleanup
failure use `E_LAUNCH_PROBE_FAILED`. See the
[supported profile boundary](../../../specs/005-launch-profile-isolation/contracts/launch-probe.md).

The existing `experimentalMalformedAsarRepack` boolean is accepted by RPG MV/MZ
`apply`, including an automatically detected RPG engine. It remains false by
default and only enables rebuilding the valid entries of an ASAR container into
a separate output. Source/provenance, protected-script and runtime integrity
checks still apply. Earlier v2 RPG option discrimination incorrectly rejected
this documented opt-in before dispatch; no request version or field meaning changed.

## Compact RPG translation packs

V2 RPG MV/MZ `extract` accepts the additive boolean `translationPack:true` with
an explicit `outputPath`. It stages only the data inputs consumed by the selected
profile and, when enabled, `js/plugins.js`. The separate
`rpg-translation-pack:1` contract seals immutable backups/mappings and records
relative source paths and hashes. Existing extraction requests keep their layout;
v1, non-RPG engines and packaged NW archives do not support this mode.

Use `format:"auto"` for a moved pack. Verify and patch work without the original
game. Apply requires `containerSourcePath` plus a separate `outputPath`; it
regenerates the source mapping before applying edits inside existing transactions.
Recover, asset decryption and YAML output are not supported for this mode.
ASAR malformed-entry opt-in and runtime/protected-file checks remain mandatory.
Full-profile parameters/event scripts can include model names and command IDs;
they need manual selection. Plugin implementation JavaScript is not extracted.
See [the pack contract](../../../specs/006-compact-rpg-extraction/contracts/translation-pack.md).

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
