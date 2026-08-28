# Large workspace benchmark guide

Run `npm run benchmark` for the local baseline profile and `npm run benchmark:check` for the bounded CI profile. The harness creates deterministic synthetic RPG Maker, Wolf, Tyrano, GDevelop, ASAR, and NW.js fixtures under the OS temporary directory, runs each case in an isolated child process, prints one JSON report, and removes every owned fixture in `finally`.

Each case reports elapsed milliseconds, process peak RSS, source file count, source bytes, text-entry count, total temporary bytes, and fixture/hash/parse/pack stage timings. Timing and RSS ceilings are regression tripwires rather than cross-machine performance claims. File and byte counts are exact fixture-integrity contracts.

Before changing a ceiling, reproduce the old and new commit on the same machine at least three times, keep the median reports, explain the changed algorithm or fixture, and retain the stricter structural counts. Do not loosen a ceiling to hide an intermittent cleanup leak or archive expansion.

The 2.5.0 GDevelop CI fixture expects 733,548 bytes. The static code-literal diagnostic report added 32,000 deterministic bytes for 1,000 project-data entries; the existing 2,000 ms and 256 MiB ceilings were deliberately left unchanged.

Large real games remain in the private compatibility corpus. Record only approved hash-based fixture identity and redacted metrics; do not publish game paths or content. Stop before apply when free temporary space is insufficient, and verify cancellation leaves no staging, final output, or child process.

The Electron GUI routes RPG/Wolf extract/apply, bulk string replacement, and version translation port through a worker thread. Closing the GUI first signals shared-memory cancellation, waits for transaction and child-process cleanup, and only then permits application quit. See `io-boundaries.md` for the measured stream versus bounded-buffer decisions and the two residual legacy async paths.
