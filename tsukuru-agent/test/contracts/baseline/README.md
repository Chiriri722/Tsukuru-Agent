# Baseline contract snapshots

These files characterize the public CLI and manifest contracts at commit
`17fa6e7`. They are evidence, not a newly designed schema.

## Capture fixture

The success results were captured from a disposable copy of
`fixtures/rpgmv-basic` after a schema-v2 `extract` with the `standard` profile.
The extracted pack contained 4 source files and 43 manifest entries. Both v1
and v2 `verify` requests exited 0 and produced the same normalized result.

The invalid-path request exited 1 with `E_PATH_NOT_FOUND`.

## Normalization

- Disposable absolute paths are written as `<FIXTURE_ROOT>`.
- A deliberately absent path is written as `<MISSING_PROJECT>`.
- Manifest `createdAt` is written as `<TIMESTAMP>`.
- Elapsed time and generated artifact paths are not part of these verify
  snapshots.
- Object keys and array order are preserved exactly as emitted; no sorting is
  applied.

The request files are normalized snapshots and are not directly executable
until the placeholders are replaced with disposable local paths. Never use a
real game directory to regenerate them.

## Baseline invariants

- stdout contains exactly one JSON result.
- stderr is empty for the three captured verify requests.
- success exits 0; the missing-path failure exits 1.
- schema v1 remains accepted alongside schema v2.
- a successful extracted-pack verify exposes `validation`, `scores`, and
  `change` without mutating the source.
- the current manifest schema version is 1; no manifest v2 is invented here.
