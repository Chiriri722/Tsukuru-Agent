# 작업 재개 안내 — 2026-10-02

현재 [006 작은 RPG 번역 작업팩](../specs/006-compact-rpg-extraction/spec.md)의 로컬 수락을 완료했다.
세 혼합 RPG 게임에서 7.69 / 15.07 / 3.46MB 작업팩을 만들고 원본 대조·재적용을 통과했다.
원본과 Live2D 등 무관한 자산은 보존됐다. verify/order 각각 457/457, 성능 6개,
실제 Electron·CLI 패키지와 패키지의 한글 경로 작업팩 흐름도 통과했다.
[006 검증](../specs/006-compact-rpg-extraction/verification.md)에 세부 근거와 추출 범위를 남겼다.
상세 상태는 [006 작업표](../specs/006-compact-rpg-extraction/tasks.md)와 [Task Plan](../task_plan.md)을 따른다.
기존 004·005 변경을 보존한 로컬 미커밋 작업이며 최신 로컬 CLI ZIP은 006까지 포함한다.
다음 순서는 D22-05 실패 작업팩 대조 → D22-06 실게임이다. 이번에는 게임을 실행하지 않았다.

## D22-04 수락 기록 (2026-09-30)

D22-04 프로필 격리의 구현과 로컬 검증을 완료했다. Windows 10+의 지원되는
Electron ASAR 작업본에서 실행 복사본·앱 경로·환경변수·세션을 임시 프로필로 돌리고,
자식 프로세스 종료와 정리를 확인해야 apply가 통과한다. [005 계약](../specs/005-launch-profile-isolation/contracts/launch-probe.md),
[검증 기록](../specs/005-launch-profile-isolation/verification.md), [작업표](../task_plan.md)를 따른다.
임의 native/절대 경로 쓰기를 막는 OS sandbox는 아니다. 이번 실게임 실행은 없으며
다음 범위는 D22-05 실패 작업팩 대조와 D22-06 저장/불러오기 검증이다.
verify/order 각각 449/449, 성능 6개, 실제 Electron 및 CLI 패키지 검증을 통과했다.
패키지 전체 흐름도 3회 연속 통과했다. 일회성 native 종료 이상은 재현되지 않았으며
원인 미확정 이력으로 검증 기록에 남겼다. 최신 로컬 CLI ZIP은 004·005를 모두 포함한다.

## D23 구현 기록 (2026-09-29)

D23 원문 문맥·용어집 미리보기를 독립 구현했다. 기준은 `main@fc0e9ea` 위
**미커밋 로컬 변경**이며, D22 소스 수정은 이미 이 기준 커밋에 포함되어 있다.
[004 도입 판단](../specs/004-review-preparation/research.md), [계약](../specs/004-review-preparation/contracts/review.md),
[검증 기록](../specs/004-review-preparation/verification.md)과 [작업표](../task_plan.md)를 따른다.
RPG v2 `verify.options.review`는 원문 이벤트 문맥·명시된 화자·현재 텍스트와
용어집 선택 결과를 별도 로컬 파일로 만든다. 외부 호출·자동 번역·게임 실행은 수행하지 않는다.
합성 15개 관련 검사와 실제 추가 샘플 19,465항목의 선택 대사 5개/문맥 2그룹 보고서,
작업본 파일 47개 해시 보존을 확인했다. verify/order 각각 440/440, 성능 6개를 통과했다.
당시 배포 ZIP은 이 기능을 포함하지 않았고 커밋·패키징·hosted CI는 수행하지 않았다.
2026-09-30의 최신 로컬 CLI 패키지는 위 D22-04 검증 기록을 따른다.

## D22 검증 기록 (2026-09-23)

[D22 보고서](reviews/2026-09-23-electron-corpus.md)와 [작업표](../task_plan.md)를 먼저 읽는다.
verify/order 각각 433/433과 benchmark 6개를 통과했고 신규 샘플 재포장·원본/AppData 보존을 확인했다.
변경 작업팩 5개는 통과, 신규 작업팩 1개는 실패했다. 내용 불변인 9개는 D21 결과를 유지한다.
당시 후속은 실행 프로브 사용자 프로필 격리와 실패 작업팩 01·11·14·16 대조였으며,
프로필 격리의 최신 결과는 위 005 기록을 따른다.
게임 실행·의미 감수는 미실행이다. 기존 세이브 폴더 삭제는 사용자의 정리이며 ZIP은 보존 기준이다.

## D21 통합 기록 (2026-09-13)

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
