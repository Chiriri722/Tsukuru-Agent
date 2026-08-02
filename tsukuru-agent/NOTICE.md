# NOTICE — Tsukuru agent (Tsukuru Extractor Headless CLI 개조)

## 원저작물 / Original Work

- **Tsukuru Extractor (mvextractor)** 2.3.0
- Upstream: https://github.com/gramedcart/tsukuru_extractor (원 저장소: https://github.com/gramedcart/mvextractor)
- Original author: Sziya
- License: **GNU General Public License v3.0** (저장소 루트의 `LICENSE` 전문 참조)

이 프로젝트는 위 원저작물의 수정본(modified version)이며, GPLv3 조건에 따라
동일한 라이선스로 배포된다. 기존 `package.json`의 `"license": "MIT"` 표기는
저장소의 `LICENSE`(GPLv3)와 불일치했으므로 GPLv3로 정정했다.

## 수정 사실 및 변경일 / Notices of Modification

- **변경일**: 2026-08-02
- **수정자**: Tsukuru agent 작업(계획서: "Tsukuru Extractor Headless CLI 개조 계획")
- **주요 수정 내용**:
  1. RPG MV/MZ 추출·적용 로직을 UI 비의존 `RpgMakerService`로 분리 (`src/js/rpgmv/RpgMakerService.ts`)
  2. Wolf 추출·적용 로직을 UI 비의존 `WolfService`로 분리 (`src/js/wolf/WolfService.ts`)
  3. 전역 상태를 작업 Context(`src/core/context.ts`)로 이관, 진행률·로그·오류를 `ProgressSink`/`Logger`/`OperationError`로 추상화 (`src/core/types.ts`)
  4. Headless CLI 추가: `tsukuru-agent run --request <file|->` (`src/cli/`), verify/extract/patch/apply 작업
  5. `Extract/manifest.json` 및 `Extract/_Extract` 매니페스트·SHA-256 검증·원자적 쓰기 추가 (`src/core/manifest*.ts`, `src/core/atomic.ts`)
  6. 기존 GUI는 동일 서비스 계층을 호출하는 adapter로 재배선 (`src/electron/guiContext.ts`, `main.ts`, `apply.ts`, `src/js/wolf/main.ts`)
  7. 알려진 원본 결함 정정: `apply`의 `.Completed` 오타 로직, wolf apply의 msgpack Buffer/Uint8Array 문제(세부 내용은 작업 문서 notes.md 참조)

## 소스 제공 / Source Availability

수정본 전체 소스는 이 저장소(작업용 복사본 `work/tsukuru-agent`)에서 제공한다.
원본 2.3.0 소스는 `tsukuru_extractor-2.3.0 source/`에 보존되어 있다.

## 의존성 고지 / Third-Party Dependencies

런타임 의존성은 `package.json`의 `dependencies`를 참조한다. 각 라이브러리의
라이선스는 배포 시 `node_modules` 내 각 패키지의 LICENSE 파일을 따른다.
(headless exe 배포 구성 시 THIRD-PARTY-NOTICES 생성으로 정리 예정 — Phase 11)
