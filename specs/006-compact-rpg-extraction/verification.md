# Verification — compact RPG translation packs

Date: 2026-10-02. Baseline: `main@fc0e9ea`; feature 004/005 changes were already
uncommitted and remain preserved. This records local implementation and checks,
not a commit, hosted CI run or release. Node 24.14.0, Electron 43.4.1, Windows.

## Reproductions and corrections

- The first focused test rejected `translationPack` as an unknown v2 option.
  Added the explicit RPG-only request field and separate pack contract.
- All three initial real-game no-op attempts failed source authentication:
  consecutive extractions retained event IDs in module state. Reset the event
  counter and comment flags in the shared extraction initializer. A fixture with
  event 357/355 now proves same-process extraction/reapplication.
- Real-game apply terminated in native `fs.cpSync`. The local runtime reproduced
  exit `0xc0000409` with a tiny Unicode directory and with a moved Korean-named
  pack. The common container copy helper now uses individual physical file
  operations; CLI copies reuse it. Unicode, overwrite, exclusions, overlap and
  destination-link tests pass. Existing copy-time link injection and partial
  output failure tests were retained at the common copy boundary.
- Source authentication rejects a forged Backup even when its metadata hash is
  resealed. Other focused checks cover moved MV/MZ identity, protected assets,
  stale input, path traversal, junctions, output conflicts, cancellation,
  rollback, v1/non-RPG/unknown-option rejection and source resource accounting.

Focused copy/core/compact checks: **62/62 pass**. Contract examples are included
in the full gate below. Ignored local logs include `compact-red.log`,
`compact-event-red.log`, `compact-unicode-red.log`, and `compact-copy-focused.log`.

## Private corpus

The three user-supplied copies were read without executing games/plugins.
Each run used v2 `format:auto`, `profile:full`, `translationPack:true`, deep
verify, no-op apply, a small mapped patch, and a separate patched output.
Copies A/B require the existing malformed-ASAR repack opt-in; invalid metadata
is omitted from rebuilt headers without changing valid payload file contents.

| Sample | Engine/container | Source bytes / physical files | Pack bytes / files | Entries | Pack/source |
| --- | --- | ---: | ---: | ---: | ---: |
| A | MZ / Electron ASAR / Live2D | 1,044,754,832 / 73 | 7,693,456 / 30 | 10,093 | 0.7364% |
| B | MZ / Electron ASAR / Live2D | 1,194,104,346 / 74 | 15,066,755 / 31 | 19,465 | 1.2618% |
| C | MV / loose NW runtime / video and particle plugins | 1,047,972,733 / 4,018 | 3,462,583 / 31 | 4,386 | 0.3304% |

All three: extract, deep verify, no-op apply, patch and edited apply **pass**.
No-op output has zero changed payload/loose files. Edited A/B change exactly
`project/data/System.json` and the mapped UI parameter in `project/js/plugins.js`;
C changes exactly `www/data/System.json`. A/B archive lists retain all 2,518 /
3,994 valid payload files. Wrapper files and every unrelated asset, implementation
script and Live2D resource retain their bytes. Existing C extraction artifacts
also remain intact in the game copy.

All 4,165 source physical files and both editable/pristine packs retain their
hashes after apply. Source hashes also match the first-run baseline, including
across failed attempts. The pack contains only `Backup`, `Extract`,
`.extracteddata`, `.tsukuru-rpg-pack.json`; no media/model/runtime copy exists.
The synthetic ASAR test makes full archive expansion throw during extraction,
proving the selective path does not depend on full expansion.

Observed extract / deep-verify / no-op-apply / edited-apply seconds:
A 3.079 / 6.320 / 20.843 / 27.998;
B 7.342 / 12.564 / 33.416 / 40.370;
C 1.314 / 2.670 / 39.139 / 53.324.
These are local observations during concurrent checks, not benchmark guarantees.

Private source snapshots, requests/results and game outputs remain in the
user's laboratory verification directory, run suffix `_05`. The private runner
and logs are ignored under `tsukuru-agent/tmp/`; no title, dialogue, absolute
private game path or crash payload is copied into tracked evidence. Fourteen
owned temporary directories left by native crashes were removed after checking
their exact names, parent and creation times; three empty failed-output staging
directories were also removed. Successful run outputs are retained.

## Final gates

| Command/check | Result |
| --- | --- |
| `npm run verify` | Pass; 457/457 runtime tests, type/style/complexity/generated/inventory/supply-chain gates pass |
| `npm run test:order` | Pass; 457/457 with fixed shuffled order |
| `npm run benchmark:check` | Pass; all six RPG/Wolf/Tyrano/GDevelop/ASAR/NW cases |
| `npm run test:electron` | Pass; actual Electron renderer/IPC/RPG/Wolf/settings/routes |
| `npm run build:cli` | Pass; normalized ZIP has 76 entries |
| `npm run verify:package` | Pass; 1,809 app entries, success exit 0 and invalid-request exit 1 |
| Packaged compact workflow | Pass; actual CLI executable, Unicode paths, external ASAR, extract → deep verify → plugin-label patch → apply; source archive and unrelated checked assets unchanged |

Inventory is 64 files / 448 top-level declarations; nested tests account for the
457 runtime checks. Logs: `compact-verify-final.log`, `compact-order-final.log`,
`compact-benchmark-final.log`, `compact-electron.log`, `compact-build-cli.log`,
`compact-package.log`, `compact-packaged-flow.log` under ignored application `tmp`.
The packaged fixture's only changed checked file is `project/js/plugins.js`.
The package verifier explicitly requires the new pack module and schema.

Local ZIP: `tsukuru-agent/dist-cli/tsukuru-agent-2.5.0-win.zip` (146,881,373 bytes).
SHA-256: `a5e98e06a80f5126a710728c5afe7bac7fad582e2aae605ad50a773a7198a20b`.
This package includes preserved 004/005 and new 006 work. No commit, push,
installation into another tool or public release was performed.

## Acceptance map and limits

FR-001–003 / SC-001–002: explicit schemas, selective input staging, no-full-unpack
fixture and the three inventories above. FR-004: profile warnings and documented
coverage. FR-005–007 / SC-003–004: moved-pack and adverse-path regressions plus
source-authenticated no-op/edit round trips. FR-008: private corpus results.
FR-009: RED evidence, preserved earlier changes and final gates above.

Full profile retains existing parameter/event-script scope. Model names, motion
names, commands and other identifiers need manual selection. Plugin implementation
JavaScript bodies and their hardcoded UI strings are not extracted. Generic
plugin decompilation, packaged NW archive compact mode, automatic translation,
full Korean localization and gameplay are not claimed. C contains no Live2D;
the Live2D evidence comes from A/B and the synthetic fixture. No real game was
launched, so this is structural/content verification, not a save/playthrough pass.
