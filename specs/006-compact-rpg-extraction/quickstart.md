# Validation guide

From `tsukuru-agent`, compile and run
`node --test test/integration/rpg-translation-pack.test.js`.

Create a v2 extract request using `format:auto`, an original game `projectPath`,
a separate `outputPath`, the desired `profile`, `options:{translationPack:true}`
and `patches:[]`. Run the normal CLI request entry. Expect only Backup, Extract,
.extracteddata and .tsukuru-rpg-pack.json at the output root.

Deep-verify that output, patch one manifest ID with its expectedHash, then apply
using `options.containerSourcePath` pointing at the unchanged original and a new
outputPath. Expect the edit in the game copy, unchanged resources, and no source
or pack mutation. Retain any existing malformed-ASAR repack opt-in where required.

Private corpus execution stays opt-in/local. Record source hashes, pack bytes,
entry counts, full no-op and title-edit diffs for A/B/C in verification.md.
Run verify, test:order, benchmark:check and applicable packaged Electron checks.
