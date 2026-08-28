# ADR 0001: Canonical version and project identity

- Status: Accepted
- Date: 2026-08-19

## Decision

`tsukuru-agent/package.json` is the canonical release-version source. The current release remains `2.5.0`; the `v.2.5.01` baseline commit subject is not a Git tag or a valid SemVer release identifier, so it does not justify a patch bump.

`npm run sync:version` derives the legacy `version.json` and release-note heading from the package version. `npm run check:version` rejects drift across those files, the CLI archive template, GUI branding, and project URLs. Electron obtains the GUI version from the packaged `package.json` through `app.getVersion()`.

The maintained project identity is `tsukuru-agent` / `Tsukuru Agent`, with source, releases, and support hosted at `Chiriri722/Tsukuru-Agent`. Original Tsukuru Extractor authorship remains credited in `NOTICE.md`, `README.md`, and package contributors.

## Compatibility constraints

The GUI application id remains `net.electron.MVExtractor` so existing Electron Store data and installed-user state keep their legacy location. The new `tsukuru-agent` protocol is added while the `MVExtractor` scheme remains as a compatibility alias.

The independent lockfile change must be regenerated or reconciled after integration because changing the root package name from `mv-extractor-pp` to `tsukuru-agent` changes lockfile root metadata. The independent build-chain change must retain the version-derived CLI `artifactName` when its builder configuration is merged.

## Release consequence

This hardening work aligns metadata for the already documented v2.5.0 release; it does not change public CLI schemas or runtime behavior and therefore does not create a new release number. A later release bump must be made in `package.json`, followed by `npm run sync:version` and `npm run check:version`.
