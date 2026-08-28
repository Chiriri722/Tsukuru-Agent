# Security policy

Tsukuru Agent processes untrusted game directories, archives, scripts, and
binary data. Treat every input as hostile, keep an untouched source copy, and
run `verify` before authorizing extraction or apply.

## Report vulnerabilities privately

Do not post exploit details, private game files, absolute local paths, or
secrets in a public issue. Use the repository's private GitHub Security Advisory
form under **Security → Advisories → Report a vulnerability** when it is
available. If private reporting is unavailable, open a minimal issue asking the
maintainers for a private contact channel without including reproduction data.

Include the affected version and commit, operating system, input/container type,
expected boundary, observed result, and a minimal synthetic reproduction. Do
not attach copyrighted game assets. Maintainers should acknowledge the report,
agree on a private reproduction channel, assess affected versions, and
coordinate a fix and disclosure before publishing details.

## Know which versions receive fixes

| Version line | Status |
|---|---|
| `2.5.x` source and CLI contract | Supported |
| Earlier versions | Unsupported; reproduce on the current supported source before reporting |
| Experimental compatibility flags | Best-effort while the flag remains documented and tested |

The checked-in `tsukuru-agent/package.json` is the canonical version source.
Security support does not override the public binary release blocker below.

## Preserve the archive and filesystem boundary

Archive handlers reject traversal, absolute and drive-prefixed paths, NULs,
unsafe symbolic link entries, duplicate or case-colliding destinations, and
configured file/byte/temp-space limits. Directory-form packages reject symbolic
links and junctions instead of following them. ASAR metadata bounds and unpacked
entries are inspected before staging. Manifest-derived Extract, Backup, and
`.extracteddata` paths are contained under their declared workspace and reject
every existing symbolic-link or junction segment before reading or writing.

Container workspaces store relative provenance and source SHA-256 values, not a
remembered absolute source path. Apply requires the source path again, checks it
against provenance, builds a separate full wrapper copy, validates the staged
archive, and only then publishes the final directory. In-place container apply
and output paths inside the source are not supported.

Malformed ASAR metadata is diagnostic by default. Rebuilding only valid entries
requires `experimentalMalformedAsarRepack` and always writes a separate copy.
Signed or certificate-table PE-appended ZIP files, inconsistent offsets, ZIP64,
and ambiguous executable candidates remain diagnostic-only.

## Do not execute content during static extraction

GDevelop `data.js` parsing extracts the strict JSON assigned to
`gdjs.projectData`; it does not evaluate the script. The experimental
`code*.js` profile parses an Acorn AST and accepts only its documented generated
setter subset. Ambiguous literals are reported, not executed or applied.

Tyrano source parsing excludes script blocks and protected plugin/system paths.
External helper binaries are resolved through an inventory with pinned SHA-256
policy. Child processes and launch probes are bounded, receive no translation
credentials, run against a disposable output copy, and are terminated with
their observed process tree.

## Keep the GUI and network surfaces narrow

Electron renderers run with Node integration disabled, context isolation
enabled, and sandboxing enabled. A typed preload allowlist is the only renderer
bridge. IPC sender, channel, payload, route, local path, and external URL checks
run in the main process. Navigation, popups, and webviews are denied by default.

Update and translation network requests use bounded clients with explicit
timeouts, response-size limits, and redirect/host policy. Diagnostics redact
absolute paths unless a person explicitly chooses a report destination. Never
put credentials or private corpus paths into fixtures, snapshots, or release
evidence.

## Treat experimental flags as narrower permissions

An experimental flag authorizes only the subset named by that flag. It does not
disable provenance, source snapshots, protected-script checks, resource limits,
or rollback. Do not add undocumented bypasses such as arbitrary ASAR unpackers,
signature stripping, link following, JavaScript evaluation, or direct source
overwrite.

## Public binary release requires the final checklist

The current source resolves Electron 43.4.1 and electron-builder 26.15.7. The
production and full dependency audits are clean, and the one-major-at-a-time
Electron/electron-builder ladder has passed GUI, CLI, and packaged validation.
The dependency ladder is no longer a release blocker. Do not publish a public
binary as security-cleared until the remaining reproducibility, packaged-GUI,
evidence, signing, and manual-playtest items in the
[release checklist](docs/release-checklist.md) are complete. The completed
[Electron upgrade ladder](tsukuru-agent/docs/supply-chain/electron-upgrade-status.md)
is retained as release evidence.

See the [architecture](docs/architecture.md),
[compatibility matrix](docs/compatibility.md), and
[supply-chain policy](tsukuru-agent/docs/supply-chain/audit-policy.md) for the
executable controls behind this policy.
