# Diagnostics contract
기존 schemaVersion 및 patch/apply 요청 동작을 유지한다.
- E_PATCH_HASH_MISMATCH의 details.id를 유지하고 totalConflicts/conflicts[{id,file}]/omittedCount를 추가한다.
- 번역 손상은 구조화된 오류와 상대 file/entryId/code를 제공한다. 새로운 필드/오류는 canonical schema/types/examples/tests에 동기화한다.
- validation은 구조 결과이며 언어·문맥·의미 판단을 그 ok 값으로 재사용하지 않는다.
- 품질 진단은 명시적 pass/fail/not-run/needs-review 및 예외 근거로 표시한다.
- 빈 dictionary 값은 skip; 수동/직접 patch의 새 빈 번역은 차단; 원래 빈 값/원문 보존은 유지한다.
- GUI도 동일한 선행 차단을 적용한다. 기존 instantapply 요청은 검증된 산출물 설치로만 원본을 갱신한다.
