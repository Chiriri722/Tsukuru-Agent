# Local verification guide

In tsukuru-agent run npm run compile, then
node --test test/integration/rpg-review.test.js.

For an already extracted RPG workspace add this to a v2 verify request's options:

```json
{"review":{"reportPath":"C:/review-output/new-review.json","limit":100,
 "preview":{"sourceLanguage":"ja","targetLanguage":"ko"}}}
```

Copy [the complete request example](../../tsukuru-agent/src/core/contracts/examples/request-v2-review.json)
to request.json and edit its workspace and report paths. Choose a fresh destination
outside the game/workspace, then execute:

```powershell
node .build/app/src/cli/main.js run --request request.json
```

Inspect the private local artifact's entries, groups and preview.
No provider credentials are required. Page with offset or choose exact entryIds.
Unknown IDs, stale hashes and existing reports must fail without input changes.

Final gates, sequentially: npm run verify, npm run test:order,
npm run benchmark:check. Never run concurrent jobs against the shared .build.
