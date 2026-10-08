# Validation

From `tsukuru-agent`, use Node 22/24 and installed Windows Electron.

1. `npm run compile`
2. `node test/integration/launch-profile.test.js` — real paths/session writes, same-name canary, unsupported entries/integrity, exit/timeout/cancel/descendants.
3. `node test/integration/runtime.test.js` and `node test/e2e/agent-workflows.test.js` — adjacent behavior.
4. Sequentially: `npm run verify`, `npm run test:order`, `npm run benchmark:check`, `npm run test:electron`.
5. Sequentially: `npm run build:cli`, `npm run verify:package`; run the synthetic container apply through the packaged CLI to exercise the PowerShell asset inside ASAR.

Never run build gates concurrently; tests rebuild .build. Record actual results in verification.md. All fixtures are synthetic; private-game startup/save-load remains D22-06.
