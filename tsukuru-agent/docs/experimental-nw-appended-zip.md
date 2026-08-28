# Experimental NW.js appended ZIP

NW.js documents a Windows packaging form created by concatenating `nw.exe` and
a ZIP application package. Tsukuru Agent diagnoses this layout without a flag,
but extract and container apply require
`options.experimentalNwAppendedZip: true`. The upstream packaging method is
described in the [NW.js package and distribute guide](https://docs.nwjs.io/en/nw20/For%20Users/Package%20and%20Distribute/).

The supported mutation subset is intentionally narrow. The detector requires:

- one top-level executable candidate containing a `package.json` ZIP entry;
- an `MZ` header, a bounded `PE\0\0` header, and PE32 or PE32+ optional-header
  metadata;
- one classic end-of-central-directory record whose entry count, central
  directory size, central entries, local-header offsets, and physical positions
  agree;
- the normal archive path, collision, link, file-count, expanded-byte, and
  per-file limits;
- no PE Attribute Certificate Table.

The PE Certificate Table data-directory address is a file offset rather than an
RVA, so its range can be checked without loading or executing the image. The
field layout follows the [Microsoft PE format reference](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format).
This is a static presence/bounds check, not a trust-chain or Authenticode
validity claim.

Provenance hashes the complete original executable. Repacking creates a ZIP in
transaction staging, copies only the exact source prefix through a bounded
buffer, appends the new ZIP, and re-parses the result. Publication is refused if
the prefix length or SHA-256 changes, the new ZIP is unreadable, or the source
whole-file hash changed after extraction. The source executable and wrapper are
never modified in place.

The following remain diagnostic-only or unsupported:

- a present or malformed certificate-table entry;
- multiple appended-ZIP executable candidates;
- non-PE prefixes, inconsistent central/local offsets, split archives, and
  ZIP64 sentinel layouts;
- packages requiring a bypass, signature removal, binary patch, or runtime
  execution to locate the payload;
- treating structural success as launch or gameplay success.

Machine-readable engine features distinguish `nwjs-appended-zip`, unsigned or
certificate-table state, ambiguity, and `nwjs-appended-zip-launch-unverified`.
Synthetic tests cover exact prefix preservation, source hash invariance,
translation round-trip, signed-input refusal, and ambiguous-input no-mutation.
