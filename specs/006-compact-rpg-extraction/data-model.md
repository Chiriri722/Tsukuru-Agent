# Data model

`RpgTranslationPack` schema 1 lives in `.tsukuru-rpg-pack.json` beside
`Backup/`, `Extract/` and `.extracteddata`.

- Engine is RPG MV or MZ; source is directory or Electron ASAR.
- Source records relative engine/data paths, selected input paths/hashes and,
  for ASAR, archive relative path/hash. Absolute user paths are never stored.
- Effective extraction flags reproduce the original mapping without executing code.
- Immutable artifact hashes cover all Backup files and `.extracteddata`.
  Extract text/manifest can be updated through normal patch operations.
- Every relative path rejects traversal, aliases, links and special files.

State flow: source inspection -> selected temporary inputs -> extracted artifacts
-> transactional pack publication -> mutable text editing -> source authentication
-> transactional game-copy apply. Failed transitions do not publish partial output.
