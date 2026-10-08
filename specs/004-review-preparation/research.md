# Research and adoption decisions — 2026-09-29

Baseline: `main@fc0e9ea`. User input `Pro 답변.txt` remains unchanged/untracked.
It is static analysis, not an executed comparison. Only public READMEs were
consulted; no foreign implementation source was opened, copied or installed.

| Proposal | Decision and reason |
|---|---|
| Context/review workflow | Adopt original event/page/indent and stable IDs; edited adjacency is unreliable. |
| Glossary/request inspection | Adopt bounded offline preparation before provider integration. |
| Proposal state/retry/import | Defer for a separate approved-result contract. Preserved source is not translation success. |
| Message/map renderer | Defer until font/plugin fidelity is scoped; runtime preview depends on D22-04 profile isolation. |
| Legacy engine diagnostics | Defer until legacy fixtures and stage-specific diagnostics exist; archive extraction is not translation. |
| New asset decrypter dependency | Reject duplication: Tsukuru already decrypts and encrypts MV/MZ assets. |
| Entire foreign GUI/configuration | Reject transplant; retain existing services and transactional patch/apply. |

Public feature evidence: [YSB README](https://github.com/amule949/YSB-Game-Editor)
describes contextual editing/translation workflows.
[RPGMakerDecrypter README](https://github.com/uuksu/RPGMakerDecrypter)
describes legacy archives, MV/MZ assets and project reconstruction.
The report's alleged foreign code defects were not independently reproduced and
are not findings in this work. Independent implementation is not a legal certification.

Decision: additive v2 verify option. Existing verification already validates the
manifest and loads the RPG plan. A delegated read-only Spec-kit research task
confirmed this surface, the v1 permissive-options pitfall, and path-only diagnostic
redaction. A config-file alternative requires another loader; bounded inline
configuration is instead omitted wholesale from ordinary diagnostics.

Decision: share original message traversal with lint; use explicit header speaker
evidence only. Dynamic names/faces remain unknown. Extraction-only comments are
explicitly unsupported for translation preview. No endpoint/API-key fields.

Decision: source/current hashes and workspace/context/glossary fingerprints.
These bind content, not authenticity or semantic quality. Patch permission still
requires the existing expectedHash/lint workflow.

Decision: guarded no-clobber publication. Existing target means conflict.
Check cancellation before writing and remove newly published output on later abort.
