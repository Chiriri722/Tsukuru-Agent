# Compatibility and support levels

Start with `verify`. It is read-only and reports the detected engine, wrapper,
container diagnostics, structural issues, and confidence before you authorize
an extraction or apply workflow.

## Read support levels conservatively

| Level | Meaning |
|---|---|
| Stable | Automated mutation has deterministic fixtures, rollback tests, and source-invariance checks |
| Experimental | Mutation is default-disabled and requires a named v2 option on every relevant operation |
| Diagnostic | Detection and reporting are supported; automatic mutation is blocked |
| Unsupported | No safe parser or transaction contract exists for this combination |

Structural validation, a launch probe, and manual gameplay are separate forms
of evidence. A structurally valid package can still fail in an engine-specific
scene that the automated checks did not run.

## Match engines to operations

| Engine and layout | `verify` | `extract` | `patch` | `apply` | `recover` | Level and notes |
|---|---:|---:|---:|---:|---:|---|
| RPG Maker MV, loose `data/*.json` | Yes | Yes | Yes | Yes | Yes | Stable; output uses `Completed` |
| RPG Maker MZ, loose `data/*.json` | Yes | Yes | Yes | Yes | Yes | Stable; output uses `Completed` |
| Portable RPG work pack (`Backup` + `Extract` + `.extracteddata`) | Yes | Existing workspace | Yes | Yes | Yes | Stable; source JSON can live only in `Backup` |
| Wolf RPG, loose `.mps`/`Data.wolf` | Yes | Yes | Yes | Yes | No | Stable copy-only apply; binary offset, length, NUL, encoding, and source bytes are checked |
| TyranoScript, loose `data/scenario/*.ks` | Yes | Yes | Yes | Yes | No | Stable copy-only apply; UTF-8 and Shift_JIS source encodings are preserved |
| GDevelop, loose export | Yes | Yes | Yes | Yes | No | Stable for strict `gdjs.projectData` static Text/BBText fields |
| Unknown loose NW.js web app | Yes | No | No | No | No | Diagnostic until a supported nested engine is found |

`patch` always addresses an existing manifest. It does not parse a raw game or
archive directly. RPG `translationDirectory` input is also accepted by an RPG
container `apply`; dictionary patching, engine apply, repack, and publication
then share one transaction. `recover` is limited to RPG extraction packs with
trustworthy `.extracteddata` and current extracted text. Recovery supports a
write-free `dryRun` and either `backup-and-replace` or `fail-if-present`
conflict handling.

When `Backup` is available, RPG reference validation compares the current data
with that baseline. Identical pre-existing broken references are non-blocking
`*_BASELINE` issues; damage present only in the current data remains blocking.

## Match wrappers and containers to mutation support

Electron ASAR and NW.js wrappers have separate support contracts from their
nested engines.

| Wrapper/container | Nested engine | Support | Safety boundary |
|---|---|---|---|
| Electron `resources/app.asar` | RPG Maker MV/MZ | Stable | Sibling working copy, provenance, optional translation dictionary in the repack transaction, packed/unpacked entry preservation, protected runtime, separate full-game output |
| ElectronForMZ `app.asar` | RPG Maker MZ | Stable in the valid-entry subset | Wrapper/features are reported; malformed metadata cleanup needs a separate experimental opt-in |
| Electron `app.asar` | GDevelop | Stable for the standard JSON profile | Preserves `app.asar.unpacked` and unrelated `resources`; protects generated runtime |
| Electron `app.asar` | Wolf RPG or TyranoScript | Diagnostic | Nested engine can be reported, but ASAR extract/apply mutation is not enabled |
| ZIP `package.nw` | GDevelop | Stable | ZIP path/link/duplicate/size policy, deterministic entry order/timestamps, provenance, wrapper copy, and source SHA-256 recheck |
| Directory-form `package.nw` | GDevelop | Experimental | Requires `experimentalNwDirectory` on extract and apply; links, junctions, case collisions, and in-place output are blocked |
| PE executable with appended ZIP | GDevelop/NW.js | Experimental subset | Requires `experimentalNwAppendedZip`; one unsigned PE32/PE32+ classic-ZIP candidate only, with exact executable-prefix preservation |
| Signed, certificate-table, ZIP64, split, malformed-offset, or multi-candidate appended package | Any | Diagnostic | Automatic repack is blocked |
| Encrypted, obfuscated, or proprietary container without a bounded parser | Any | Unsupported | No bypass or heuristic unpack command is attempted |

The approved real hybrid sample inspected during v2.5 work is ElectronForMZ
wrapping RPG Maker MZ. It also contains third-party plugins, Live2D, and
Effekseer features. Detection and valid-entry extraction were verified
read-only. Its malformed ASAR metadata is not treated as permission to bypass
or preserve impossible entries.

## Enable experimental behavior explicitly

| Option | Operations | Mutable subset |
|---|---|---|
| `experimentalNwDirectory` | `extract`, container `apply` | Directory-form `package.nw` with a deterministic source digest |
| `experimentalNwAppendedZip` | `extract`, container `apply` | One unsigned, internally consistent PE-appended classic ZIP |
| `experimentalMalformedAsarRepack` | RPG/GDevelop container `apply` | Separate-copy ASAR rebuilt from valid metadata entries only |
| `experimentalGdevelopCodeStrings` | GDevelop `extract`, `apply` | Direct static literals in generated indexed-object `setString`/`setBBText` calls |

Experimental options are schema v2 options. They are never inferred from a
profile and do not weaken unrelated path, snapshot, provenance, protected-file,
or transaction checks.

## Understand known gaps

- The launch probe copies game files but inherits the user's Electron profile
  environment. AppData save/profile isolation must be verified before launching
  those games. The second real ElectronForMZ sample passed static round-trip
  checks with no launch; see the [D22 report](reviews/2026-09-23-electron-corpus.md).
- GDevelop custom extensions, hand-written event code, variables, templates,
  concatenations, identifiers, and resource paths are not automatically
  translated.
- Tyrano plugins and script blocks outside the approved scenario-text spans are
  protected.
- Wolf binary mappings outside the supported parser records are reported or
  skipped instead of guessed.
- Directory-form and appended-ZIP support has synthetic round-trip coverage,
  but a successful launch or gameplay result is not inferred from it.
- Electron runtime integrity diagnostics do not prove publisher trust. The
  Electron/electron-builder upgrade ladder is complete through 43.4.1/26.15.7;
  reproducibility, signing, packaged-GUI checks, and manual gameplay remain
  separate release gates.

Detailed experimental boundaries are documented in the
[directory-form package note](../tsukuru-agent/docs/experimental-nw-directory.md),
[appended-ZIP note](../tsukuru-agent/docs/experimental-nw-appended-zip.md),
[Electron GDevelop note](../tsukuru-agent/docs/electron-gdevelop.md), and
[GDevelop code profile](../tsukuru-agent/docs/gdevelop-code-profile.md).
