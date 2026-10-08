# Data model

- **Review options**: reportPath, optional unique entryIds OR offset/limit, optional preview.
  Selection retains manifest order.
- **Preview options**: explicit sourceLanguage/targetLanguage, optional versioned
  glossary and maxTerms. Credentials and endpoints are not accepted.
- **Glossary entry**: exact case-sensitive term, translation, priority
  user > manual > derived. Conflicting definitions at equal priority fail.
  Match occurrences longest first; an independently occurring shorter term remains.
- **Review artifact v1**: kind, schemaVersion, workspace fingerprint, counts,
  entries, groups, optional offline preview and glossary digest.
- **Entry**: existing ID, sourceFile/dataPath/category, original/current text,
  source/current hash, source-preserved/changed state, context reference and
  command location. Extraction-only rows are unsupported and excluded from preview.
- **Group**: source file/list/header identity, original lines with omission count,
  digest and speaker status/basis. Missing/dynamic speakers are unknown.

Indices are zero-based source array indices, not claimed database IDs. SHA-256
fingerprints exclude output paths/timestamps. No approval or translation-success state.
