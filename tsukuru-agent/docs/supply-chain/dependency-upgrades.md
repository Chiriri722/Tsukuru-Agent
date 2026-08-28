# Dependency upgrade policy

Dependabot may propose npm updates weekly. Runtime/library patches and minors can be grouped when the full verify and package smoke stay green. Electron and electron-builder are excluded from automatic major upgrades: each major step is a separate manually approved change.

Every Electron/builder step must record before/after package contents and rerun GUI launch, sandbox preload and bidirectional IPC, CLI stdio, ASAR/NW.js inspect/extract/repack, Electron fuse/embedded ASAR inspection, Authenticode diagnostics, and launch-probe process-tree cleanup. Skipping a major version is not allowed without a dedicated compatibility rationale.

Dependency removal is based on declared imports/call sites, not package-name intuition. `docs/supply-chain/dependencies.json` is the direct runtime inventory; `check:supply-chain` compares it with `package.json`, exact lockfile resolutions, source call sites, notices, external binaries, and vendored assets.
