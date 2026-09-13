# Release Tsukuru Agent with reproducible evidence

Do not publish from a working directory with unexplained changes. Record the
source commit, supported Node/npm versions, operating system, and every manual
sample result. Automated checks and manual gameplay answer different questions
and must remain separate in the release report.

## Clear active blockers first

- [x] Complete the current-major Electron 43.4.1 rung with
  electron-builder 26.15.7.
- [x] Resolve or time-bound every full-audit finding according to the audit
  policy.
- [x] Re-run Windows GUI launch, sandbox preload/IPC, worker cancellation,
  settings, route, ASAR/NW.js, Authenticode, launch-probe, and process-tree
  cleanup after each major.

These dependency blockers are clear. A public binary still must not be
described as security-cleared or release-ready until the remaining automated
evidence, packaged-GUI, signing, and manual-playtest items below are complete.

The 2026-08-24 integration checkpoint passed a clean lockfile install,
243/243 normal and fixed-seed tests, all six benchmarks, production/full audits
with 0 vulnerabilities, Electron 43.4.1 GUI smoke, packaged-GUI launch/cleanup,
and two byte-identical 148,285,977-byte CLI ZIP builds (SHA-256
`73658e117b4e8bb479fc15277e0851d900e09e4a283339313ec8474378a4f8c6`).
The repeated checksum/manifest/SPDX outputs were also identical. This was a
dirty integration worktree check (`sourceTreeDirty: true`), so the unchecked
clean-source, signing, publication, and manual-playtest gates below remain
authoritative.

A later integration pass on 2026-08-24 passed normal and fixed-seed execution
with 355/355 actual Node tests, 19 generated pairs, an inventory of 50 tracked
test files/350 top-level declared checks, all six benchmarks, both npm audits at
0 vulnerabilities, Electron smoke, and packaged-GUI launch/cleanup. Two fresh
CLI builds are byte-identical at 146,848,378 bytes (SHA-256
`af69fc1690671d1ec5a8f9639187a8aafe1e6407ea65dfe6f79a286c742be629`),
and package verification accepted 1,791 entries plus the error/exit-code smoke.
This was also a dirty-worktree run and does not close any unchecked release gate
below.

The latest dirty integration checkpoint on 2026-08-25 passed normal and
fixed-seed execution with 362/362 actual Node tests, 50 test files/355 top-level
checks, core coverage of 90.16% lines/72.00% branches/96.88% functions, all six
benchmarks, generated/inventory/supply-chain drift checks, and the Electron
43.4.1 security/GUI smoke. Two CLI builds are byte-identical at 146,848,992
bytes with 76 ZIP entries and SHA-256
`a2ac85b9f95610701243adef8112bd7526e0c0759d9b1c5e8df47da80adc4e2b`.
Package verification accepts 1,791 ASAR entries and now executes both a valid
one-entry RPG MV request (`ok`/exit 0) and a missing request
(`E_REQUEST_INVALID`/exit 1). Repeated non-release evidence is byte-identical and
records source commit `17fa6e7108fca66eda5a436e19febc955c0acd9d`, 112 runtime
packages, and `sourceTreeDirty: true`.

The rebuilt portable GUI is 108,527,703 bytes (SHA-256
`5749083b3c5852e0e3a393e940cef8c8123a76dd4d11c4e8413f07885c6e65ce`)
and the NSIS installer is 108,737,198 bytes (SHA-256
`ed83b0d1a2fe201d73c41d2f443421f44d0fc45666de9e9fc260fba8751cd606`).
Both report `NotSigned`. A 15-second hidden portable launch kept all five
observed processes responding and exact-tree termination left none. A packaged
deep verify of the 171,602-entry authorized RPG MV output completed with exit 0,
score 94/100, and zero protected damage in 193.137 seconds; this is structural
and bounded runtime evidence, not manual gameplay.

A fresh online npm audit was not run in this checkpoint because sending lockfile
and dependency metadata to the registry lacked external-data authorization. The
unchanged lockfile SHA-256 is
`883b8fb1cd7f045e15987a1fffa3df8b1205eea931c88832f0fe145cf3a06c52`.
Earlier audit results remain historical evidence. All unchecked clean-source,
hosted-CI, signing, publication, real directory-form `package.nw`, and manual
playtest gates below remain authoritative.

The later 2026-08-25 cross-platform checkpoint used an isolated, networkless
Node 22.17.1 Linux snapshot. Linux normal and fixed-order runs each executed 365
tests with 361 pass, 0 fail, and four explicit Windows/optional-Electron skips;
Windows normal and fixed-order runs passed 365/365. Core coverage on both hosts
was 90.36% lines/72.21% branches/96.88% functions, while Linux full coverage was
89.34%/75.44%/89.78%. The refreshed CLI archive is 146,849,315 bytes with
SHA-256 `68decf43860673a99e03ff1cc74a695b1dcbf49699777489657741fbc6bbdd87`;
the package verifier accepted 1,791 entries and passed bounded
`ok`/exit 0 plus `E_REQUEST_INVALID`/exit 1 contracts. This remains a dirty-tree
local preflight and does not replace a clean checkout or hosted Linux CI log.

The subsequent 2026-08-25 registry checkpoint ran fresh online production-only
and full npm audits against the unchanged lockfile. Both returned exit 0 with
zero findings at every severity (113 production dependencies, 467 total). npm
11.19.0 also exposed one pending dependency lifecycle script decision for the
unused Squirrel peer `electron-winstaller@5.4.0`; it is now explicitly denied in
`allowScripts`. A clean offline install completed without a pending-script
warning, and `npm install-scripts ls --json` returned an empty list. The final
canonical commit and hosted-CI repetition remain open even though these two
supply-chain gaps are closed for the current candidate.

### Exact-source local release checkpoint (2026-08-25)

A disposable clean Git candidate was populated byte-for-byte from the current
integration source, then installed from the unchanged lockfile. Its normal and
fixed-order suites each passed 366/366, Electron security/IPC and RPG/Wolf GUI
smoke passed, and all six performance cases remained within their baselines.
The normalized CLI ZIP was byte-identical across two builds at 146,849,326 bytes
and SHA-256
`3c9b3494bcdbbde2567ddaa6bc29ffb13f848b659c3649ac221f962d4e0997e1`.
Package verification accepted 1,791 entries and required both
`ok`/exit 0 and `E_REQUEST_INVALID`/exit 1. Repeated release evidence produced
identical checksum, manifest, and SPDX SBOM files with 112 runtime packages and
`sourceTreeDirty:false`.

The same candidate built the Windows portable and NSIS artifacts. They are
unsigned, as expected before the signing gate. The unpacked packaged GUI kept
four responding processes alive through a ten-second hidden observation, and
exact-path cleanup left zero processes and no probe settings directory. This is
strong local clean-candidate evidence, but the disposable synthetic commit is
not the canonical user-repository commit and does not replace hosted CI,
representative gameplay, signing, or publication approval.

### Historical integration checkpoint (2026-08-28)

The source at that checkpoint passed normal and fixed-order execution at 395/395. The
tracked inventory is 58 files/388 top-level checks; core coverage is 89.86%
lines, 72.24% branches, and 94.20% functions. All six performance cases,
full npm audit, install-script policy, generated/style/inventory/supply-chain
drift, and the actual Electron security/IPC/RPG/Wolf/settings/route smoke pass.

Windows packaging produced a 108,492,414-byte portable (SHA-256
`4511b13e739c3433639536d8b45356fcf69a7401b3a1946938855e0390ff4898`)
and a 108,701,909-byte NSIS installer (SHA-256
`526a2d7b4a7086017fbb56717523b854fdaabc71af709842906f06d52eca78f2`).
The unpacked GUI started with four exact-path processes and cleanup left zero.
Two CLI builds produced the same 146,850,322-byte, 76-entry ZIP with SHA-256
`abc6bdc87327f9be47f987f3e963b696104d7c09c06d9995fc2be9cb02e7fee2`.
Package verification accepted 1,791 entries and both success/exit 0 and
failure/exit 1 contracts. Two release-evidence generations were byte-identical,
but correctly record `sourceTreeDirty:true`; final clean canonical evidence is
therefore still open.

The later patch-mapping maintenance record is
[002-safe-patch-workflow verification](../specs/002-safe-patch-workflow/verification.md).
Its source checks do not replace the historical package evidence or complete
the outstanding clean-source, hosted CI, gameplay and release gates.

The packaged CLI also deep-verified the authorized RPG MV copy at score 94 with
159,532 valid mappings, one changed file/19 text bytes, and zero protected
damage. A full post-runtime comparison found no missing or extra path and only
the intended `www/data/System.json` difference. The untouched 5,868-file source
retains its initial size and five critical hashes. This is structural/runtime
evidence, not representative gameplay.

## Reproduce and verify the source automatically

From `tsukuru-agent`:

```powershell
npm ci
npm install-scripts ls --json
npm run sync:version
npm run verify
npm run test:order
npm run benchmark:check
npm audit --omit=dev
npm audit
```

- [x] `npm run sync:version` leaves no unexpected diff.
- [x] Package, `version.json`, release notes, CHANGELOG, GUI metadata, and
  artifact template point at the same version.
- [x] Typecheck, all tests, generated drift, test inventory, dependency/binary
  inventory, notices, and audit-exception expiry checks pass.
- [x] A clean install has no pending dependency lifecycle script decision;
  every lockfile `hasInstallScript` entry is explicitly allowed or denied.
- [x] Fixed-order and benchmark checks pass within their recorded limits.
- [x] The production-only audit has no unreviewed finding.
- [x] The full audit is recorded separately and does not hide Electron/builder
  development or packaging risk.

## Verify Windows GUI behavior

Run:

```powershell
npm run test:electron
npm run build
```

- [x] Every renderer remains sandboxed with no Node global exposure.
- [x] Typed preload and bidirectional IPC smoke tests pass.
- [x] RPG and Wolf extract/apply, settings persistence, window close, screen
  transitions, cancellation, and tracked child-process cleanup pass.
- [x] The packaged GUI starts from the expected entry point and contains no CLI
  output tree or previous package artifact.

## Build and inspect the CLI package

Run:

```powershell
npm run build:cli
npm run verify:package
npm run release:evidence -- dist-cli/release-evidence dist-cli/tsukuru-agent-2.5.0-win.zip
```

Replace the archive name with the version-derived file emitted by the build.

- [x] The packaged executable emits exactly one JSON result on stdout and uses
  exit code 0 for success and 1 for failure.
- [x] Required CLI/core/engine/schema/license/notice files are present.
- [x] GUI-only translation binaries and nested `dist`, `dist-cli`, or `.build`
  trees are absent.
- [ ] `SHA256SUMS`, release manifest, clean-source manifest, and SPDX 2.3 SBOM
  bind the exact archive and source commit.
- [x] Repeating release evidence generation produces identical content.

## Run manual gameplay separately

Use disposable full-game copies. Record sample ID without a private path, engine,
wrapper, original hash, translated output hash, structural result, launch result,
scenes exercised, duration, process cleanup, and tester notes.

- [ ] RPG Maker MV loose extract → patch → apply → representative gameplay.
- [ ] RPG Maker MZ loose and Electron/ElectronForMZ representative gameplay.
- [ ] Wolf RPG binary-mapped translation and representative gameplay.
- [ ] TyranoScript UTF-8 and Shift_JIS representative gameplay.
- [ ] GDevelop standard JSON profile representative gameplay.
- [ ] Every experimental feature proposed for release has its own real sample:
  directory-form `package.nw`, unsigned appended ZIP, malformed-ASAR cleanup,
  or GDevelop generated-code strings as applicable.
- [x] Original game/archive hashes remain unchanged and no residual launched
  process remains.

A short launch probe is not manual gameplay. Synthetic fixtures are not real
sample coverage. Mark missing evidence as unverified instead of inferring it.

The 2026-08-25 approved RPG MV copy now has direct title-screen evidence: the
fixed output rendered its artwork and complete menu and exposed the translated
`[Tsukuru Agent E2E]` system title in the native window. The subsequent menu
click outcome was unknown and the user interrupted UI control, so no New Game,
map, dialogue, save, or representative-gameplay claim is made. Exact cleanup
removed the root plus three NW.js children, the disposable copy recorded no new
file write, and the original 5,868-file source retained its count, byte total,
and critical hashes. Keep the RPG MV gameplay checkbox open until the remaining
scene-level actions and tester record are completed.

## Publish the release record

- [x] Update `CHANGELOG.md` and the detailed release notes without overwriting a
  prior release section.
- [x] Link the compatibility matrix, security policy, migration note, and known
  limitations.
- [ ] Attach only the verified artifacts and generated evidence.
- [ ] Publish source and license notices required by GPL-3.0-only.
- [ ] Confirm the release page, package metadata, GUI update manifest, and
  archive filename all use the canonical version.
- [ ] Retain the CI logs and redacted manual compatibility record.
