# Post-v2.5 hardening baseline

Date: 2026-08-19  
Baseline: `main@17fa6e7108fca66eda5a436e19febc955c0acd9d`  
Environment: Windows, Node `v24.14.0`, npm `11.19.0`

This document separates what a clean Git checkout can reproduce from the
additional regression assets present only in the maintainer's populated local
working tree. No real game data was used for this baseline.

## Baseline split

| Evidence | Tracked clean checkout | Local augmented worktree |
|---|---:|---:|
| Test files | 4 | 10 |
| Test cases after compile | 61 | 78 (previously verified and reconfirmed separately) |
| `package-lock.json` | absent | ignored, 166,536 bytes |
| GitHub Actions workflows | 0 | 0 |
| Generated engine-service JavaScript before compile | absent | present |

The correct interpretation is not that all older regression assets are lost.
Six test files exist locally but cannot be reproduced from the Git baseline.

## Clean-room procedure

An independent detached worktree was created at the exact baseline commit.
Before installation it contained no `node_modules`, lockfile, `dist`, or
`dist-cli` directory. It contained 55 TypeScript files and 21 tracked
JavaScript files under `src/`.

`npm install` completed without a lockfile, added 612 packages, and produced a
new lockfile. npm reported 23 audit findings (7 moderate, 14 high, 2 critical)
and did not automatically approve Electron's install script under npm 11's
install-script policy. These are baseline observations, not remediations.

## Compile/test/build matrix

The essential clean-room sequence was:

```powershell
git worktree add --detach <TEMP_WORKTREE> 17fa6e7
Set-Location <TEMP_WORKTREE>\tsukuru-agent
node --version
npm --version
npm install
npm run typecheck
npm test
npm run build
npm run build:cli
npm run compile
npm test
npm run build
npm run build:cli
npx --no-install asar list .\dist-cli\win-unpacked\resources\app.asar
```

The first test and build commands are expected to preserve the failures listed
below. Turning those failures into passes changes the baseline and belongs to a
later build-chain change.

| Check | Before explicit compile | After `npm run compile` |
|---|---|---|
| `npm run typecheck` | pass | not required to explain the delta |
| `npm test` | fail: 45/46 pass; `v25-cli.test.js` cannot load `RpgMakerService.js` | pass: 61/61 |
| `npm run build` | fail: packaged `main.js` is missing | pass: portable + NSIS |
| `npm run build:cli` | exit 0, but package misses RPG/Wolf service modules | pass and required engine services present |
| Packaged CLI smoke | pre-compile package emits no JSON and stays alive | post-compile package exits 1 with one `E_PATH_NOT_FOUND` JSON result |

The compile step increased `src/**/*.js` from 21 to 57 files. The 36 emitted
files include `main.js`, RPG/Wolf/Tyrano/GDevelop services, renderers, and
legacy engine modules that are ignored by Git. With system
`core.autocrlf=true`, compile also makes 19 tracked JavaScript paths appear
modified in `git status`; their normalized content has no diff
(`git diff --quiet` exits 0). This line-ending/status behavior must be handled
explicitly by later generated-drift checks.

The most serious production finding is that `build:cli` can succeed and create
a ZIP before compile even though required engine services are absent. A build
exit code alone therefore does not prove a usable package.

There is a second build-order defect. The GUI build includes `**/*`, excludes
`dist/*`, but does not exclude `dist-cli/**`. With a completed CLI build present,
the GUI ASAR included 77 `dist-cli` entries (the CLI ZIP, executable, Electron
runtime, and nested resources) and grew to 740,468,101 bytes. Removing only
`dist-cli` and rebuilding the same compiled checkout produced a 34,974,465-byte
GUI ASAR with zero `dist-cli` entries. GUI and CLI packaging must therefore be
isolated or explicitly exclude each other's outputs; the build order is part of
the current package contract.

## Lockfile evidence

| Lockfile | SHA-256 | Packages |
|---|---|---:|
| ignored local file | `463BB87330CA02987F49E891CCAA1A791E89F3DC8FEE775A37D8B4037F03A4E1` | 627 |
| clean `npm install` output | `1EEEC942B8EE190A04892C26BD7FBD79B982A8AB38DA79C096A8721F32A37051` | 624 |

The root dependency declarations are identical, but the resolved graphs are
not. Version differences include `@types/node` 26.1.2→26.2.0,
`@xmldom/xmldom` 0.9.10→0.9.11, `resedit` 1.7.0→1.7.2, and `ws`
8.21.1→8.21.3. Several nested `es-abstract` placements also differ. The
ignored local lockfile must therefore not be committed as if it were neutral
baseline evidence; lockfile selection is a separate change.

A second detached checkout using the ignored local lock completed `npm ci`
successfully (615 packages added, 616 audited). Before compile it reproduced the
same typecheck pass, 45/46 tracked-test result, GUI `main.js` failure, and
incomplete-but-successful CLI package. After compile it reproduced 61/61 and
successful CLI/GUI packaging. The lock is installable, but selecting it would
still select the older/differently placed dependency graph described above.

## Local-only regression assets

| File | SHA-256 |
|---|---|
| `smoke-cli.js` | `0D186F619AA9E339E33AE74C8295784D2FA72345937E8246BB073C531AAE33EA` |
| `smoke-gui-adapter.js` | `6DA738FBD367AFFD5FEF57D4E14F314A4496EB93AB8DF95BC747ADD665E4C944` |
| `smoke-rpg.js` | `9C42824D00C6ADD253FDE86ACD15C14CF6BFBA27261B25E552E37C86993B9614` |
| `smoke-wolf.js` | `3ED09AEFA3A41BB8FDC52DDD3C5F6AA112C425F5FE0BBE223C6487E61FB272DE` |
| `v25-compat.test.js` | `AF944F1592291514616E2BD860085EE06DA7515E35A78BC94BCD6D776FBBC6BA` |
| `v25-tyrano.test.js` | `9C98032C504A6634D61E1002618D5D0F1486A4B515A836C7E2D7995273FE6F17` |

No reachable Git history contains these paths. Two unreachable historical
commits were inspected and also did not contain them. Their future recovery or
integration belongs to the test-inventory phase, not this baseline change.

## Contract snapshots

`test/contracts/baseline/` records:

- schema-v1 and schema-v2 successful `verify` results for the same disposable
  extracted RPG fixture;
- one schema-v2 missing-path failure;
- the current manifest schema (version 1) with representative real entries;
- normalization and exit-code rules.

The successful fixture had 4 source files and 43 valid entries. Both request
schema versions exited 0 and produced the same normalized result. The
missing-path request exited 1. All three verify captures wrote exactly one JSON
object to stdout and no stderr output.

## External executable inventory

The files below were hashed without execution.

| Path | Bytes | SHA-256 | Local license |
|---|---:|---|---|
| `exfiles/eztrans/EztransServer.exe` | 625,083 | `9E14106EC3486A711C58380706A167D39FAD394DA571C77C4254588D4C6DD40D` | MIT, nanikit/community |
| `exfiles/eztrans/EztransServer2.exe` | 1,441,698 | `39441DA82F2A5548B206E47B8542606CB6CB0C90749FA58C945DCAA5D937DD2C` | MIT, nanikit/community |
| `exfiles/transEngine/translate_engine.exe` | 6,460,480 | `D7778652664952ACAE41B77F40E35E7B2FB950C1639EBB2D881C3B3DFA3A51AE` | MIT, gramedcart |

The two adjacent license files exist, but `NOTICE.md` and
`THIRD-PARTY-NOTICES` do not name these executable bundles. Packaging includes
`exfiles/**`; notice consolidation remains a later licensing task.

## First change boundary

This baseline change intentionally includes only evidence documents, normalized
contract snapshots, and the narrow `.gitignore` exception needed to track those
snapshots. It excludes:

- either lockfile;
- version/package/repository changes;
- build-script changes;
- CI;
- recovery of all six local-only tests;
- dependency updates;
- production code changes.

Recommended next changes are separated as: lockfile-only → build-chain →
version/identity → minimal CI. This keeps dependency selection, package
correctness, public versioning, and automation independently reviewable.
