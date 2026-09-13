# Research decisions

## 적용 transaction
Decision: 사전 적용은 독립 작업 staging에서 수행하고 작업본·매핑·출력을 마지막에 함께 설치한다.
Rationale: 현재 applyLooseRpg는 applyPatches를 먼저 commit해 후속 오류가 작업본에 남는다.
Alternatives: 오류 뒤 원래 파일을 재기록하는 방식은 중간 상태 노출 및 취소 복구가 취약하다.
각 대상 볼륨 안에 staging을 두고 기존 artifact 교체 도우미의 rollback을 재사용한다.

## 원문 결합과 호환성
Decision: manifest의 현재 hash를 원문으로 보지 않고 Backup의 origin/dataPath를 사용한다.
Rationale: patch/recover는 hash를 갱신하고 GUI 수동 편집은 hash를 갱신하지 않는다.
Alternatives: 현재 hash만으로 번역 품질을 증명하면 손상이나 의미 이동을 놓친다.
manifest 없는 GUI도 .extracteddata와 Backup으로 검사한다. 최소 v1 patch 작업은 원문 검사 범위를 명시한다.

## 제어코드와 감수
Decision: 공통 순수 토큰 비교와 새 빈 값/U+FFFD 검사를 차단 기준으로 삼는다.
Rationale: plugin 명령 이름/인수와 escape 개수를 보존해야 한다. 원문 자체 결함은 그대로 유지 가능하다.
괄호/일본어는 event/page/indent/101-401 블록 문맥과 함께 감수 진단으로 구분한다.
Alternatives: 일본어만 제거되면 성공 또는 모든 일본어/따옴표 변경 차단은 모두 잘못된 품질 판정이다.

## 최종 출력
Decision: Backup을 기준으로 staged JSON/YAML/plugin/CSV를 다시 읽어 실제 계획값과 비교하고 구조 검사한다.
Rationale: Completed는 부분 출력이므로 그 폴더만 검사하면 누락 참조와 실제 적용값을 확인할 수 없다.
GUI instantapply도 검증된 staging 산출물만 설치한다. 기존 출력 형식/옵션을 유지한다.

## 실제 검증과 통합
Decision: 안내서의 현재 위치/작품 식별자를 확인한 뒤 private 복사본에서 현재 빌드 내부 검증기를 실행한다.
Rationale: 이전 스크립트에는 중복 repo 경로와 이동 전 입력/출력 경로가 있고 재생성 동작도 있다.
main 5884d62의 변경은 문서이며 기존 dirty worktree를 대조·보존한 뒤 정리한다.
