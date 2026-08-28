# External binary replacement procedure

Bundled and on-demand executables are catalogued in `src/core/supplyChain/external-binaries.json`. They are GUI translation/decryption helpers and are not included in the headless CLI package.

For any replacement:

1. Obtain the artifact from the catalogued upstream release over HTTPS and retain its release/tag URL.
2. Record upstream version, byte size, SHA-256, license identifier/text path, purpose, and every call site.
3. Review upstream source/release notes and scan the artifact with the project’s approved malware process outside CI.
4. Replace only the exact inventory path, update its pinned size/hash, and add or update a deterministic fixture test.
5. Verify execution uses a fixed resolved path, argument arrays, `shell: false`, hidden windows, a bounded startup/operation timeout, and process-tree cleanup.
6. Run `npm ci`, `npm run verify`, GUI translation smoke, and package-content verification. Confirm the CLI archive contains no `exfiles/` entry.
7. Have a maintainer other than the replacer review the provenance and hash change before release.

CI verifies hashes and call-site policy but never executes the bundled programs. WolfDec is not bundled: the user-approved download is accepted only when the pinned v0.3 byte size and SHA-256 match.
