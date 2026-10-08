# Research — 2026-10-02

## Selected inputs

Decision: Read top-level RPG data JSON/YAML/optional external-message CSV and
the plugin registry only when requested. Use existing extraction profiles.

Evidence: Private samples A/B contain 17 data files (919,671 / 1,872,393 bytes)
and plugin registries (32,116 / 69,090 bytes); C contains 18 data files
(526,570 bytes) and a 16,733-byte registry. A/B use ElectronForMZ and Cubism;
C uses MV with video/particle plugins. No model or runtime file is needed by
RpgMakerService. Two read-only research agents independently traced this flow.

Alternative rejected: Full unpack followed by copying a small pack still incurs
the reported disk cost. A generic plugin parser is unnecessary and unreliable.

## Round trip

Decision: Add an explicit pack schema; preserve strict full container provenance.
Authenticate source inputs and immutable artifacts against a freshly generated
small extraction before applying. Reuse existing service, transaction, protected
file, ASAR repack and runtime integrity checks.

Rationale: Existing portable packs already support verify/patch. Full ASAR
provenance requires every archive file and must not silently allow omissions.
Source reconstruction belongs in apply, where producing a full game is intended.
Plugin registry output must be bound to the original and limited to exact mapped
parameters before approving that one protected path. Original registry bytes
must remain available so a no-op does not unnecessarily rewrite the script.

## Plugin coverage

Decision: Keep existing explicit profile semantics and disclose risky extended
fields. Full extracts plugin parameters and event commands/scripts, including
resource identifiers. It does not extract arbitrary plugin implementation bodies.

Rationale: Real Live2D string fields include both identifiers and UI labels.
Neither plugin-name blacklists nor @type=string can separate these reliably.
Existing manifest buckets/qpath identify advanced material for manual review.
Model/motion/texture assets and implementation scripts stay outside the pack.

## Boundaries

No new dependency, plugin execution, integrity bypass or external upload.
Packaged NW archive support is not silently inferred from a loose NW game.
Source games A/B have existing malformed ASAR metadata; their output repack
retains the named experimental opt-in and all other integrity checks.
Hindsight was unavailable (local connection refused); current files are evidence.

## Failures exposed by real inputs

Repeated extraction in one process retained a module-level event counter, so
fresh source authentication disagreed on `.extracteddata` event IDs. Reset that
counter and both comment-state flags in the common extraction initializer;
the synthetic fixture now contains plugin commands and event JavaScript.

The local Node 24.14 Windows runtime terminated with `0xc0000409` inside
`fs.cpSync` when copying Unicode paths. A tiny synthetic Unicode directory and
the moved-pack integration test reproduced it before the fix. Reuse the common
container copy boundary with individual physical file operations; keep link,
overlap, file-type, filter and overwrite checks. CLI copy now delegates to that
boundary. No dependency or runtime version change is needed.
