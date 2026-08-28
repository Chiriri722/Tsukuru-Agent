# Maintain versions, contracts, and experimental features

Use `tsukuru-agent/package.json` as the canonical product version. Run
`npm run sync:version` after changing it, and run `npm run check:version` before
review. These commands keep `version.json`, the current release-note title, and
the current `CHANGELOG.md` heading aligned with the package and version-derived
artifact name.

## Evolve JSON contracts by schemaVersion

Tsukuru Agent currently reads request/result/manifest schema versions 1 and 2
and container provenance version 1. Version 2 rejects unknown options and
validates options against both the requested operation/format and the detected
format.

Use an additive change when an optional field has one unambiguous meaning and
old consumers can ignore it. Introduce a new schema version when changing a
required field, field meaning, accepted type, operation behavior, or failure
contract. Keep runtime validation, checked-in JSON Schema, static TypeScript
types, examples, snapshots, and documentation in one review unit.

The [v2 migration guide](../tsukuru-agent/docs/contracts/v2-migration.md)
explains current request and result differences. A future migration guide must
include before/after requests, defaults, rejected combinations, warning/error
changes, and the last version that accepts the old contract.

## Apply deprecation in visible stages

1. Document the replacement and emit a structured warning when practical.
2. Keep the old behavior for at least one documented minor release unless it is
   an unsafe bypass.
3. Add a migration test and a removal version to the changelog.
4. Remove behavior only in the announced version and keep old-schema handling
   when the support table still promises it.

Security fixes may disable an unsafe mutation path immediately. In that case,
retain diagnostic reporting when it can be done safely and document the reason
in `SECURITY.md` and the changelog.

## Keep experimental options narrow and reversible

Experimental behavior must have:

- a named schema v2 option with a default of `false`;
- a useful diagnostic mode without the option;
- a documented mutable subset and unsupported cases;
- deterministic synthetic fixtures and false-positive tests;
- source hash, protected-file, and no-partial-output assertions;
- a separate-copy transaction and a manual gameplay status.

Experimental does not mean unvalidated. It means the compatibility surface or
real-world evidence is not broad enough for Stable status. Renaming or removing
an experimental option still requires release notes, but its internal manifest
shape is not guaranteed across versions unless separately documented.

Promote an option to Stable only after representative real samples pass
structural validation, wrapper preservation, launch observation, and manual
gameplay, with private paths removed from the published result.

## Review support after every engine or dependency change

Update the [compatibility matrix](compatibility.md) when detection, extraction,
mapping, application, or wrapper support changes. Keep Diagnostic distinct from
Experimental: diagnostic support never grants mutation authority.

Dependency upgrades follow the supply-chain inventory and audit policy. Electron
and electron-builder move one major at a time, with GUI sandbox/preload/IPC,
CLI stdio, package contents, ASAR/NW.js, Authenticode, and process cleanup
revalidated at each step.

## Record releases without rewriting history

`CHANGELOG.md` summarizes user-visible changes. The current version heading is
generated from the package version, while published release sections become
historical records. The detailed current release notes describe compatibility,
safety behavior, known limitations, and evidence. Do not claim a manual test in
either document unless it was actually performed and recorded.

Historical implementation plans are preserved for rationale, not treated as
the current support contract. README, JSON Schema, this policy, `SECURITY.md`,
and the compatibility matrix describe current behavior.
