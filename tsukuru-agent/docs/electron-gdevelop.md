# Electron GDevelop container workflow

Electron-wrapped GDevelop exports use the same static `gdjs.projectData` JSON
Pointer contract as loose and NW.js GDevelop projects. Tsukuru Agent never
executes `data.js` or generated event code during extract, patch, verify, or
apply.

Extract expands a valid `app.asar` into an owned working directory, records
container provenance, and creates `_Extract/gdevelop-text.txt` plus its
manifest under the detected engine root. Apply requires the original game root
again through `options.containerSourcePath`; archive SHA-256, relative path,
engine type/root, packed file list, and unpacked file list must still match.

Before repacking, the GDevelop service revalidates the source snapshot and every
JSON Pointer. The container layer separately compares protected `gdjs/`,
`libs/gdjs/`, `Extensions/`, and generated `code*.js` bytes against the original
ASAR. The output is a transaction-owned copy of the whole Electron wrapper.
`app.asar.unpacked` metadata and files, plus unrelated external files under
`resources`, are preserved and checked in the output archive.

Malformed ASAR metadata is a separate experimental boundary. Valid entries may
be selectively extracted for diagnosis and translation, but repacking would
omit entries whose size or offset lies outside the archive. Apply therefore
fails by default. `options.experimentalMalformedAsarRepack: true` allows a
cleaned ASAR only in a separate output copy, with an explicit warning and all
normal source/provenance/runtime checks. This flag does not authorize bypassing
links, archive paths, Electron integrity fuses, signatures, or protected files.

The approved real-world sample inspected on 2026-08-23 is ElectronForMZ with an
RPG Maker MZ project root, not GDevelop. It contains 18 out-of-bounds/decoy ASAR
metadata entries and is therefore covered by the default repack block. No
content or private path is stored in the repository.

Structural validation, Electron fuse and signature diagnostics, and an optional
launch probe are reported separately. A launch probe only observes startup in a
temporary copy; gameplay validation remains manual.
