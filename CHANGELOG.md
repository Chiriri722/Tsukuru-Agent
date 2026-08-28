# Changelog

Tsukuru Agent records user-visible changes in this file. Release headings are
synchronized from `tsukuru-agent/package.json` with `npm run sync:version`.

<!-- current-version:start -->
## [2.5.0] - Unreleased
<!-- current-version:end -->

### Added

- Headless JSON CLI operations: `verify`, `extract`, `patch`, `apply`, and
  `recover`.
- Structural validation scores and human-readable terminal summaries for RPG
  Maker, Wolf RPG, TyranoScript, GDevelop, Electron ASAR, and NW.js containers.
- Transactional ASAR and `package.nw` workflows with provenance, source hashes,
  protected-file checks, and separate-copy publication.
- Conservative GDevelop JSON Pointer extraction and an experimental static
  `code*.js` AST profile.
- Versioned JSON contracts, reproducible builds, CI, supply-chain inventories,
  release evidence, resource limits, diagnostics, and compatibility corpus
  tooling.
- Baseline-aware RPG reference validation that distinguishes pre-existing
  broken references from current-workspace damage.
- Transactional RPG translation-directory apply for container workspaces and
  recovery dry-run/conflict policies.
- Deterministic CLI ZIP ordering/timestamps/extra metadata and deterministic
  NW.js ZIP ordering, permissions, and timestamps.

### Changed

- Refactored Tsukuru Extractor's GUI-bound engine logic into shared services for
  CLI and sandboxed Electron GUI adapters.
- Made source preservation, rollback, and machine-readable errors the default
  behavior for automated workflows.

### Security

- Hardened BrowserWindow, preload, IPC, navigation, URL, local-path, child
  process, archive, and external-binary boundaries.
- Reject manifest workspace paths that traverse symbolic links or junctions,
  and reject Windows-alias collisions in deterministic release ZIPs.
- Completed the documented Electron and electron-builder major-upgrade ladders
  through current Electron 43.4.1 and electron-builder 26.15.7 with clean audits.

See [the v2.5 release notes](v2.5-release-notes.md) for compatibility details
and known limitations.
