# Dependency audit policy

`npm ci` followed by `npm audit --omit=dev` is the release dependency audit. A release is blocked by any reachable high or critical production finding. Medium findings require an issue, owner, reachability note, and expiry date; low findings are recorded but do not block a patch release.

Machine-readable exceptions live in `audit-exceptions.json`. Every exception must contain the advisory ID, affected package, rationale, owner, issue URL, and an ISO `expires` date no more than 90 days in the future. `check:supply-chain` rejects an expired or incomplete exception. The current exception list is empty; after removal of the unused legacy dependency set, the local production audit reports zero findings.

npm 11 blocks unclassified dependency lifecycle scripts. Every lockfile package marked `hasInstallScript` must therefore have an explicit decision in the root `allowScripts` map, and `npm install-scripts ls --json` must report an empty pending list after a clean install. The current lockfile contains only `electron-winstaller@5.4.0`; its script is denied because Tsukuru Agent builds NSIS and portable targets, not the Squirrel target that owns this transitive peer. Its pinned lockfile version and the denial contract force a deliberate review if that dependency path changes.

Development-only Electron/builder findings are triaged separately because they do not execute inside the headless runtime, but high or critical build-tool findings still block a public release unless an unexpired exception documents the build-only reachability and mitigation.

The Electron executable is distributed in both GUI and packaged CLI archives even though npm classifies it as a development dependency. Consequently, `npm audit --omit=dev` is necessary but not sufficient for a binary release. The current full-audit status and mandatory one-major-at-a-time validation ladder are recorded in `electron-upgrade-status.md`; while that file declares a release blocker, CI artifacts are test evidence only and must not be published as a release.
