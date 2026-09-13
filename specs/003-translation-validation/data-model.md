# Data model
- Translation candidate: originFile, dataPath, bucket, entryId (검증 가능한 경우), sourceText, translatedText.
- Diagnostic: code, severity, file, entryId; 전문/절대 개인 경로는 제외. 상세 상한 100개와 전체 수 유지.
- Quality status: mechanical pass/fail/not-run, language/context needs-review, semantics not-run.
- Artifact replacement: staged path, target path, previous target backup, installed flag.
  State: prepared → all validated → installed; failure/cancel → previous group restored.
- Output plan: immutable original JSON and allowed translation paths + expected values.
  Serialized output must parse and equal the expected whole object, preserving all other fields.
