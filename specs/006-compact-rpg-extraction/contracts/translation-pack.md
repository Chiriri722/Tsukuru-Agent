# Translation-pack contract

v2 RPG extract accepts `options.translationPack: true` and requires a separate
`outputPath`. Omission preserves the old layout. Non-RPG operations/formats and
asset decryption cannot accept this mode. Effective extraction profile stays
independent of output layout. Initially supported sources are loose MV/MZ and
Electron ASAR; other wrappers return a structured unsupported error.

The new schema-1 `.tsukuru-rpg-pack.json` identifies the source without its absolute
path. Root artifacts are Backup, Extract, .extracteddata and this metadata file.
Patch/deep verify/review continue using existing contracts; original MV/MZ engine
identity is preserved. Apply requires `containerSourcePath` and a separate output,
and validates immutable artifacts against the matching source before publication.
Recovery of immutable mapping is by re-extraction; legacy pack recovery is unchanged.

Full/advanced profiles can include identifiers and script operands. They are
manual-review material, not a guarantee that every extracted string is dialogue.
Plugin implementation bodies and assets are not extracted or executed.
