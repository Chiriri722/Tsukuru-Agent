# Local review contract

v2 verify, extracted RPG MV/MZ only. options.review has required reportPath plus:
- entryIds: 1–500 distinct existing IDs, mutually exclusive with offset/limit.
- offset: nonnegative integer; limit: 1–500, default 100.
- preview: explicit sourceLanguage/targetLanguage (1–35 chars), optional glossary
  {version, entries:[{term,translation,priority}]} and maxTerms (0–64, default 32).
  At most 2,000 glossary definitions, term/translation bounded at 256/1,024 chars.

No unknown properties; labels/terms must be nonblank. V1 remains readable but
never activates review. Other operations/formats reject it; raw archives require
extraction first.

Output has a separate review:1 schema. Stdout contains existing verify results,
artifact path and counts only. Ordinary diagnostics omit review configuration.
Bounds: 500 rows, 50 original lines per group, 64 glossary terms, 16 MiB artifact.
Omissions are explicit. Preview uses only emitted source/context.

Manifest hashes and Backup mappings must validate before publication. Mechanical
lint failure can still produce a report while verify remains failed. Exact source
equality is source-preserved, never translation success. Preview is offline and
unapproved; regenerate after edits and use existing patch/apply.

Report target must be outside project/data/output roots, with no links/junctions,
no diagnostic-path collision, and no existing file. Exclusive atomic publication
and cancellation preserve inputs and earlier reports.
