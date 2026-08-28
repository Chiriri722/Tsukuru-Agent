# Electron network policy

The GUI does not load remote scripts into an application renderer. Every local
HTML page uses a CSP whose `script-src` is limited to `self`; the previous CDN
Popper script was removed. Browser windows deny popups and unapproved
navigation, and external links are opened by the main process only after an
HTTPS host allowlist check.

## Automatic update metadata

- Endpoint: `https://raw.githubusercontent.com/Chiriri722/Tsukuru-Agent/main/tsukuru-agent/version.json`
- Trigger: one metadata check after the main window finishes loading.
- Limits: JSON response, 5,000 ms timeout, no redirects, and a canonical
  numeric `major.minor.patch` version field.
- Failure: timeout and connection errors become the non-fatal `offline` state;
  malformed or non-200 responses become `invalid-response`. Neither state is
  shown as an update and neither exposes a raw error or local path.

The release and support buttons can open only HTTPS pages on `github.com`.
The legacy EzTrans runtime prompt may open the fixed HTTPS installer page on
`dotnet.microsoft.com`. Renderer input cannot supply another host, scheme, or
arbitrary URL.

## User-triggered network features

- WolfDec extension installation downloads the declared WolfDec release from
  `github.com` only after the user accepts the extension prompt. This legacy
  optional binary remains subject to the later supply-chain/hash policy phase.
- Papago machine translation opens `https://papago.naver.com` only after the
  user starts that translator. It runs in a dedicated hidden sandboxed window
  without Node integration, preload access, popups, or navigation to another
  host. Returned text is read by the main process and is not inserted as remote
  HTML into an application renderer.
- Legacy translation providers are contacted only when the user starts the
  corresponding translation operation; they are not part of startup.

Normal extraction, verification, patch, apply, recovery, settings, and local
navigation remain available offline. No renderer loads a remote script or
receives Node filesystem, process, or shell access.
