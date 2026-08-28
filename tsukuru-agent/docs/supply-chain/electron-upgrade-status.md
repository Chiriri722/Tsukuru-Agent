# Electron upgrade status

The current package resolves Electron 43.4.1 and electron-builder 26.15.7. The installation audit on 2026-08-24 reports 0 vulnerabilities. The production-only `npm audit --omit=dev` gate remains a separate requirement and does not by itself prove runtime compatibility.

The Electron and electron-builder ladders are now complete through the current stable Electron release. The dependency ladder and audit no longer block a public binary; release readiness still requires the separate reproducibility, packaged-GUI, evidence, signing, and manual-playtest checks in the release checklist.

Each major is handled as a separate review unit. Electron moves one major at a time from 22, and electron-builder moves one major at a time from 22. Every step must run:

- clean `npm ci`, `npm audit`, `npm run verify`, and fixed-seed `npm run test:order`;
- real `npm run test:electron` on Windows;
- `npm run build:cli` and `npm run verify:package` to preserve stdout JSON and exit codes;
- ASAR/NW.js round-trip, Electron fuse/resource integrity, and Authenticode diagnostics;
- GUI launch, preload/IPC, cancellation, and child-process cleanup smoke tests.

Dependabot may open patch/minor updates, but Electron and electron-builder majors remain manual. A major is not accepted when it changes the request/result contract, includes GUI-only modules in CLI core, weakens BrowserWindow defaults, or leaves a high/critical finding reachable in a public artifact.

## Electron 23 rung

- Target: Electron 23.3.13 exact, electron-builder 22.14.13 unchanged.
- Registry install: complete; package and lockfile resolve the same Electron patch.
- Initial full audit: 4 moderate and 11 high, unchanged from Electron 22.
- Verification matrix: complete. Clean `npm ci`, production audit 0, full audit 4 moderate/11 high, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Artifact evidence: 99,405,198 bytes, 3,471 entries, SHA-256 `fce0d3ac68f787b57312b19b7b8ab50cc41bb7855b837478eb1199fda4df2fe9`.
- Disposition: compatibility rung accepted; the public binary release blocker remains active because the Electron and builder ladders are not complete and the full audit is unchanged.

## electron-builder 23 rung

- Target: electron-builder 23.6.0 exact, Electron 23.3.13 unchanged.
- Registry install: complete; package and lockfile resolve the same builder patch.
- Initial full audit: 13 high and 1 critical, so this intermediate builder is not releasable.
- Verification matrix: complete. Clean `npm ci`, production audit 0, full audit 13 high/1 critical, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Artifact evidence: 99,531,395 bytes, 3,470 entries, SHA-256 `4988a2e8603d33ed9bdd448494b1f574c7ba2d28d69559f43b3fe17c1f18a1ba`.
- Disposition: compatibility rung accepted; the public binary release blocker remains active because the critical `tar` finding is still present and the builder/Electron ladders are incomplete.

## electron-builder 24 rung

- Target: electron-builder 24.13.3 exact, Electron 23.3.13 unchanged.
- Registry install: complete; package and lockfile resolve the same builder patch.
- Initial full audit: 9 high and 1 critical, so this intermediate builder is not releasable.
- Verification matrix: complete. Clean `npm ci`, production audit 0, full audit 9 high/1 critical, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Artifact evidence: 99,527,011 bytes, 3,420 entries, SHA-256 `4523dc54ade78fbe6ad7e66ac4baa1d2aa8a74139a18a77396c530682d3a0086`.
- Disposition: compatibility rung accepted; the public binary release blocker remains active because the critical `tar` finding is still present and the builder/Electron ladders are incomplete.

## electron-builder 25 rung

- Target: electron-builder 25.1.8 exact, Electron 23.3.13 unchanged.
- Registry install: complete; package and lockfile resolve the same builder patch.
- Initial full audit: 13 high and 1 critical, a regression from builder 24, so this intermediate builder is not releasable.
- Verification matrix: complete. Clean `npm ci`, production audit 0, full audit 13 high/1 critical, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Artifact evidence: 99,529,335 bytes, 3,420 entries, SHA-256 `1babe101a9836df1ad3dec90b8cb07e44f10875412a95b740eab2091ee520d2c`.
- Builder behavior: native dependency rebuild and the Windows ASAR-integrity resource update both completed; unsigned signing was explicitly skipped.
- Disposition: compatibility rung accepted; it is not a release candidate because the audit regressed and the builder/Electron ladders remain incomplete.

## electron-builder 26 rung

- Target: electron-builder 26.15.7 exact, Electron 23.3.13 unchanged.
- Registry install: complete; package and lockfile resolve the same builder patch.
- Initial full audit: 2 high and 0 critical. The builder and `tar` findings are resolved; the two remaining findings are Electron and its `extract-zip` dependency.
- Verification matrix: complete. Clean `npm ci`, production audit 0, full audit 2 high/0 critical, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Artifact evidence: 99,313,201 bytes, 3,012 entries, SHA-256 `3f37eba78f409e0e02b257efa9ff228929b01ad053876f7eaee29ddb129669d6`.
- Builder behavior: native dependency rebuild, Electron download/extraction, Windows ASAR-integrity resource update, and ZIP creation completed; unsigned signing remained non-fatal.
- Disposition: electron-builder ladder complete. Public binary release remains blocked on the Electron 24 through current-major ladder and its two high findings.

## Electron 24 rung

- Target: Electron 24.8.8 exact, electron-builder 26.15.7 unchanged.
- Registry install: complete; package and lockfile resolve the same Electron patch.
- Initial full audit: 2 high and 0 critical, unchanged from the Electron 23/builder 26 combination.
- Verification matrix: complete. Clean `npm ci`, production audit 0, full audit 2 high/0 critical, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Artifact evidence: 99,101,149 bytes, 3,012 entries, SHA-256 `587a42830896b0ea627fa216fc8e95b96e537b64d1a83269660478dfb3237a35`.
- Disposition: compatibility rung accepted; public binary release remains blocked on Electron 25 through the current major and the two high findings.

## Electron 25 rung

- Target: Electron 25.9.8 exact, electron-builder 26.15.7 unchanged.
- Registry install: complete; package and lockfile resolve the same Electron patch.
- Initial full audit: 2 high and 0 critical, unchanged from Electron 24.
- Verification matrix: complete. Clean `npm ci`, production audit 0, full audit 2 high/0 critical, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Artifact evidence: 99,323,972 bytes, 3,012 entries, SHA-256 `357da30fe25d7538bd1b6c00560495de249e0aede335f031e7b3cc996cd06ce0`.
- Disposition: compatibility rung accepted; public binary release remains blocked on Electron 26 through the current major and the two high findings.

## Electron 26 rung

- Target: Electron 26.6.10 exact, electron-builder 26.15.7 unchanged.
- Registry install: complete; package and lockfile resolve the same Electron patch.
- Initial full audit: 2 high and 0 critical, unchanged from Electron 25.
- Verification matrix: complete. Clean `npm ci`, production audit 0, full audit 2 high/0 critical, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Artifact evidence: 101,597,643 bytes, 3,012 entries, SHA-256 `6e0c9ca192936487c29e0b5dc69503a8bd3e99c7ce6d80160be927fd2e48ee1a`.
- Disposition: compatibility rung accepted; public binary release remains blocked on Electron 27 through the current major and the two high findings.

## Electron 27 rung

- Target: Electron 27.3.11 exact, electron-builder 26.15.7 unchanged.
- Registry install: complete; package and lockfile resolve the same Electron patch.
- Initial full audit: 2 high and 0 critical, unchanged from Electron 26.
- Verification matrix: complete with a runtime warning. Clean `npm ci`, production audit 0, full audit 2 high/0 critical, `verify` 236/236, fixed-seed order 236/236, two real Electron GUI smoke runs, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Runtime observation: both GUI smoke runs recovered and completed after the GPU subprocess exited unexpectedly (`-1073740791`; the second run also reported `34`). No Node global, preload/IPC, route, or renderer failure occurred. This warning must be rechecked on later majors and prevents treating Electron 27 as a release candidate.
- Artifact evidence: 104,949,433 bytes, 3,012 entries, SHA-256 `835623b7a854fdf2cd096d2a1584b541204a24c0ed814e2a8783639025a59b41`.
- Disposition: compatibility rung accepted with a recovered GPU warning; public binary release remains blocked on Electron 28 through the current major and the two high findings.

## Electron 28 rung

- Target: Electron 28.3.3 exact, electron-builder 26.15.7 unchanged.
- Registry install: complete; package and lockfile resolve the same Electron patch.
- Initial full audit: 2 high and 0 critical, unchanged from Electron 27.
- Verification matrix: complete. Clean `npm ci`, production audit 0, full audit 2 high/0 critical, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- GPU recheck: the unchanged GUI smoke completed without a GPU subprocess error, isolating the recovered warning to the Electron 27 rung on this host.
- Artifact evidence: 107,068,585 bytes, 3,012 entries, SHA-256 `07c8ccd642437aaf7b59c8b31b7124b429827e285d1eefecffca2b537d6a6967`.
- Disposition: compatibility rung accepted; public binary release remains blocked on Electron 29 through the current major and the two high findings.

## Electron 29 rung

- Target: Electron 29.4.6 exact, electron-builder 26.15.7 unchanged.
- Registry install: complete; package and lockfile resolve the same Electron patch.
- Initial full audit: 2 high and 0 critical, unchanged from Electron 28.
- Verification matrix: complete. Clean `npm ci`, production audit 0, full audit 2 high/0 critical, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Artifact evidence: 107,713,469 bytes, 3,012 entries, SHA-256 `240e8e8074173762e4b70b27919732464437d09c935a8f810e6238b532dd9b5b`.
- Disposition: compatibility rung accepted; public binary release remains blocked on Electron 30 through the current major and the two high findings.

## Electron 30 rung

- Target: Electron 30.5.1 exact, electron-builder 26.15.7 unchanged.
- Registry install: complete; package and lockfile resolve the same Electron patch.
- Initial full audit: 2 high and 0 critical, unchanged from Electron 29.
- Verification matrix: complete. Clean `npm ci`, production audit 0, full audit 2 high/0 critical, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Artifact evidence: 108,344,863 bytes, 3,012 entries, SHA-256 `7d579be857f748b1fc0e84b76f7aa02cc9a05c450c7a109ea41e7c6afa1bbf57`.
- Disposition: compatibility rung accepted; public binary release remains blocked on Electron 31 through the current major and the two high findings.

## Electron 31 rung

- Target: Electron 31.7.7 exact, electron-builder 26.15.7 unchanged.
- Registry install: complete; package and lockfile resolve the same Electron patch.
- Initial full audit: 2 high and 0 critical, unchanged from Electron 30.
- Verification matrix: complete. Clean `npm ci`, production audit 0, full audit 2 high/0 critical, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Artifact evidence: 110,233,601 bytes, 3,012 entries, SHA-256 `83ec0fc8569c70fe43386e991ee7fc7fd22b4673636a742814162b5a433aba0b`.
- Disposition: compatibility rung accepted; public binary release remains blocked on Electron 32 through the current major and the two high findings.

## Electron 32 rung

- Target: Electron 32.3.3 exact, electron-builder 26.15.7 unchanged.
- Registry install: complete; package and lockfile resolve the same Electron patch.
- Initial full audit: 2 high and 0 critical, unchanged from Electron 31.
- Verification matrix: complete. Clean `npm ci`, production audit 0, full audit 2 high/0 critical, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Artifact evidence: 112,556,338 bytes, 3,012 entries, SHA-256 `91c4384cd06ebd4c48aa2d7580e8522f026c692fa385b2b4a894d7414040b6fd`.
- Disposition: compatibility rung accepted; public binary release remains blocked on Electron 33 through the current major and the two high findings.

## Electron 33 rung

- Target: Electron 33.4.11 exact, electron-builder 26.15.7 unchanged.
- Registry install: complete; package and lockfile resolve the same Electron patch.
- Initial full audit: 2 high and 0 critical, unchanged from Electron 32.
- Verification matrix: complete. Clean `npm ci`, production audit 0, full audit 2 high/0 critical, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Artifact evidence: 114,400,989 bytes, 3,012 entries, SHA-256 `91d72f1830da58a5b8027335786a04b204b74904c6006fe9628e15bb5e3b14a3`.
- Disposition: compatibility rung accepted; public binary release remains blocked on Electron 34 through the current major and the two high findings.

## Electron 34 rung

- Target: Electron 34.5.8 exact, electron-builder 26.15.7 unchanged.
- Registry install: complete; package and lockfile resolve the same Electron patch.
- Initial full audit: 2 high and 0 critical, unchanged from Electron 33.
- Verification matrix: complete. Clean `npm ci`, production audit 0, full audit 2 high/0 critical, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Artifact evidence: 115,530,936 bytes, 3,012 entries, SHA-256 `56e5f79154afb2216614984c8b3ab4a79d8e7155ce69abb22563d31af700efcc`.
- Disposition: compatibility rung accepted; public binary release remains blocked on Electron 35 through the current major and the two high findings.

## Electron 35 rung

- Target: Electron 35.7.5 exact, electron-builder 26.15.7 unchanged.
- Registry install: complete; package and lockfile resolve the same Electron patch.
- Initial full audit: 2 high and 0 critical, unchanged from Electron 34.
- Verification matrix: complete. Clean `npm ci`, production audit 0, full audit 2 high/0 critical, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Artifact evidence: 120,098,576 bytes, 3,012 entries, SHA-256 `2592fca6462297a45d91e275f675a99b1fef0676b9dffb8889b9ff6147fce2f1`.
- Disposition: compatibility rung accepted; public binary release remains blocked on Electron 36 through the current major and the two high findings.

## Electron 36 rung

- Target: Electron 36.9.5 exact, electron-builder 26.15.7 unchanged.
- Registry install: complete; package and lockfile resolve the same Electron patch.
- Initial full audit: 2 high and 0 critical, unchanged from Electron 35.
- Verification matrix: complete. Clean `npm ci`, production audit 0, full audit 2 high/0 critical, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Artifact evidence: 120,718,162 bytes, 3,012 entries, SHA-256 `351606132afe19b9a326a97ddd03ced2e9a7d7fc4e0da0a5e656fdb841abb453`.
- Disposition: compatibility rung accepted; public binary release remains blocked on Electron 37 through the current major and the two high findings.

## Electron 37 rung

- Target: Electron 37.10.3 exact, electron-builder 26.15.7 unchanged.
- Registry install: complete; package and lockfile resolve the same Electron patch.
- Initial full audit: 2 high and 0 critical, unchanged from Electron 36.
- Verification matrix: complete. Clean `npm ci`, production audit 0, full audit 2 high/0 critical, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Artifact evidence: 132,572,932 bytes, 3,012 entries, SHA-256 `670a405b3fe9c9fca62c96aa27f9a9a1c6ae30e734958a7402c52459bd1d29b8`.
- Disposition: compatibility rung accepted; public binary release remains blocked on Electron 38 through the current major and the two high findings.

## Electron 38 rung

- Target: Electron 38.8.6 exact, electron-builder 26.15.7 unchanged.
- Registry install: complete; package and lockfile resolve the same Electron patch.
- Initial full audit: 2 high and 0 critical, unchanged from Electron 37.
- Verification matrix: complete. Clean `npm ci`, production audit 0, full audit 2 high/0 critical, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Artifact evidence: 135,014,318 bytes, 3,012 entries, SHA-256 `90f44ae12f0c635dd9695278e5cda8b72196a630c159800aad794b00af6efe78`.
- Disposition: compatibility rung accepted; public binary release remains blocked on Electron 39 through the current major and the two high findings.

## Electron 39 rung

- Target: Electron 39.8.10 exact, electron-builder 26.15.7 unchanged.
- Registry install: complete; package and lockfile resolve the same Electron patch.
- Initial full audit: 2 high and 0 critical, unchanged from Electron 38.
- Verification matrix: complete. Clean `npm ci`, production audit 0, full audit 2 high/0 critical, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Artifact evidence: 135,188,465 bytes, 3,012 entries, SHA-256 `8bfbccb1fc61c788be783b555b6aaccc67282984950c3271f6f7629290bcbfb0`.
- Disposition: compatibility rung accepted; public binary release remains blocked on Electron 40 through the current major and the two high findings.

## Electron 40 rung

- Target: Electron 40.10.6 exact, electron-builder 26.15.7 unchanged.
- Registry install: complete; package and lockfile resolve the same Electron patch.
- Initial full audit: 1 high and 0 critical. The `extract-zip` advisory is resolved; Electron's sandboxed-iframe OpenURL advisory remains through 41.10.2.
- Verification matrix: complete. Clean `npm ci`, production audit 0, full audit 1 high/0 critical, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Artifact evidence: 136,628,515 bytes, 3,012 entries, SHA-256 `0df3145c5300d56cd8816602c6b886edee24e575729c280b63592e2dd83c4be8`.
- Disposition: compatibility rung accepted; public binary release remains blocked on Electron 41 through the current major and the one high finding.

## Electron 41 rung

- Target: Electron 41.10.6 exact, electron-builder 26.15.7 unchanged.
- Registry install: complete; package and lockfile resolve the same Electron patch.
- Initial full audit: 0 vulnerabilities. The sandboxed-iframe OpenURL advisory ending at 41.10.2 is resolved.
- Verification matrix: complete. Clean `npm ci`, production and full audits 0, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Artifact evidence: 141,208,106 bytes, 3,012 entries, SHA-256 `dfabf0ba8130171ede887ee551d3b5ef80faaafb761f192607a56c556bde904f`.
- Disposition: compatibility rung accepted; public binary release remains blocked only on Electron 42 through the current-major verification ladder.

## Electron 42 rung

- Target: Electron 42.9.3 exact, electron-builder 26.15.7 unchanged.
- Registry install: complete; package and lockfile resolve the same Electron patch.
- Initial full audit: 0 vulnerabilities, unchanged from Electron 41.
- Verification matrix: complete. Clean `npm ci`, production and full audits 0, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Install observation: after clean install, the first binary-dependent test fetched the Electron binary lazily; the subsequent GUI and packaging runs passed without intervention.
- Artifact evidence: 140,468,586 bytes, 3,012 entries, SHA-256 `6d82279ae92f5c2bcf4152f703104cdce7ba4aa7e5ced43759da84d86650324e`.
- Disposition: compatibility rung accepted; public binary release remains blocked only on the current Electron 43 verification rung.

## Electron 43 rung

- Target: Electron 43.4.1 exact, electron-builder 26.15.7 unchanged.
- Registry install: complete; package and lockfile resolve the same Electron patch.
- Initial full audit: 0 vulnerabilities, unchanged from Electron 42.
- Verification matrix: complete. Clean `npm ci`, production and full audits 0, `verify` 236/236, fixed-seed order 236/236, real Electron GUI smoke, CLI build, and packaged `E_REQUEST_INVALID`/exit1 smoke passed.
- Install observation: the clean-install binary fetch remained lazy and completed during the first binary-dependent test; subsequent GUI and packaging runs passed.
- Artifact evidence: 148,287,234 bytes, 3,012 entries, SHA-256 `2ad8bc19ddcc293c8917053a62fcaea5c9fe1b69d39bc30282ff25e0a8dcb4b3`.
- Disposition: current-major compatibility rung accepted. Electron/electron-builder ladder and audit release blockers are cleared; the general release checklist remains authoritative.

## Post-ladder P3-P5 integration checkpoint

- Date: 2026-08-24; Electron 43.4.1 and electron-builder 26.15.7 unchanged.
- Clean lockfile install, production/full audits 0, `verify` 243/243,
  fixed-seed order 243/243, and all six benchmarks passed.
- Real Electron security/GUI smoke passed. The rebuilt portable GUI is
  109,353,724 bytes and the NSIS installer is 109,563,216 bytes. A five-second
  packaged launch had no early exit and cleanup left 0 of 4 observed processes.
- Two complete CLI builds produced byte-identical 148,285,977-byte archives
  with 76 ZIP entries and SHA-256
  `73658e117b4e8bb479fc15277e0851d900e09e4a283339313ec8474378a4f8c6`.
  The package verifier accepted 3,012 internal ASAR entries and the packaged
  `E_REQUEST_INVALID`/exit-1 smoke.
- Root cause of the prior archive hash drift was electron-builder's per-build
  NTFS `0x000a` ZIP extra field. The release normalizer now fixes UTF-8 entry
  order and DOS time and removes volatile extra fields/comments; a hostile
  metadata and Windows-alias collision regressions plus the package verifier
  enforce that contract.
- Repeated SHA256SUMS, manifest, and SPDX 2.3 SBOM content was byte-identical.
  Because this integration worktree is not committed, the evidence correctly
  records `sourceTreeDirty: true` and is not clean-source release evidence.

## Post-real-sample packaging checkpoint

- Date: 2026-08-25; Electron 43.4.1 and electron-builder 26.15.7 unchanged.
- Current security/GUI smoke passed with renderer sandbox, context isolation,
  web security, typed IPC, no renderer Node globals, and RPG/Wolf/settings/route
  flows. Normal and fixed-seed suites passed 362/362; core coverage is
  90.16% lines/72.00% branches/96.88% functions, and all six benchmark cases
  remain within their CI ceilings.
- Two CLI builds are byte-identical at 146,848,992 bytes, 76 ZIP entries, and
  SHA-256
  `a2ac85b9f95610701243adef8112bd7526e0c0759d9b1c5e8df47da80adc4e2b`.
  Package verification accepts 1,791 app-ASAR entries and now proves both
  `ok`/exit 0 on a valid one-entry RPG MV request and
  `E_REQUEST_INVALID`/exit 1 on a missing request, each with a 15-second bound.
- A packaged deep verify of the authorized 171,602-entry RPG MV output completed
  normally in 193.137 seconds with exit 0, score 94/100, low risk, one changed
  file, and zero protected damage. The source CLI completed the same request in
  133.043 seconds. The initial 180-second packaged harness ceiling was too short;
  no product exit leak remained under the corrected bound.
- The rebuilt portable is 108,527,703 bytes/SHA-256
  `5749083b3c5852e0e3a393e940cef8c8123a76dd4d11c4e8413f07885c6e65ce`;
  the NSIS installer is 108,737,198 bytes/SHA-256
  `ed83b0d1a2fe201d73c41d2f443421f44d0fc45666de9e9fc260fba8751cd606`.
  Both are unsigned. A hidden 15-second portable launch observed five responding
  processes and exact-tree termination left zero residual processes.
- Repeated dirty-worktree evidence is byte-identical: `SHA256SUMS`
  `f463cd5b9f92399a2f3d636c5a094307b70e89798ced0bfce16909dc0ec24cea`,
  manifest `066a4ce848ddb6d93a5ef1812d834fd8f9a9d54fed7ed682e48e7fbbaf73587c`,
  and SPDX SBOM `f36dcabdbd7392cb055de506cc0d63ad1a78b2ff6aaaded4fdf091f9e4646443`.
  It records source commit `17fa6e7108fca66eda5a436e19febc955c0acd9d`,
  112 runtime packages, and `sourceTreeDirty:true`.
- A fresh online npm audit was not run because registry submission of lockfile
  and dependency metadata lacked external-data authorization. The lockfile is
  unchanged at SHA-256
  `883b8fb1cd7f045e15987a1fffa3df8b1205eea931c88832f0fe145cf3a06c52`;
  prior audit results are historical rather than a fresh claim.
- This checkpoint remains dirty-source evidence. Clean committed reproduction,
  hosted CI, manual gameplay, a real directory-form `package.nw` sample,
  signing, and publication remain separate gates.

## Cross-platform portability checkpoint

- Date: 2026-08-25; Electron 43.4.1 and electron-builder 26.15.7 unchanged.
- An isolated Node 22.17.1/npm 10.9.2 Debian snapshot ran with no network and
  passed `verify` and fixed-order execution with 361 pass, four intentional
  platform/optional-binary skips, and zero failures out of 365 tests. Windows
  passed the same normal and fixed-order sets 365/365.
- Linux full coverage is 89.34% lines/75.44% branches/89.78% functions. Linux
  and Windows core coverage both pass at 90.36%/72.21%/96.88%.
- The refreshed normalized CLI archive is 146,849,315 bytes, 76 ZIP entries,
  and SHA-256
  `68decf43860673a99e03ff1cc74a695b1dcbf49699777489657741fbc6bbdd87`.
  Package verification accepts 1,791 app-ASAR entries and proves bounded
  `ok`/exit 0 and `E_REQUEST_INVALID`/exit 1 execution.
- The offline lockfile install reported zero vulnerabilities from cached audit
  metadata, but no fresh online registry audit was performed or claimed. Hosted
  CI and clean committed-source reproduction remain authoritative release gates.

## Fresh registry and install-script policy checkpoint

- Date: 2026-08-25; the lockfile SHA-256 remains
  `883b8fb1cd7f045e15987a1fffa3df8b1205eea931c88832f0fe145cf3a06c52`.
- Fresh online `npm audit --omit=dev --json` and full `npm audit --json` both
  returned exit 0 with zero findings at every severity. npm reported 113
  production dependencies and 467 dependencies in the complete graph.
- npm 11.19.0 identified one lockfile dependency lifecycle script:
  `electron-winstaller@5.4.0`, a Squirrel-only transitive peer. The project now
  denies that unused script explicitly in `allowScripts`; a clean offline
  `npm ci` installs 467 packages with zero vulnerabilities and
  `npm install-scripts ls --json` reports no pending decision.
- This closes the stale online-audit and unclassified-install-script gaps for
  the current candidate. Hosted CI and an exact final committed-source
  reproduction remain independent release gates.
