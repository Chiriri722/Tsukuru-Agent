# Experimental directory-form `package.nw`

Tsukuru Agent always diagnoses an NW.js `package.nw` directory, but it does
not extract or apply one by default. Enable the path explicitly with
`options.experimentalNwDirectory: true` on both the `extract` request and the
container `apply` request. The flag is accepted only by the v2 operation/format
schemas that can reach a container boundary.

The adapter treats the directory as an immutable archive-like source. It walks
entries without following links, sorts names deterministically, rejects unsafe
or case-folding-colliding paths, enforces the common file/byte limits, and
computes a digest from normalized relative paths, file sizes, and per-file
SHA-256 values. Provenance stores that digest and the original file list, not an
absolute source path.

Apply requires `options.containerSourcePath`, re-inspects the source directory,
and refuses a changed digest or file list. The whole wrapper is copied into an
owned transaction staging directory; only the staged `package.nw` directory is
replaced. Publication is atomic and always targets a path outside the source
wrapper. A failed validation, copy, cancellation, or pack leaves neither a
partial final output nor an owned staging directory.

The following conditions remain unsupported:

- symbolic links, junctions, reparse-point-like linked entries, and unsafe
  relative paths;
- names that collide after Windows-compatible case folding;
- output inside the original wrapper or direct in-place mutation;
- automatic enablement based only on detection confidence;
- treating a structural or launch probe as proof of successful gameplay.

Synthetic extract/patch/apply round-trip and legacy ZIP `package.nw` regression
tests pass. No approved real directory-form sample was present in the current
private corpus, so launch and gameplay validation remain an explicit exit gate
before this feature can leave experimental status.
