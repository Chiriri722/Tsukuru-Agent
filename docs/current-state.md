# 작업 재개 안내 — 2026-09-13

D21 P0–P2 구현과 독립 후보 리뷰를 마쳤으며 최종 필수 검증·브랜치 통합을 진행 중이다.
현재 기준은 [003 명세](../specs/003-translation-validation/spec.md), [Task Plan](../task_plan.md),
[검증 기록](../specs/003-translation-validation/verification.md)이다.

- 저장소는 한 단계로 정리된 `GitHub/Tsukuru Agent`이다.
- 구현 커밋: workflow `34e876e`, RPG 개선 `2118186`, main 문서 병합 `ecaf782`.
- 이전 세 작업 브랜치는 원래 변경을 `archive/2026-09-13-hardening-*` 태그에 보존했다.
- 집중 회귀 41개 통과. 전체 verify/order/benchmark/Electron/package 결과는 검증 기록에 갱신한다.
- 실제 작업본 14개, manifest 522,620개 항목을 검사했다. 8개 통과, 6개 오류 검출이며
  모든 원본/복사본 해시는 유지됐다. 의미 감수와 실제 게임 플레이는 실행하지 않았다.

## 유지보수 연결

Spec-kit 1.0.4, Codex Security 조사·후보 리뷰, Linear DAV-38~41 및 DAV-84,
Sentry의 승인된 읽기 전용 조회를 사용한다. [개발 흐름](development-workflow.md)과
[연결 정보](maintenance-integrations.json)를 따르며 토큰·게임 텍스트는 Git에 넣지 않는다.

## 후속 판단과 이전 기록

실패한 작업팩은 ID 정렬과 번역 내용을 사람이 확인해야 한다. `recover`는 해시 재구축이며
의미 복구가 아니다. 대표 gameplay·GUI feel-check, 실제 directory-form package.nw,
hosted CI, 서명·게시 조건은 [릴리스 체크리스트](release-checklist.md)에서 별도로 관리한다.
[2026-09-08 작업공간 기록](reviews/2026-09-08-workspace-state.md)과
[당시 코드 리뷰](reviews/2026-09-08.md)의 미병합·미구현 설명은 당시 상태를 뜻한다.
