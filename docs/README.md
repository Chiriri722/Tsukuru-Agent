# 내부 문서 안내

현재 상태는 [작업 재개 안내](current-state.md), 최신 우선 작업은 [D21 계획](../task_plan.md)과 [Daybreak 제안 검증](reviews/2026-09-13-daybreak-followup.md)부터 읽는다. [2026-09-08 코드 리뷰](reviews/2026-09-08.md)와 기존 계획서의 체크박스는 해당 시점과 브랜치의 기록이다.

## 읽는 순서

| 문서 | 용도 | 기준 |
|---|---|---|
| [Daybreak 후속 검증](reviews/2026-09-13-daybreak-followup.md) / [D21 계획](../task_plan.md) | 번역 품질·사전 적용 경계의 검증과 우선 작업 | 2026-09-13, 통합 코드 대조·합성 15개 사례 |
| [작업 재개 안내](current-state.md) | 경로, 브랜치, 검증 결과, 다음 작업 | 2026-09-13, D21 수락 상태 |
| [코드 리뷰](reviews/2026-09-08.md) | 우선순위, 재현 조건, 개선 방향 | main / hardening-integration 구분 |
| [루트 README](../README.md) | 현재 main의 실행 방법과 기능 | main 구현 |
| [개선 작업 계획서](../New-task-plan.md) | post-v2.5 목표와 완료 조건 | 장기 계획; 실제 통합 상태는 브랜치 대조 필요 |
| [기준선](baseline.md) | 추적 파일과 로컬 보강 환경의 차이 | 2026-08-19, 17fa6e7 |
| [진행 기록](../progress.md) / [조사 기록](../findings.md) | 당시 실행·재현·판단 이력 | 날짜별 기록 |
| [초기 개조 계획](../task_plan.md) / [코드 분석](../notes.md) | 원본 GUI에서 CLI로 분리한 배경 | 역사 기록 |
| [v2.5 계획](../v2.5-validation-compatibility-plan.md) / [릴리스 노트](../v2.5-release-notes.md) | 컨테이너·엔진 확장의 배경 | v2.5 당시 상태 |
| [GUI 계획](../specs/001-gui-design-hardening/tasks.md) | main GUI 결함과 T001–T035 | main 기준 계획; 통합 브랜치에 후속 구현 존재 |

## 구현과 운영 문서

아래 문서는 통합된 구현의 기준이다. 오래된 브랜치 문서와 혼동하지 않는다.

- `docs/architecture.md`: CLI → 계약 검증 → 엔진 서비스 → transaction 흐름
- `docs/adr/0001-*.md` ~ `0003-*.md`: 버전, 계층 경계, JSON 계약·runtime 결정
- `docs/compatibility.md`: 엔진·컨테이너별 지원 범위와 실험 옵션
- `docs/reference/error-warning-codes.md`: 구조화 오류·경고
- `CONTRIBUTING.md`, `SECURITY.md`, `docs/maintenance-policy.md`: 개발·보안·호환 정책
- `docs/release-checklist.md`: 패키징·실게임·서명·게시 검증
- `tsukuru-agent/docs/`: 성능, 공급망, IPC 및 이행 관련 세부 근거

문서를 갱신할 때에는 브랜치·커밋·검증 날짜를 함께 적고, 과거 측정값을 현재 실행 결과로 바꾸지 않는다. 현재 상태는 `docs/current-state.md`, 상세 실행 이력은 `progress.md`에 기록한다.
