# Changelog

Tsukuru Agent records user-visible changes in this file. Release headings are
synchronized from `tsukuru-agent/package.json` with `npm run sync:version`.

<!-- current-version:start -->
## [2.5.0] - Unreleased
<!-- current-version:end -->

### Added

- Opt-in v2 RPG translation packs for loose MV/MZ and Electron ASAR: select text
  inputs without expanding runtime/media/Live2D assets, retain engine identity,
  and reconnect a matching source for transactional game-copy apply. Plugin
  registry approval is limited to source-bound mapped parameters; implementation
  scripts remain protected. Repeated extraction resets event numbering; shared
  container copies avoid native termination on Unicode paths in the local
  Windows Node 24.14 runtime.
- Profile-isolated optional Electron launch probes on Windows 10+: disposable
  app/session/environment paths, native job ownership and confirmed cleanup.
  Unsupported entries, protected/unknown runtimes and NW.js launch probes fail
  before game execution. Source and published entry scripts remain unchanged.
- Opt-in local RPG review artifacts for v2 verify: original message context,
  explicit speaker evidence, source/current fingerprints and bounded offline
  glossary request previews. No provider calls or alternative patch path.
- Source-bound RPG translation diagnostics for control codes, placeholders,
  new blank text and replacement characters, with separate language/context
  review and an explicit unverified semantic status. Read-only `verify` keeps
  structural findings separate from translation integrity.
- Bounded, deterministic reporting of every stale dictionary hash conflict.

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

### Fixed

- Use physical filesystem semantics for external game ASARs under Electron so
  packaged detection, hashing, copying and cleanup agree with Node execution.
- Treat names beginning with two dots as ordinary children when preventing
  report writes inside a project; preserve legitimate sibling report destinations.
- Accept the documented malformed-ASAR repack opt-in after RPG MV/MZ detection,
  while retaining default refusal, separate-copy output and integrity checks.

### Security

- Publish loose RPG dictionary changes and final output as one rollback group.
  Validate emitted JSON, YAML, plugin and external-message values before any
  CLI/GUI publication, including legacy instant apply. Protect edited media
  folders from output replacement and preserve concurrent workspace changes.
- Ignore AppleDouble RPG parser candidates while retaining source files. Omit
  game-text excerpts from fatal Backup parse errors and identify verified
  relative entry locations when available.

- Reject missing or invalid coordinates and overlapping mappings for every
  entry in a patched file, including unchanged neighbors. Reject alternative
  path spellings for the same target before mutation. Legacy v1 diagnostic
  reads remain compatible; rejected patches preserve all workspace bytes.
- Hardened BrowserWindow, preload, IPC, navigation, URL, local-path, child
  process, archive, and external-binary boundaries.
- Reject manifest workspace paths that traverse symbolic links or junctions,
  and reject Windows-alias collisions in deterministic release ZIPs.
- Completed the documented Electron and electron-builder major-upgrade ladders
  through current Electron 43.4.1 and electron-builder 26.15.7 with clean audits.

See [the v2.5 release notes](v2.5-release-notes.md) for compatibility details
and known limitations.
