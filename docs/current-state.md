# 작업 재개 안내 — 2026-09-13

D21 P0–P2 구현·독립 리뷰·필수 검증을 마치고 `main`에 통합했다.
[Task Plan](../task_plan.md), [003 작업표](../specs/003-translation-validation/tasks.md),
[검증 기록](../specs/003-translation-validation/verification.md)을 현재 기준으로 사용한다.

- 기본 경로: `GitHub/Tsukuru Agent`. 수락 기록까지 통합한 커밋은 `ae3e497`이다.
- workflow `34e876e`, RPG 개선 `2118186`, 문서 병합 `ecaf782`,
  계약/fixture 정합성 `251d41c`·`dfba1bf`를 포함한다.
- 기본 폴더에서 lockfile 기반 새 설치 후 일반·고정 순서 테스트 각각 433/433,
  성능 6개, Electron·CLI 패키지 검증을 통과했다. Spec-kit 경로 검사도 통과했다.
- 실제 작업팩 14개(522,620항목)는 8개 통과·6개 오류 검출이다. 최종 영향 사례
  3개 재검증도 같은 판정과 원본/복사본 해시 보존을 확인했다.
- 이전 작업의 원본 커밋은 `archive/2026-09-13-hardening-*` 태그에,
  로컬 파일·로그는 무시되는 `tmp/d21-branch-archive`와 `tmp/d21-integration-evidence`에 보관했다.
- 현재 CLI ZIP은 `tsukuru-agent/dist-cli`에 있다. 의미 감수·실게임은 미실행이다.

## 유지보수 연결과 후속 범위

Spec-kit 1.0.4, Codex Security 조사·후보 리뷰, Linear DAV-38~41 및 DAV-84,
Sentry 읽기 전용 조회는 [개발 흐름](development-workflow.md)을 따른다.
실패 작업팩의 원문 대조·ID 정렬·언어/의미 감수는 별도 후속 작업이다.
`recover`의 해시 재구축은 의미 복구의 증거가 아니다.
대표 gameplay·GUI feel-check, 실제 directory-form package.nw, hosted CI,
서명·게시 조건은 [릴리스 체크리스트](release-checklist.md)에 별도로 남아 있다.
[9월 8일 작업공간 기록](reviews/2026-09-08-workspace-state.md)과
[당시 코드 리뷰](reviews/2026-09-08.md)의 미병합·미구현 설명은 당시 상태를 뜻한다.
