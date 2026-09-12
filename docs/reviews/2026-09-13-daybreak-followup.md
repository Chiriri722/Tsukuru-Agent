# Daybreak 도구 개선 제안 대조 — 2026-09-13

## 판단과 검토 기준

제안 7개 중 번역 lint·메시지 연속성·적용 후 검증은 신규 작업이고,
해시 충돌·오류 진단·AppleDouble 처리는 기존 구현의 보완이다.
회귀 fixture 제안은 각 수정의 선행 실패 테스트로 분배한다.

보고서는 일반 경로의 main을 사용했다. main의 Backup JSON/기록 실패 무시 문제는
확인되지만, 통합 작업트리는 이미 해당 오류를 차단한다. 또한 일반 RPG 사전 적용에서
뒤늦은 apply 실패가 앞서 저장한 patch를 되돌리지 않는 경로를 이번에 재현했다.
따라서 추가 검사보다 먼저 해당 transaction 경계를 확정해야 한다.

- 입력: 사용자가 지정한 `i-indivisual-tsukuru-extract-rpg-maker/outputs/verification-report.md`.
  상위 폴더 날짜는 2026-09-12, 보고서의 검사일은 **2026-09-13**이다.
- 입력 SHA-256: `ffa925d0256510b76a71846272c2c85eb127c4070e0b9786bc3698a33c4294cb`.
- 보고서 실행 경로의 main: `8c7d77332eb8567d082844dc306a6d1d2a1d9969`.
- 후속 구현 기준: `chore/hardening-integration@80d2043c67ac8bd9a0a4a466107777ef07489d0a`
  + 2026-09-08의 미커밋 patch-mapping 수정.
- 아래 코드 경로·줄 번호는 **통합 작업트리** 기준이며 저장소 루트 상대 경로다.
  main에 같은 파일명이 있어도 동일 구현으로 해석하지 않는다.
- 이번 범위: 보고서 읽기, 코드 대조, 합성 재현, 계획 갱신. 실제 게임·번역 팩은
  재검사하거나 변경하지 않았고 보고서의 게임별 수치·언어 감수 판정을 재인증하지 않았다.

## 제안별 대조

| 원 제안 | 현재 증거 | 검증 판단 / 필요한 작업 |
| --- | --- | --- |
| 1. patch/apply 전 translation-lint | `src/core/translationDictionary.ts:45`는 키/형식·skip 조건, `src/cli/patcher.ts:158` 이후는 매핑/해시를 검사한다. 제어코드 변경·이중 escape·빈 direct patch·U+FFFD·가나 잔존이 patch와 apply를 통과했다. | 신규 P0. Backup의 원문과 동일 ID를 연결해 명령/인수·자리표시자·새로운 손상 문자를 검사한다. 언어 잔존과 의미 정확도를 별도 상태로 보고한다. |
| 2. 101/401 단위 괄호 연속성 | 실제 Map 이벤트를 101 + 401 두 개로 만든 합성 fixture에서 여는 괄호 1개/닫는 괄호 2개가 저장·재삽입됐다. | 신규 P1. 한 줄씩 닫힘을 강제하지 않고 map/event/page 또는 common-event의 메시지 블록을 복원한다. 의도한 따옴표 스타일 변환은 정책으로 구분한다. |
| 3. 모든 해시 충돌 집계 | `translationDictionary.ts:125–132`는 현재값 비교 뒤 patch를 만든다. `patcher.ts:169–171`는 첫 해시 불일치에서 throw한다. 충돌 2개 중 첫 ID만 반환됐지만, 이 오류 자체에서는 전체 작업본 바이트가 보존됐다. | 부분 구현. 이미 있는 사전 중단을 유지하면서 모든 선택 항목의 충돌 수·파일·ID를 집계한다. 결과 크기 상한/생략 수를 둔다. |
| 4. Backup 파싱/setObj 실패 치명화 | main `RpgMakerService.ts:269–270,319–325`는 빈 catch/경고 후 계속한다. 통합 `applyPlan.ts:140–152`의 parseBackup과 `392–418`의 setRpgDataPath는 치명 오류다. 실제 malformed JSON/없는 필드/비문자 대상 모두 차단·바이트 보존. | 차단 로직은 이미 해결. 누락 필드 오류에 dataPath만 있고 origin 파일/ID가 없는 진단을 보완한다. 해석 못 한 파일에 가짜 ID를 만들지 않는다. |
| 5. RPG apply 뒤 구조 검사 | `operations/apply.ts:766–799`의 applyLooseRpg는 서비스 실행 후 artifacts/stats만 반환한다. `RpgMakerService.ts:553–600`은 출력 transaction commit 전 inspectRpgProject를 부르지 않는다. CLI apply 성공 결과에도 validation이 없었다. | 신규 P0. Completed가 변경분만 담는 출력임을 고려해 **Backup + staged Completed**의 논리적 병합본을 검사하고, 성공 공개 전에 차단한다. 원본부터 있던 참조 결함은 기존 baseline 정책을 유지한다. |
| 6. 제어코드/ID 이동/빈 값 fixture | 기존 patch-mapping 회귀는 좌표/해시/별칭을 지킨다. 올바른 ID와 hash를 사용해 한국어 두 문장을 의도적으로 뒤바꿔도 성공했다. | 각 구현의 선행 RED로 추가. 일본어 0건이나 토큰 일치로 의미/ID 정렬이 증명된다고 주장하지 않는다. 화자·문맥·원문 provenance 신호가 없는 의미 이동은 수동 검토 대상으로 남긴다. |
| 7. 모든 재귀 수집의 `._*` 제외 | `translationDictionary.ts:65–68`은 이미 제외한다. `validation/engines/rpg.ts:42–78`은 포함하여 `._Actors.json`에 RPG_JSON_PARSE_ERROR를 냈다. `RpgMakerService.ts:418,436`의 YAML/JSON 후보 수집에도 같은 제외가 없다. | 부분 구현 P1. 파싱/번역 후보 수집 정책을 공통화한다. archive 원본 목록·hash/provenance·자원 한도에서 파일을 무조건 제거하는 변경은 피한다. |

표의 `src/`는 모두 `tsukuru-agent/src/`를 줄여 쓴 것이다.
그래프의 호출 경로와 실제 TypeScript를 함께 읽었다. graph text search가 충분한
결과를 반환하지 않은 테스트·일부 문자열은 범위를 좁힌 파일 검색으로 보완했다.

## 추가로 확인한 transaction 요구

`applyLooseRpg`는 먼저 `applyRpgTranslationDirectory`(`operations/apply.ts:160–175`)를
호출하여 Extract/manifest/.extracteddata를 저장하고, 그 뒤 서비스의 Backup 검사를 실행한다.

유효한 사전 + 손상된 Backup을 넣은 합성 CLI 요청은 `E_MAPPING_CORRUPT`로 실패하고
Completed는 만들지 않았지만 **Extract/Actors.txt와 Extract/manifest.json 변경은 남았다**.
이는 “해시 충돌 시 쓰기 없음”과 다른 실패 경로다.
새 lint/post-validation을 이미 저장한 patch 뒤에 덧붙이면 같은 문제가 반복된다.

첫 구현 단위는 기존 container staging/WorkspaceTransaction 패턴을 참고하여
일반 RPG의 사전 patch → 재삽입 → 최종 검증을 한 작업으로 묶는 것이다.
실패 시 기존 Extract/manifest/.extracteddata/Completed를 모두 복원하고 원본·Backup을 보존한다.
유효한 사전 적용의 기존 성공 결과는 유지해야 한다.

## 권장 구현 순서와 완료 기준

1. **D21-01 / P0 — 작업 전체 rollback.** 위 후속 실패 재현을 추적 회귀로 먼저 추가한다.
   기존 출력 존재/없음, 검증 실패·rename 실패·취소, 사전 있음/없음을 포함한다.
2. **D21-02 / P0 — 공유 번역 lint와 출처 연결.** 원문 ID/dataPath 및 Backup 기준을
   확정하고 patch·사전·수동 편집 Extract→apply에 같은 검사를 적용한다.
   제어코드는 escape 수준, 이름, 인수와 필요한 순서를 보존한다. 알 수 없는
   플러그인 코드를 임의 변환/삭제하지 않는다. source가 이미 가진 빈 값/문자와 새 손상을
   구분하고, 빈 사전 skip과 의도한 빈 번역의 기존 계약을 명시적으로 다룬다.
3. **D21-03 / P0 — 적용 결과의 사전 공개 검증.** 단계 1의 staging에서 병합본
   inspectRpgProject + 적용된 실제 값/dataPath·허용 외 변경 비교를 수행한다.
   inspectRpgProject 한 번으로 번역 품질까지 증명되지는 않는다. 원본 참조 warning은
   유지하고 새 구조/보호 영역 손상은 commit 전에 실패시킨다. partial output, portable pack,
   무변경 apply, JSON/YAML/plugin/외부 메시지 옵션의 지원 범위를 명시한다.
4. **D21-04 / P1 — 사전 preflight 집계.** 첫 충돌만 반환하는 정책을 전체 진단으로 보완한다.
   선택된 patch hash 검증과 unknown/blank/comment/unchanged skip 통계를 구별한다.
   사전 순서와 파일 순서에 무관한 결과, bounded 상세 목록/전체 수, 충돌 시 무변경을 검증한다.
5. **D21-05 / P1 — 대화 블록·언어 잔존.** 101/401의 경계와 indent/page를 지키고,
   분절·여러 줄·서로 다른 이벤트 사이에 괄호 상태를 흘리지 않는다.
   크레딧·고유명사·의도한 원문 보존 및 따옴표 변환을 근거 있는 예외 목록으로 관리한다.
   한국어 존재율/가나 잔존율을 번역 완료율로 부르지 않는다.
6. **D21-06 / P1 — AppleDouble 후보 제외 일관화.** 입력 열거 지점을 점검하고
   JSON/JS/YAML/사전 parser의 sidecar 오탐을 막는다. 원본 파일·archive byte 목록·
   복사 정책·resource accounting은 각 계약을 유지하고 별도로 테스트한다.
7. **D21-07 / P2 — 오류 문맥 보완.** parseBackup/setRpgDataPath의 기존 차단을 유지하고
   알 수 있는 origin 파일, bucket, entry ID, dataPath를 구조화 오류에 추가한다.
   개인 절대 경로나 게임 전문을 오류 요약에 복사하지 않는다.
8. **D21-08 — 각 변경의 회귀와 통합 수락.** 원 제안 6의 fixture를 단계별 RED/GREEN에
   배치한다. 제어코드가 같고 일본어가 없는데 의미만 뒤바뀐 정상 구조 fixture는
   “자동 판별의 한계”를 보여주는 대조군으로 유지한다. 언어/품질 검토 상태는
   pass·fail·needs-review·not-run을 구분한다.

실제 구현 전 위 작업을 공식 `speckit-specify` → `speckit-plan` → `speckit-tasks`로
별도 feature에 구체화한다. 이번에는 기존 002 명세를 덮어쓰거나 구현 완료로 표시하지 않았다.
새 CLI operation이나 SDK를 바로 추가하는 것이 필수는 아니며, 공유 검사 모듈과 기존
요청/결과 계약에서 시작할 수 있다. 외부 계약을 바꾸면 v1/v2 schema·타입·문서·회귀를 함께 갱신한다.

## 이번 검증과 한계

- 환경: Windows, Node 24.14.0, npm 11.19.1.
- 최신 TypeScript의 `node node_modules/typescript/bin/tsc -p tsconfig.build.json`: 통과.
- 합성 조사 스크립트: **15개 사례의 현재 동작을 확인**했다. 위험 입력의 성공도
  재현 결과이므로 “15개 보안 회귀 통과”로 해석하지 않는다.
- 기존 관련 회귀: `node --test --test-concurrency=1 test/integration/rpg-smoke.test.js
  test/integration/translation-dictionary.test.js test/integration/manifest-recovery.test.js
  test/integration/patch-mappings.test.js` — **65/65 통과**, skip 0.
- 원문 로그·재현 스크립트·구현 파일 SHA-256은 통합 앱의 ignored
  `tmp/daybreak-review-2026-09-13/`에 있다. 재현용 fixture는 전용 임시 폴더에
  생성했고 실행 후 제거했다.
- 초기 probe의 fixture 위치 한 단계 오류를 수정한 후 재실행했다. 제품 코드와
  외부 게임에는 쓰지 않았다.
- 이번에 전체 verify/order/benchmark, GUI, 패키지, 실게임 실행, 외부 서비스 조회를
  다시 수행하지 않았다. 2026-09-08의 403/403 기록은 과거 기준선이다.
- 후속 구현 완료 시 CONTRIBUTING의 verify/order/benchmark와 영향받은
  GUI/패키지·크로스플랫폼 gate를 적용한다. 승인된 전체 게임 복사본에서 실제
  대화·맵·저장/로드를 확인하기 전 배포 합격을 선언하지 않는다.
