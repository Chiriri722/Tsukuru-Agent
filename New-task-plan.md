---
plan_id: tsukuru-agent-post-v2.5-hardening
status: in_progress
current_phase: "2026-09-13 D21 P0–P2 구현, 최종 수락 검증 진행 중"
next_step: "독립 후보 리뷰와 전체 검증, 안내서 기반 실제 작업팩 검사 후 기존 브랜치를 보존·통합·정리한다."
repository: "Chiriri722/Tsukuru-Agent"
baseline_branch: "main"
baseline_commit: "17fa6e7108fca66eda5a436e19febc955c0acd9d"
baseline_commit_date: "2026-08-12"
target_path: "New-task-plan.md"
created_at: "2026-08-15"
last_updated: "2026-09-13"
---

# Tsukuru Agent 개선 작업 계획서

## 현재 후속 단계 — D21 (2026-09-13)

Daybreak의 도구 개선 제안 7개를 main과 통합 작업트리에 대조했다.
[검증 근거](docs/reviews/2026-09-13-daybreak-followup.md)와
[실행 checklist](task_plan.md)의 D21-01~08이 이번 후속 작업의 기준이다.
기존 Phase 0~20의 체크박스와 수치는 당시 증거로 유지한다.

- 조사 완료: 합성 15개 사례, 관련 회귀 65/65, TypeScript build 통과.
- 구현 후 검증 중: 일반 RPG 사전 적용 rollback → 공유 translation-lint →
  공개 전 출력 검증 → 해시 충돌 집계 → 메시지 연속성/언어 잔존 →
  AppleDouble 후보 정책 → 오류 문맥.
- 9월 8일 patch-mapping 수정은 통합 작업트리에 남아 있고 main 미병합이다.
  이번 번역 품질·적용 transaction backlog가 그 완료 기록을 대체하지 않는다.
- [003 명세와 작업표](specs/003-translation-validation/tasks.md)에 단계별 RED와 구현을 기록했다.
  독립 리뷰·필수 gate·실제 작업팩 검사·브랜치 정리를 최종 수락 조건으로 유지한다.
  구조 합격과 의미 감수·실게임 합격을 구분한다.

> **범위:** v2.5 이후의 안정화, 보안, 유지보수성, 테스트 신뢰성, 배포 재현성, 후속 호환성 확장
> **기존 문서와의 관계:** 이 문서는 장기 단계와 Exit Gate를 관리한다. 현재 D21의 검증된 실행 checklist는 `task_plan.md` 맨 위에 있으며, 그 아래와 `v2.5-validation-compatibility-plan.md`의 초기 개조·v2.5 이력은 보존한다.
> **검토 기준:** `main@17fa6e7108fca66eda5a436e19febc955c0acd9d`
> **검증 갱신:** 계획 초안은 GitHub 정적 검토로 작성했으나 2026-08-19 Phase 0 clean-room을 완료했다. 실행 결과는 `docs/baseline.md`, `findings.md`, `progress.md`에 기록한다.

---

## 0. 이 문서의 운영 규칙

### 상태 표기

- `[ ]` 시작하지 않음
- `[-]` 진행 중
- `[~]` 구현 또는 로컬 검증은 완료했으나 최종 범위·외부 증거가 남음
- `[x]` 구현과 검증을 모두 완료
- `[!]` 차단됨 — 원인과 해제 조건을 `Errors Encountered`에 함께 기록

체크박스만 채워서는 Phase가 끝나지 않는다. 각 Phase의 **Exit Gate**를 모두 통과해야 상태를 `complete`로 변경한다.

### Planning-with-files 규칙

1. 이 파일의 front matter에 있는 `status`, `current_phase`, `next_step`, `last_updated`를 작업 세션마다 함께 갱신한다.
2. 구현을 시작할 때 루트에 다음 보조 파일을 만든다.
   - `findings.md`: 조사 결과, 재현 절차, 측정값, 설계 근거
   - `progress.md`: 실행한 명령, 수정 파일, 테스트 결과, 다음 행동
3. 핵심 조사 두 건마다 최소 한 번 `findings.md`에 근거를 남긴다.
4. 코드 변경마다 `progress.md`에 파일명, 변경 이유, 검증 결과를 기록한다.
5. 오류는 발견 즉시 `Errors Encountered`에 기록한다. 재현되지 않은 추측은 사실처럼 적지 않는다.
6. 새 기능보다 회귀 방지, 단일 계약, 데이터 기반 검증, 롤백 가능성을 우선한다.
7. Phase를 완료할 때 이 문서의 **Progress Log**에 완료 커밋과 Exit Gate 결과를 남긴다.

---

## 1. Goal

Tsukuru Agent를 다음 조건을 만족하는 안전하고 재현 가능한 번역 작업 플랫폼으로 개선한다.

1. 깨끗한 체크아웃에서 설치, 컴파일, 테스트, CLI·GUI 패키징이 동일한 절차로 재현된다.
2. `verify` / `extract` / `patch` / `apply` / `recover`의 JSON 요청·응답 계약과 원본 보존 규칙이 회귀 테스트로 고정된다.
3. CLI 오케스트레이션, 엔진 서비스, 검증기, 컨테이너 처리, GUI adapter가 명확한 경계로 분리된다.
4. Electron renderer에서 Node.js 권한을 제거하고, 타입이 지정된 최소 IPC API만 노출한다.
5. 요청 옵션, manifest, 오류·경고 코드를 버전 관리되는 스키마로 관리한다.
6. 의존성, 외부 실행 파일, 라이선스, 릴리스 산출물의 출처와 무결성을 추적할 수 있다.
7. GDevelop·NW.js 후속 호환성은 실험 기능 플래그와 독립적인 Exit Gate 아래 추가한다.

---

## 2. 제품 불변 조건

모든 Phase와 PR은 아래 조건을 깨뜨리지 않아야 한다.

| ID | 불변 조건 |
|---|---|
| INV-01 | 원본 게임 디렉터리와 원본 archive를 기본 동작으로 직접 수정하지 않는다. |
| INV-02 | 검증 실패 시 최종 출력 디렉터리를 남기지 않는다. 임시 staging은 정리한다. |
| INV-03 | 출력 전환은 원자적으로 수행하며, 실패 시 기존 출력 또는 원본을 보존한다. |
| INV-04 | CLI stdout에는 최종 결과 JSON 하나만 기록하고 로그·진행률은 stderr로 분리한다. |
| INV-05 | schema v1/v2와 기존 manifest를 명시된 지원 정책 안에서 계속 읽는다. |
| INV-06 | archive 경로 탈출, 절대 경로, 링크·정션, 중복 엔트리, 크기 폭탄을 차단한다. |
| INV-07 | 네트워크 접근과 외부 프로세스 실행은 명시적 기능으로만 수행하고 결과에 드러낸다. |
| INV-08 | 번역문의 의미적 정확성을 검증기가 보장한다고 표현하지 않는다. 구조적 재삽입 가능성만 판정한다. |
| INV-09 | DRM, 코드 서명, ASAR Integrity, 암호화를 우회하는 기능을 추가하지 않는다. |
| INV-10 | 새로운 엔진·컨테이너 지원은 detect → extract → patch → verify → apply와 롤백 검증을 모두 갖춰야 기본 활성화할 수 있다. |

---

## 3. Current Status — 코드 검토 결과

### 3.1 강점

- CLI와 GUI가 RPG Maker MV/MZ, Wolf RPG, TyranoScript, GDevelop 서비스 계층을 공유한다.
- manifest ID·SHA-256·줄/offset 매핑, 원자적 쓰기, copy-only apply, provenance 검증이 이미 구현되어 있다.
- Electron ASAR와 NW.js `package.nw`에 대해 경로 탈출·링크·파일 수·해제 크기·원본 해시·보호 스크립트 검사가 존재한다.
- 구조 검증, 점수, 선택적 launch probe, RPG 번역 사전, manifest 복구까지 v2.5 기능 범위가 넓다.
- GPLv3, NOTICE, THIRD-PARTY-NOTICES 파일이 저장소에 포함되어 있다.

### 3.2 우선 개선 근거

| ID | 관찰 | 근거 경로 | 영향 | 우선순위 |
|---|---|---|---|---|
| F-01 | 추적 테스트 파일은 4개, 로컬 작업 트리의 ignored 테스트는 6개로 총 10개다. clean checkout은 compile 후 61/61, 로컬 증강 트리는 78/78이 통과했다. | `README.md`, `tsukuru-agent/test/`, `tsukuru-agent/.gitignore`, `docs/baseline.md` | 회귀 자산 전체가 소실된 것이 아니라 Git 기준선에서 17개 테스트를 재현할 수 없다. | P0 |
| F-02 | `package.json`은 2.5.0, `version.json`은 2.1.0이며 최신 커밋 메시지는 `v.2.5.01`이다. package 이름과 repository URL도 원 프로젝트 값을 유지한다. | `tsukuru-agent/package.json`, `tsukuru-agent/version.json` | version drift는 릴리스 정합성 P0이고, package/repository identity는 별도 소유권·배포 결정으로 분리해야 한다. | P0 |
| F-03 | 추적 lockfile은 없고 ignored 로컬 lock은 627 records다. Node 24.14.0/npm 11.19.0 clean 생성본 624 records를 별도 lockfile-only worktree에 구성·검증했다. | `tsukuru-agent/.gitignore`, `package-lock.json`, `findings.md` | clean 생성본을 채택해 재현 경계를 세웠으며, dependency/security 업그레이드는 분리한다. | P0 |
| F-04 | `build`와 `build:cli`는 `compile`을 자동 선행하지 않는다. compile 전 GUI build는 실패하고 CLI build는 필수 엔진 서비스가 빠진 ZIP을 exit 0으로 생성한다. 또한 GUI `files`가 `dist-cli/**`를 제외하지 않아 CLI 빌드 뒤 GUI ASAR가 34,974,465→740,468,101 bytes로 증가하고 CLI 배포물 77개를 중첩 포함한다. | `tsukuru-agent/package.json`, `tsukuru-agent/electron-builder.cli.yml`, `docs/baseline.md` | 빌드 성공 코드와 빌드 순서 모두 산출물 정확성을 보장하지 못한다. build-chain에서 compile 선행, output 상호 제외, package content smoke를 함께 고정해야 한다. | P0 |
| F-05 | 기준 트리에 `.github/workflows`가 없다. | 저장소 트리 | typecheck, test, package, 문서·산출물 drift가 push 전에 자동 차단되지 않는다. | P0 |
| F-06 | `src/cli/run.ts` 약 71KB, `src/core/validator.ts` 약 37KB, `src/core/container.ts` 약 29KB이며 여러 엔진·작업·출력 정책을 한 파일에서 조립한다. | 해당 파일 | 변경 영향 범위가 넓고 독립 테스트·리뷰·확장이 어렵다. | P1 |
| F-07 | `OperationContext`가 모듈 전역 `activeContext`에 저장되며 한 프로세스 한 작업을 전제로 한다. | `src/core/context.ts` | 예외 후 cleanup, 재진입, 병렬 실행, GUI/CLI 테스트 격리가 취약해질 수 있다. | P1 |
| F-08 | 요청 `options`가 넓은 문자열 키 객체이며 일부 옵션만 수동 검증된다. 오류·경고도 여러 위치에서 문자열로 조립된다. | `src/core/schema.ts`, `src/cli/run.ts` | 잘못된 옵션이 조용히 통과하거나 엔진별 계약이 문서와 달라질 수 있다. | P1 |
| F-09 | GUI BrowserWindow가 `nodeIntegration: true`, `contextIsolation: false`로 생성되며 renderer가 `require('electron')`을 직접 사용한다. `changeURL`, `openFolder`, 파일 일괄 치환 등 IPC 입력도 중앙 스키마 없이 처리된다. | `main.ts`, `src/html/simple/rend.ts` 및 renderer 파일 | renderer 권한이 과도하고, 향후 HTML·링크·입력 경로가 늘어날수록 공격 표면과 실수 위험이 커진다. | P0 |
| F-10 | GUI는 기존 저장소의 raw `version.json`을 읽어 알림만 표시하고 release/help URL을 연다. 자동 코드 설치 경로는 확인되지 않았지만 URL이 모두 `gramedcart/tsukuru_extractor`를 가리키고 `updates` IPC가 중복 등록되어 있다. | `main.ts`, `package.json` | 현재 fork의 버전·지원 안내가 어긋난다. 자동 업데이트 실행 위험보다 version/identity 이후의 문서·UX 정합성으로 처리한다. | P1 |
| F-11 | Electron 22, electron-builder 22, axios 0.24, deprecated `request` 등이 공존한다. clean install의 npm audit는 23건(중간 7, 높음 14, 치명적 2)을 보고했으나 도달 가능성은 아직 분류하지 않았다. | `package.json`, `docs/baseline.md` | 보안·호환성 업데이트가 누적되어 있으며, 실제 호출 경로를 분류하지 않고 일괄 major upgrade하면 회귀 위험이 크다. | P1 |
| F-12 | 패키지에 포함되는 번역 엔진 실행 파일 3개와 인접 MIT license는 확인했지만 NOTICE 문서가 이 bundle을 이름으로 식별하지 않는다. | `tsukuru-agent/exfiles/**`, `docs/baseline.md` | 출처·버전·해시·실행 정책·배포 범위와 notice를 명확히 관리해야 한다. | P1 |
| F-13 | GUI 메인 프로세스에서 동기식 파일 I/O와 장시간 변환을 직접 수행하는 경로가 남아 있다. | `main.ts`, legacy RPG/Wolf renderer·service | UI 멈춤, 취소 불가, 부분 변경 위험을 높인다. | P2 |
| F-14 | README의 “4개 작업” 표현과 실제 `recover` 포함 5개 작업이 일치하지 않는다. | `README.md`, `src/core/schema.ts` | 사용자·에이전트 계약 오해를 유발한다. | P0 |

---

## 4. Scope

### 포함

- 빌드·테스트·릴리스 재현성
- 버전과 package metadata 단일화
- CLI 계약·manifest 계약의 버전 관리
- 오케스트레이션·검증기·컨테이너 코드 분해
- Electron 권한 축소와 typed preload/IPC
- 경로 정책, staging, rollback, cancellation
- 의존성·외부 바이너리·라이선스·SBOM 관리
- 성능 기준선과 구조화 진단
- 기존 로드맵 기능의 안전한 단계적 추가
- README, SECURITY, CONTRIBUTING, architecture/compatibility 문서

### 제외

- 번역 품질이나 문맥 정확성 자동 판정
- 난독화된 임의 JavaScript의 일반 목적 자동 번역
- DRM·서명·무결성 우회
- 사용 권한이 불명확한 실제 게임 파일의 저장소 커밋
- GUI·CLI·엔진 전체의 일괄 재작성
- 테스트 근거 없이 기본 활성화되는 실험 기능

---

## 5. Target Architecture

```text
CLI entry / Electron IPC
          │
          ▼
Request Schema + Compatibility Layer
          │
          ▼
Application Dispatcher
  ├─ verify handler
  ├─ extract handler
  ├─ patch handler
  ├─ apply handler
  └─ recover handler
          │
          ├──────────────┬───────────────────┐
          ▼              ▼                   ▼
 Engine Registry   Container Registry   Workspace Transaction
  ├─ RPG MV/MZ      ├─ directory        ├─ path policy
  ├─ Wolf           ├─ ASAR             ├─ staging
  ├─ Tyrano         └─ NW.js            ├─ atomic commit
  └─ GDevelop                            └─ rollback/cleanup
          │
          ▼
Validator Registry + Score Aggregator
          │
          ▼
Stable AgentResult / structured warnings / diagnostics
```

GUI는 다음 경계를 사용한다.

```text
Renderer (Node 권한 없음)
        │
        ▼
Typed preload bridge
        │
        ▼
Validated IPC handlers
        │
        ▼
동일 Application Dispatcher / Engine Services
```

### 핵심 인터페이스 초안

```ts
interface OperationHandler<TRequest, TResult> {
  execute(request: TRequest, runtime: OperationRuntime): Promise<TResult>;
}

interface EngineAdapter {
  detect(input: ProjectInput): Promise<DetectionResult>;
  extract(input: ExtractInput, runtime: OperationRuntime): Promise<EngineOutcome>;
  verify(input: VerifyInput, runtime: OperationRuntime): Promise<ValidationReport>;
  apply(input: ApplyInput, runtime: OperationRuntime): Promise<EngineOutcome>;
}

interface ContainerAdapter {
  inspect(input: ContainerInput): Promise<ContainerInspection>;
  extract(input: ContainerExtractInput, runtime: OperationRuntime): Promise<Workspace>;
  pack(input: ContainerPackInput, runtime: OperationRuntime): Promise<ContainerOutcome>;
}

interface WorkspaceTransaction {
  stagingPath: string;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
```

인터페이스 이름과 위치는 구현 전 ADR에서 확정한다. 기존 동작을 먼저 characterization test로 고정하고 단계적으로 이동한다.

---

## 6. Phase Plan

## Phase 0 — 기준선 재현 및 증거 확정

**Objective:** 정적 관찰을 실행 가능한 기준선으로 바꾸고, 이후 PR이 무엇을 개선하거나 깨뜨렸는지 비교할 수 있게 한다.

### Tasks

- [x] `findings.md`, `progress.md`를 루트에 생성하고 이 문서와 상호 링크한다.
- [x] 기준 커밋을 깨끗한 Windows 작업 디렉터리에 체크아웃한다.
- [x] 개발 도구와 OS 정보를 기록한다.
  - Node/npm 버전
  - Windows 버전과 파일 시스템
  - Electron/electron-builder 실제 해석 버전
- [x] 현재 상태에서 `npm install`, `npm run typecheck`, `npm test`를 실행한다.
  - 실제 테스트 파일 수와 개별 테스트 수
  - pass/fail/skip
  - 실행 시간
  - 생성·수정·무시 파일
- [x] `npm run compile` 전후의 `git status --ignored`와 파일 상태를 기록한다.
- [x] 깨끗한 체크아웃에서 다음 두 경로를 각각 검증한다.
  1. 사전 compile 없이 `npm run build` / `npm run build:cli`
  2. compile 후 `npm run build` / `npm run build:cli`
- [x] 패키지 내부에 CLI·core·각 엔진 서비스·NOTICE가 실제 포함되는지 검사한다.
- [x] 패키지된 CLI에서 최소 요청 세트를 실행한다.
  - 잘못된 JSON
  - 존재하지 않는 경로
  - 합성 RPG fixture `verify`
  - 성공·실패 exit code
  - stdout JSON 단일성
- [x] README에 열거된 로컬 전용 테스트의 파일 해시와 Git 이력을 조사한다.
  - 삭제된 것인지
  - 로컬 전용으로만 존재했던 것인지
  - `v25-*.test.js`로 통합된 것인지
- [x] 대표 v1/v2 request/result와 manifest를 contract snapshot으로 저장한다.
- [x] 외부 실행 파일을 실행하지 않고 파일명, 크기, SHA-256, license 파일을 목록화한다.
- [x] 기준선에서 원본 fixture가 Git 기준과 동일하고 수정되지 않았음을 확인한다.

### Deliverables

- `findings.md` — 재현 결과와 근거
- `progress.md` — 실행 명령과 결과
- `test/contracts/baseline/` — 정규화된 요청·응답 snapshot
- `docs/baseline.md` 또는 `findings.md`의 baseline 섹션
- 외부 바이너리 inventory 초안

### Exit Gate

- [x] 한 명이 문서만 보고 깨끗한 체크아웃에서 기준선을 재현할 수 있다.
- [x] 테스트 파일 수·테스트 수·패키지 내용이 실제 측정값으로 확정되어 있다.
- [x] 성공하지 못한 명령도 재현 절차와 원인이 기록되어 있다.
- [x] 다음 Phase에서 수정할 P0 항목의 우선순위가 근거와 함께 확정되어 있다.

---

## Phase 1 — 재현 가능한 빌드, CI, 버전 단일화

**Objective:** 로컬 상태나 사전 생성 파일에 의존하지 않는 설치·컴파일·테스트·패키징 파이프라인을 만든다.

### Tasks

#### 버전·metadata

- [x] canonical version source를 하나로 정한다. 기본안은 `package.json`이다.
- [x] `version.json`, GUI 표시, 배포 파일명, release notes가 canonical version에서 생성되게 한다.
- [x] version drift를 검출하는 `check:version` 스크립트를 추가한다.
- [x] package 이름을 현재 프로젝트에 맞게 정리한다.
- [x] `repository`, `homepage`, `bugs`, author/contributors를 현재 저장소 기준으로 수정한다.
- [x] GUI 업데이트·도움말·release 링크를 현재 저장소로 이동한다.
- [x] 다음 버전이 patch인지 minor인지, 계약 변경으로 major가 필요한지 ADR로 기록한다.

#### 의존성 고정

- [x] `.gitignore`에서 `package-lock.json` 제외를 제거한다.
- [x] clean install로 lockfile을 생성·검토한다. 커밋은 maintainer 검토 후 별도 수행한다.
- [x] 개발은 `npm install`, CI·릴리스는 `npm ci`로 통일한다.
- [x] Node/npm 지원 범위를 `engines`와 문서에 명시한다.

#### 컴파일·패키징

- [x] TypeScript 산출물을 명시적 `.build/app` staging 디렉터리로 분리한다.
- [x] `tsconfig.build.json`에 `rootDir`, `outDir`, `noEmitOnError`, source map 정책을 명시한다.
- [x] `build`와 `build:cli`가 대상별 compile을 자동 선행하게 한다.
- [x] 패키징과 tracked tests가 source tree의 생성 JavaScript에 의존하지 않도록 변경한다.
- [x] GUI/CLI가 staging FileSet만 읽고 빌드 시작 시 자기 output만 안전하게 정리한다.
- [x] `CLI→GUI→CLI` 순서에서 output 오염 0건과 두 CLI ASAR의 byte/file-list 동일성을 검증한다.
- [x] 빌드 후 `git diff --exit-code` 또는 generated-artifact 검사를 추가한다.
- [x] `npm run verify`를 추가한다.
  - version check
  - typecheck
  - tests
  - generated drift check
  - package metadata check
- [x] CLI archive 내부 파일 목록과 실행 smoke를 자동 검증한다.
- [x] GUI와 CLI 패키지 입력을 staging 기반 allowlist로 바꾼다.

#### CI

- [x] `.github/workflows/ci.yml`을 추가한다.
- [x] Windows에서 최소 지원 런타임 기준으로 install → typecheck → test → build:cli → packaged smoke를 실행한다.
- [x] 순수 core/CLI 테스트가 운영체제 독립적이면 비-Windows runner에서도 실행한다.
- [x] artifact 업로드는 테스트용 build에 한정하고 보존 기간을 명시한다.
- [x] dependency cache는 lockfile hash를 키로 사용한다.
- [x] 문서의 테스트 inventory와 실제 파일 목록이 다르면 실패하는 검사 추가를 검토한다.

### Deliverables

- canonical version 정책과 ADR
- lockfile
- 재구성된 compile/build scripts
- CI workflow
- clean-room build 문서
- package content smoke test

### Exit Gate

- [~] 문서화한 `npm ci && npm run verify && npm run build:cli` 절차는 이전 clean worktree, 현재 통합 worktree, 현재 소스와 byte-identical한 disposable clean commit에서 통과했다. 최종 canonical 통합 커밋 자체의 clean-checkout 재현 증거는 커밋·푸시 승인 후 확정한다.
- [x] 같은 커밋과 toolchain에서 의존성·파일 목록·버전이 동일하게 해석된다.
- [x] package, `version.json`, GUI, archive 파일명이 같은 버전을 보고한다.
- [x] build 후 추적 파일이 의도치 않게 변경되지 않는다.
- [~] 패키지된 CLI의 stdout/exit-code smoke가 CI에서 통과한다.
  - workflow와 로컬 packaged smoke는 통과했지만, 현재 변경은 아직 푸시되지 않아 hosted CI 실행 증거는 남겨 두었다.

---

## Phase 2 — 테스트 진실성 및 회귀 방지 체계

**Objective:** 문서와 실제 테스트 범위를 일치시키고, 기능 추가 전에 현재 동작과 안전 불변 조건을 고정한다.

### Tasks

#### 테스트 inventory 정리

- [x] 과거 smoke 테스트를 복구할지, `v25-*` suite로 공식 통합할지 결정한다.
- [x] `.gitignore`의 test allowlist를 제거하거나 유지 이유를 문서화한다.
- [x] README 테스트 목록을 실제 추적 파일과 자동 동기화한다.
- [x] 테스트를 다음 계층으로 재구성한다.
  - `test/unit/`
  - `test/contract/`
  - `test/integration/`
  - `test/e2e/`
  - `test/helpers/`

#### 계약 테스트

- [x] 모든 operation의 성공·실패 request/result snapshot을 고정한다.
- [x] stdout JSON 단일성, stderr 로그, exit code를 subprocess 테스트로 검증한다.
- [x] 오류 코드·경고 코드의 중복, 오탈자, 비결정적 순서를 검출한다.
- [x] schema v1/v2와 기존 manifest의 호환성 fixture를 유지한다.
- [x] 번역 사전과 `recover`의 대형·중복·stale hash·빈 값 경계를 테스트한다.

#### 엔진·컨테이너 테스트

- [x] 저장소에 재배포 가능한 최소 합성 fixture를 엔진별로 둔다.
  - RPG MV
  - RPG MZ
  - Wolf
  - Tyrano UTF-8 / Shift_JIS
  - GDevelop strict JSON
  - Electron ASAR
  - NW.js ZIP
- [x] 각 fixture에 detect → extract → patch → verify → apply round-trip을 둔다.
- [x] 원문 그대로 재삽입한 canonical 결과와 구조가 같은지 검증한다.
- [x] 원본 fixture의 전체 해시가 전후 동일한지 검증한다.
- [x] staging 실패·output conflict·force·rollback을 테스트한다.
- [x] archive hostile cases를 fixture 또는 생성기로 테스트한다.
  - `..`, 절대 경로, drive prefix, NUL
  - 중복·대소문자 충돌
  - symlink/junction/reparse point
  - 비정상 offset/size
  - 파일 수·총 크기·개별 크기 제한
  - non-ASCII·긴 경로
- [x] line mapping과 binary offset에 property-based 또는 bounded fuzz 테스트를 도입한다.
- [x] Windows launch probe가 전체 자식 프로세스 트리를 정리하는지 검증한다.
- [x] GUI IPC는 mock 구조 테스트에서 실제 preload/IPC contract 테스트로 확장한다.

#### 실제 샘플 검증

- [x] 실제 게임 자료는 저장소 밖의 승인된 corpus로 관리한다.
- [x] 파일 자체 대신 fixture ID, 엔진, wrapper, hash, 검증 결과만 기록한다.
- [x] manual/optional compatibility workflow로 분리한다.
- [x] 구조 검증과 실제 플레이테스트를 별도 결과로 기록한다.

#### 품질 기준

- [x] coverage 도구를 추가하되 초기에는 측정만 수행한다.
- [x] 안정화 후 core/schema/path/transaction 모듈부터 최소 branch coverage 기준을 설정한다.
- [x] flaky test 재시도는 기본 해결책으로 사용하지 않는다.
- [x] 임시 디렉터리와 프로세스가 테스트 종료 후 남지 않는지 검사한다.

### Deliverables

- 정리된 테스트 디렉터리
- deterministic fixtures
- CLI contract snapshot
- hostile archive/path suite
- 테스트 inventory 문서
- coverage baseline

### Exit Gate

- [x] README의 테스트 파일 목록·개수 설명이 실제 repository와 일치한다.
- [x] 5개 operation과 4개 엔진의 주요 성공·실패 경로가 자동화되어 있다.
- [x] INV-01~INV-06과 stdout 계약이 CI에서 검증된다.
- [x] 테스트 종료 후 원본 fixture, 임시 디렉터리, 자식 프로세스가 남지 않는다.
- [x] 테스트 결과가 실행 순서에 의존하지 않는다.

---

## Phase 3 — Electron GUI 보안 경계 재구성

**Objective:** renderer에서 Node.js 전체 권한을 제거하고, 검증된 최소 IPC 표면만 유지한다.

### Tasks

#### BrowserWindow 기본값

- [x] `nodeIntegration: false`로 전환한다.
- [x] `contextIsolation: true`로 전환한다.
- [x] 호환성 검증 후 `sandbox: true`를 활성화한다.
- [x] `webSecurity`, navigation, window-open 정책을 명시한다.
- [x] 모든 BrowserWindow 생성 함수를 공통 factory로 통합한다.

#### preload bridge

- [x] `src/electron/preload.ts`를 추가한다.
- [x] `contextBridge.exposeInMainWorld`로 최소 API만 노출한다.
- [x] renderer의 `require('electron')`, Node `fs/path/process` 직접 접근을 제거한다.
- [x] preload API 타입을 `global.d.ts`에 선언하고 main/renderer가 공유한다.
- [x] renderer가 임의 IPC channel 이름을 보낼 수 없게 한다.

#### IPC 검증

- [x] `ipcMain.on` 등록을 기능별 handler 모듈로 분리한다.
- [x] 가능하면 request/response 작업을 `ipcMain.handle` / `invoke`로 바꾼다.
- [x] 모든 입력에 schema validation과 sender 검증을 적용한다.
- [x] `changeURL`은 파일 경로 대신 고정 route ID allowlist를 받는다.
- [x] `openFolder`는 `shell.openPath`와 검증된 로컬 경로만 허용한다.
- [x] 외부 URL은 HTTPS와 승인된 host allowlist를 통과한 경우에만 `shell.openExternal`로 연다.
- [x] 중복 `updates` handler를 제거한다.
- [x] renderer가 전달한 경로의 canonicalization, root containment, output conflict를 application layer에서 재검증한다.
- [x] `changeAllString` 등 직접 파일 변경 기능을 atomic workspace 작업으로 이동한다.
- [x] IPC 오류는 구조화된 오류로 renderer에 반환하고 raw stack·민감 경로 노출을 제어한다.

#### 콘텐츠·네트워크

- [x] HTML에 최소 CSP를 추가한다.
- [x] remote content를 renderer DOM에 직접 삽입하지 않는다.
- [x] 업데이트 확인을 현재 저장소의 명시적 endpoint로 이동하거나 opt-in으로 만든다.
- [x] update response schema, timeout, 실패 처리, offline 동작을 테스트한다.
- [x] 앱이 어떤 기능에서 네트워크를 사용하는지 문서화한다.

#### 예외와 종료

- [x] `uncaughtException`을 로그만 남기고 계속 진행하는 패턴을 제거한다.
- [x] fatal error 시 진행 중 transaction rollback과 사용자 알림을 보장한다.
- [x] BrowserWindow·shortcut·child process 정리를 공통 lifecycle에 넣는다.

### Deliverables

- typed preload bridge
- IPC channel registry와 schema
- BrowserWindow security factory
- CSP
- GUI security regression tests
- network/update 정책 문서

### Exit Gate

- [x] renderer 코드에 `require('electron')`과 Node core import가 없다.
- [x] 모든 창이 `nodeIntegration: false`, `contextIsolation: true`로 실행된다.
- [x] 임의 path/URL/channel이 IPC를 통해 실행되지 않는다.
- [x] GUI의 추출·적용·설정·창 전환 smoke가 통과한다.
- [x] 보안 설정 변경 후 CLI와 service 계층의 동작은 변하지 않는다.

---

## Phase 4 — Application orchestration과 엔진 경계 분해

**Objective:** `run.ts`, `validator.ts`, `container.ts`의 다중 책임을 분해하면서 동작은 유지한다.

### Tasks

#### CLI application layer

- [x] 현재 `run.ts`의 함수·의존성·side effect 지도를 `findings.md`에 기록한다.
- [x] characterization tests를 먼저 고정한다.
- [x] parsing, request loading, stdout serialization을 thin entrypoint로 분리한다.
- [x] operation dispatcher를 도입한다.
- [x] operation별 handler를 분리한다.
  - [x] `operations/verify`
  - [x] `operations/extract`
  - [x] `operations/patch`
  - [x] `operations/apply`
  - [x] `operations/recover`
- [x] 결과 생성과 human summary formatting을 별도 presenter로 이동한다.
- [x] operation handler가 `process`, `console`, Electron API에 직접 의존하지 않게 한다.
- [x] 엔진 선택을 조건문 묶음에서 registry 기반 adapter 선택으로 이동한다.
- [x] format compatibility 규칙을 중앙 정책으로 분리한다.

#### Validator

- [x] 공통 report·issue·score 타입을 분리한다.
- [x] 엔진별 validator를 모듈로 분리한다.
- [x] score 계산과 structural validation을 분리한다.
- [x] protected-path 정책을 engine/container profile로 이동한다.
- [x] issue code registry와 severity 정책을 단일화한다.
- [x] report 정렬을 결정적으로 만들어 snapshot이 안정적으로 유지되게 한다.

#### Container

- [x] archive 공통 path/limit 정책을 분리한다.
- [x] ASAR adapter와 NW.js ZIP adapter를 분리한다.
- [x] inspect, extract, pack, verify output 책임을 분리한다.
- [x] provenance 생성·읽기·검증을 transaction과 연결한다.
- [x] 모든 archive write가 동일 staging/commit API를 사용하게 한다.
- [x] directory walk의 symlink/junction·대소문자·긴 경로 정책을 문서화한다.

#### Workspace transaction

- [x] `WorkspaceTransaction` 또는 동등 추상화를 도입한다.
- [x] output conflict, force, backup, rollback 정책을 한 모듈로 통합한다.
- [x] operation 종료 시 `try/finally` cleanup을 강제한다.
- [x] 성공하기 전 최종 경로가 관찰되지 않게 한다.

### Deliverables

- thin CLI entrypoint와 dispatcher
- operation handler 모듈
- engine/container registry
- engine별 validator
- workspace transaction
- architecture ADR와 의존성 방향 문서

### Exit Gate

- [x] `run.ts`는 인수 처리·dispatcher 호출·최종 출력만 담당한다.
- [x] operation handler와 engine validator를 독립 unit test할 수 있다.
- [x] engine 추가 시 기존 handler의 대규모 조건문 수정이 필요하지 않다.
- [x] 모든 기존 contract/round-trip 테스트가 동일 결과로 통과한다.
- [x] 원본·출력·rollback 불변 조건이 transaction 테스트로 고정된다.

---

## Phase 5 — 버전 관리되는 계약과 Context 제거

**Objective:** 요청·결과·manifest·옵션을 기계 검증 가능한 계약으로 만들고 전역 작업 상태를 제거한다.

### Tasks

#### 스키마

- [x] canonical schema 기술을 선택하고 ADR로 기록한다.
  - JSON Schema + runtime validator
  - 또는 동등한 단일 소스에서 TypeScript와 runtime validator 생성
- [x] 다음 계약을 파일로 버전 관리한다.
  - request v1/v2
  - result v1/v2
  - manifest v1/v2
  - container provenance
  - engine별 option
- [x] operation과 format에 따른 discriminated union을 도입한다.
- [x] `options`의 허용 필드, 타입, 범위, 기본값, 적용 operation을 명시한다.
- [x] unknown option 정책을 schema version별로 정한다.
- [x] error code와 warning code를 registry로 관리한다.
- [x] 기존 문자열 warnings를 구조화 필드와 병행 제공하는 호환 전략을 수립한다.
- [x] schema example과 README 예시를 자동 검증한다.
- [x] contract 변경 시 migration note와 compatibility test를 요구한다.

#### Context와 재진입

- [x] 우선 `withOperationContext(context, fn)` 형태로 설정·해제를 `try/finally`로 보장한다.
- [x] 새 application layer부터 `OperationRuntime`을 명시적으로 전달한다.
- [x] RPG/Wolf 깊은 함수의 `ctx()` 의존을 경계부터 단계적으로 제거한다.
- [x] 필요한 경우 단기 호환 계층으로 `AsyncLocalStorage`를 검토하되 최종 목표는 명시적 의존성 전달로 한다.
- [x] `activeContext` singleton을 제거한다.
- [x] 두 작업의 순차·중첩·병렬 격리 테스트를 추가한다.
- [x] logger, progress, filesystem, clock, temp-dir provider를 runtime dependency로 주입한다.

#### 취소·시간 제한

- [x] operation runtime에 `AbortSignal`을 추가한다.
- [x] GUI 취소와 CLI 종료 신호를 안전한 rollback으로 연결한다.
- [x] 외부 프로세스·archive 작업·네트워크에 명시적 timeout을 둔다.
- [x] 취소 시 partial final output이 남지 않는지 테스트한다.

### Deliverables

- versioned schemas
- generated/static TypeScript types
- schema validation tests
- error/warning registry
- explicit operation runtime
- cancellation contract

### Exit Gate

- [x] 잘못된 operation/format/option 조합이 작업 시작 전에 일관된 오류로 거부된다.
- [x] v1/v2 compatibility fixture가 모두 통과한다.
- [x] module-level `activeContext`가 없다.
- [x] 두 작업이 상태를 공유하지 않으며 예외 후 context가 남지 않는다.
- [x] 취소·timeout에서도 원본과 최종 출력 불변 조건이 유지된다.

---

## Phase 6 — 의존성·외부 바이너리·공급망 정비

**Objective:** 업데이트 위험을 작은 단위로 통제하고, 배포되는 모든 코드·바이너리의 출처와 무결성을 설명할 수 있게 한다.

### Tasks

#### JavaScript 의존성

- [x] 직접 사용 여부를 기준으로 dependency inventory를 만든다.
- [x] 사용하지 않는 package를 제거한다.
- [x] deprecated `request` 사용처를 제거하고 유지보수되는 API로 교체한다.
- [x] 오래된 axios 사용처를 정리하고 timeout·redirect·response-size 정책을 명시한다.
- [x] Electron과 electron-builder 업그레이드는 한 major 단계씩 진행한다. Electron은 현재 안정 버전 43.4.1까지, electron-builder는 26.15.7까지 모든 rung과 audit 0을 검증했다.
- [x] 각 업그레이드 rung에서 GUI launch, CLI stdio, ASAR/NW.js, Authenticode 진단을 재검증했다. Electron 27의 복구 가능한 GPU subprocess 종료는 동일 조건의 Electron 28 이후에서 재현되지 않았다.
- [x] 의존성 자동 업데이트 도구를 구성하되 Electron major는 수동 승인으로 제한한다.
- [x] audit 결과의 차단 기준과 예외 만료일을 문서화한다.

#### 외부 실행 파일

- [x] `exfiles/**` 각 파일의 origin, version, license, SHA-256, 호출 코드를 inventory에 기록한다.
- [x] CLI core 배포에 실제 필요한지와 GUI 번역 기능 전용인지 구분한다.
- [x] 기본 CLI archive에서 불필요한 실행 파일을 제외한다.
- [x] optional 분리를 평가하고 현재 GUI-only bundle/CLI 제외 경계를 채택했다.
- [x] 실행 전 hash 검증, 경로 고정, 인수 배열 사용, shell 비활성화, timeout, process-tree cleanup을 적용한다.
- [x] CI에서는 외부 실행 파일을 실행하지 않고 hash/contract만 검증한다.
- [x] 바이너리 교체 절차와 검증 책임자를 문서화한다.

#### 라이선스·릴리스 무결성

- [x] THIRD-PARTY-NOTICES 생성 스크립트를 lockfile 기반으로 재현 가능하게 한다.
- [x] notice drift를 CI에서 검출한다.
- [x] font와 vendored frontend asset의 라이선스·출처를 inventory에 포함한다.
- [x] release마다 checksums 파일과 machine-readable manifest를 생성한다.
- [x] SPDX 2.3 SBOM을 생성한다.
- [x] release artifact에 source commit, source dirty 상태, version, build 환경, 파일 hash를 기록한다.

### Deliverables

- dependency inventory
- 외부 바이너리 inventory
- 단계적 upgrade PR
- audit/exception 정책
- 재현 가능한 notices
- checksums·release manifest·SBOM

### Exit Gate

- [x] 배포 파일의 모든 외부 구성요소에 출처·버전·license·hash가 있다.
- [x] 사용하지 않는 의존성과 deprecated `request`가 제거되어 있다.
- [x] CLI core가 불필요한 번역 엔진 실행 파일을 포함하지 않는다.
- [x] dependency/notice drift가 CI에서 검출된다.
- [x] release artifact를 checksum과 source commit으로 검증할 수 있다.

---

## Phase 7 — 성능, 관측 가능성, 장시간 작업 안전성

**Objective:** 대형 작업 팩과 archive에서도 진행 상태, 자원 사용, 취소, 실패 원인을 예측 가능하게 만든다.

### Tasks

- [x] 엔진·컨테이너별 benchmark fixture와 기준값을 만든다.
- [x] 다음 항목을 측정한다.
  - elapsed time
  - peak RSS
  - 파일 수·총 바이트·텍스트 엔트리 수
  - hashing·parsing·packing 단계별 시간
  - temp 공간 사용량
- [x] 동기식 대형 파일 작업을 식별하고 worker/thread/async 경계가 필요한 곳을 구분한다.
- [x] RPG/Wolf extract·apply와 대량 문자열 치환·버전 이식을 GUI worker로 분리한다. 레거시 project conversion과 외부 translation service는 bounded async 호환 경계로 명시해 canonical agent CLI 범위에서 제외하고 새 형식을 확장하지 않는다.
- [x] hashing·copy·archive 처리에 stream을 적용할 수 있는 곳을 검토한다.
- [x] progress event를 stage, completed, total, unit, operationId 구조로 표준화한다.
- [x] result에 구조화 warning code와 stage timing을 포함한다.
- [x] 민감한 절대 경로를 기본 로그에서 제거하거나 redaction한다.
- [x] 진단 보고서를 선택적으로 파일에 쓰는 옵션을 추가한다.
- [x] temp 공간 사전 점검과 resource limit을 요청/설정에서 명시한다.
- [x] 취소·SIGINT·GUI close 시 rollback과 child-process cleanup을 검증한다.
- [x] 성능 회귀 허용 범위를 CI 또는 manual benchmark에 설정한다.

### Deliverables

- benchmark suite와 baseline
- 표준 progress/diagnostics 계약
- cancellation/cleanup 구현
- large-workspace 가이드
- 성능 회귀 보고서

### Exit Gate

- [x] 대표 대형 fixture에서 자원 사용과 단계별 시간이 재현 가능하게 측정된다.
- [x] agent pipeline과 worker로 이전한 대표 GUI 작업은 main event loop를 차단하지 않는다. 레거시 project conversion은 파일별로 yield하고 translation은 비동기 network/child-process 경계를 사용하며, 둘은 worker/API 분리 전 확장 금지 대상으로 문서화한다.
- [x] 취소·종료 후 final output, temp dir, child process가 남지 않는다.
- [x] 성능 악화가 release 전에 탐지된다.
- [x] 로그가 stdout 계약을 깨거나 불필요한 민감 경로를 노출하지 않는다.

---

## Phase 8 — 후속 호환성 기능을 실험 플래그 아래 추가

**Objective:** 기존 로드맵을 core 안정화 이후 작은 기능 단위로 구현하며, 검증 근거가 생기기 전에는 기본 활성화하지 않는다.

### 공통 규칙

각 기능은 별도 feature flag, request option, compatibility fixture, rollback test, release note를 가진다. 자동 탐지 confidence가 낮으면 apply를 허용하지 않고 진단만 제공한다.

### 8A. NW.js directory-form `package.nw`

- [x] directory-form 구조와 wrapper 복사 규칙을 조사한다.
- [x] provenance와 원본 파일 목록 정책을 정의한다.
- [x] directory → workspace → apply → output round-trip을 구현한다.
- [x] 링크·정션·대소문자 충돌·원본 내부 output을 차단한다.
- [x] 기본 비활성 실험 플래그로 배포한다.

**Exit Gate**

- [x] 합성 fixture에서 원본 불변·출력 구조가 통과한다.
- [!] 승인된 실제 directory-form 샘플이 corpus에 없어 launch probe·playtest gate는 미확인이다. 2026-08-24 재감사에서도 지정된 실제 GDevelop 게임은 Electron `resources/app.asar` 배포였고 `package.nw` 후보가 없었다.
- [x] 기존 ZIP `package.nw` 동작이 변하지 않는다.

### 8B. 실행 파일 뒤 appended ZIP

- [x] 파일 구조·offset·wrapper 보존 조건을 조사한다.
- [x] 자동 적용이 안전하지 않은 변형은 진단 전용으로 남긴다.
- [x] 재패키징 전후 prefix·ZIP·실행 가능성·서명을 구분해 보고한다.
- [x] 우회가 필요한 패키지는 지원 대상에서 제외한다.

**Exit Gate**

- [x] 안전하게 식별 가능한 변형만 명시적 opt-in apply를 제공한다.
- [x] 불확실한 샘플은 변경 없이 진단 결과를 반환한다.

### 8C. Electron 내부 GDevelop apply

- [x] 기존 GDevelop JSON Pointer 검증을 container transaction에 연결한다.
- [x] protected runtime·entrypoint·source snapshot을 재검증한다.
- [x] ASAR unpacked와 외부 resources 보존을 테스트한다.
- [x] launch probe와 실제 플레이테스트 결과를 분리해 기록한다.

**Exit Gate**

- [x] loose GDevelop과 Electron GDevelop의 회귀 suite가 모두 통과한다.
- [x] runtime 파일 변형 0과 원본 archive hash 불변이 확인된다.

### 8D. GDevelop `code*.js`의 보수적 문자열 프로파일

- [x] 실행 없이 정적 분석 가능한 범위를 정의한다.
- [x] AST에서 출처가 확인되는 정적 문자열만 후보로 삼는다.
- [x] runtime·이벤트 코드·식별자·resource path를 기본 제외한다.
- [x] ambiguous candidate는 자동 추출하지 않고 report만 제공한다.
- [x] profile을 opt-in으로 유지한다.

**Exit Gate**

- [x] false-positive corpus와 보호 스크립트 회귀가 통과한다.
- [x] 임의 JavaScript 실행 없이 extract/patch/verify가 가능하다.
- [x] 안전 범위 밖의 코드는 변경하지 않는다.

---

## Phase 9 — 문서, 릴리스, 유지보수 정책 완성

**Objective:** 구현된 안전성·계약·지원 범위를 사용자가 재현하고 유지보수자가 계속 적용할 수 있게 한다.

### Tasks

- [x] README를 CLI 중심 빠른 시작과 GUI 사용법으로 분리한다.
- [x] 5개 operation과 schema version을 정확히 문서화한다.
- [x] `docs/architecture.md`에 계층·의존성·transaction 흐름을 기록한다.
- [x] `docs/compatibility.md`에 엔진·wrapper·container·작업별 지원 수준을 표로 관리한다.
- [x] `SECURITY.md`에 지원 버전, 신고 방법, 비지원 우회 기능, archive threat model을 기록한다.
- [x] `CONTRIBUTING.md`에 clean build, 테스트 fixture, contract 변경, release 절차를 기록한다.
- [x] 오류·경고 코드 reference를 생성한다.
- [x] migration/deprecation 정책을 문서화한다.
- [x] release checklist를 자동화 가능한 단계와 수동 플레이테스트로 분리한다.
- [x] changelog와 release notes를 canonical version에서 생성한다.
- [x] 기존 `task_plan.md`와 v2.5 계획 문서에 “historical” 표기를 추가한다.

### Deliverables

- 정확한 README
- architecture/compatibility/security/contributing 문서
- error/warning reference
- release checklist
- migration guide

### Exit Gate

- [x] 새 사용자가 깨끗한 환경에서 문서만으로 CLI를 설치·실행·검증할 수 있다.
- [x] 지원하지 않는 기능과 안전 한계가 명시되어 있다.
- [x] 문서 예제는 CI에서 schema/CLI 검증을 통과한다.
- [x] release notes, package, GUI, artifact가 동일 버전을 가리킨다.
- [ ] 이 계획의 전체 Definition of Done이 충족된다.
  - Electron 43.4.1/electron-builder 26.15.7 major ladder, production/full audit 0, 로컬 최종 matrix와 결정적 패키징은 완료됐다. hosted CI, clean-source evidence, 실제 샘플 수동 플레이, 서명·게시 증거는 권한과 외부 실행이 필요한 별도 gate다.

---

## 7. 권장 PR 순서

각 PR은 가능한 한 하나의 검증 가능한 변화만 포함한다.

| 순서 | PR 주제 | 선행 조건 | 핵심 검증 |
|---:|---|---|---|
| 1 | Baseline evidence와 contract snapshot | 없음 | 기존 동작 기록, 원본 hash |
| 2 | lockfile만 추적·고정 | PR 1 | clean `npm ci`, dependency graph diff |
| 3 | compile/build 파이프라인 | PR 2 | clean build, package content/smoke |
| 4 | version과 package/repository identity 결정 | PR 3 | version consumer map, version check |
| 5 | 최소 CI | PR 4 | typecheck, tracked test, package smoke |
| 6 | test inventory·fixtures·CLI contract 강화 | PR 5 | operation/engine matrix |
| 7 | Electron preload와 BrowserWindow 보안 기본값 | PR 6 | GUI smoke, IPC contract |
| 8 | IPC allowlist·path/URL 검증·atomic GUI 작업 | PR 7 | negative security cases |
| 9 | operation dispatcher와 `run.ts` 분해 | PR 6 | 결과 snapshot 동일 |
| 10 | validator/container 분해와 transaction 통합 | PR 9 | hostile archive, rollback |
| 11 | versioned schema와 typed options | PR 9 | v1/v2 compatibility |
| 12 | Context singleton 제거와 cancellation | PR 10~11 | 격리·예외·취소 테스트 |
| 13 | dependency/binary supply-chain 정리 | PR 3~6 | package content, notices, SBOM |
| 14 | 성능·진단 표준화 | PR 8~10 | benchmark, cleanup |
| 15+ | 호환성 기능별 독립 PR | 전체 P0/P1 Gate | 기능별 Exit Gate |

대형 리팩터링 PR에서 의존성 major upgrade나 신규 엔진 기능을 함께 처리하지 않는다.

---

## 8. Validation Matrix

| 영역 | 최소 자동 검증 |
|---|---|
| Request schema | v1/v2 valid·invalid·unknown option·operation/format 조합 |
| CLI process | stdout JSON, stderr, exit code, SIGINT, non-ASCII path |
| RPG MV/MZ | extract/patch/verify/apply/recover, portable pack, dictionary |
| Wolf | binary offset, length prefix, NUL, encoding, source byte mismatch |
| Tyrano | UTF-8/Shift_JIS, token/span, protected path, unrepresentable text |
| GDevelop | strict JSON parse, JSON Pointer, source snapshot, runtime protection |
| ASAR | metadata bounds, unpacked, provenance, repack, integrity/runtime report |
| NW.js | ZIP-slip, duplicate, link, size limits, wrapper copy, provenance |
| Transaction | output conflict, force, failure rollback, stale temp cleanup |
| GUI | preload API, sender validation, route allowlist, extract/apply smoke |
| Release | version sync, file inventory, notices, checksum, packaged CLI smoke |

---

## 9. Resolved Questions

Phase 0과 후속 구현에서 다음 운영 결정을 확정했다.

1. GUI는 유지되는 사용자 호환 surface이며, CLI가 에이전트용 canonical versioned interface다.
2. `exfiles/**`는 GUI 호환 기능에만 포함하고 CLI core/package에서는 제외한다.
3. 지원 범위는 Node 22/24와 npm 10/11이다. Windows는 공식 GUI/package 대상이고 Ubuntu는 core CI 대상이다.
4. 과거 ignored v25 smoke 자산은 복구 대상이 아니라 현재 tracked layered suite로 대체한다.
5. 이번 hardening의 제품 버전은 `2.5.0`을 유지한다. 후속 릴리스 번호는 canonical `package.json`에서 별도 결정한다.
6. 실제 corpus는 저장소 밖 private catalog로 운영하고 공개 결과에는 식별자·hash·redacted record만 남긴다.
7. update 경로는 metadata 알림만 허용하며 자동 다운로드·설치·실행은 하지 않는다.
8. 외부 번역·network 기능은 사용자 실행형 GUI 호환 기능으로만 유지하고 agent CLI core는 offline으로 동작한다.
9. Linux는 core/CLI CI 대상, Windows는 GUI/package 대상이다. macOS는 현재 정식 지원·배포 대상이 아니다.
10. 기존 warning 문자열 배열은 schema v1/v2 동안 구조화 warning과 병행한다. 제거는 명시적 deprecation을 거친 v3 이전에는 하지 않는다.

---

## 10. Decisions Made

| 날짜 | 결정 | 근거 |
|---|---|---|
| 2026-08-15 | 기준선은 `main@17fa6e7108fca66eda5a436e19febc955c0acd9d`로 고정한다. | 최신 main의 v2.5.01 상태를 기준으로 계획을 재현하기 위함 |
| 2026-08-15 | 기존 `task_plan.md`는 역사 문서로 보존하고 새 `New-task-plan.md`를 후속 개선의 단일 작업 원장으로 사용한다. | 완료된 개조 이력과 앞으로의 작업을 혼합하지 않기 위함 |
| 2026-08-15 | 새 엔진 기능보다 빌드 재현성·테스트 진실성·GUI 보안을 우선한다. | 현재 변경 위험을 먼저 낮춰야 후속 기능의 검증 비용이 감소함 |
| 2026-08-15 | big-bang rewrite를 하지 않고 characterization test 뒤에 모듈을 단계적으로 이동한다. | legacy GUI와 다양한 엔진 호환성을 보존하기 위함 |
| 2026-08-15 | CLI stdout JSON, 원본 보존, copy-only apply를 공개 불변 조건으로 취급한다. | 에이전트·CI 통합과 사용자 데이터 안전성의 핵심 계약임 |
| 2026-08-15 | 실제 게임 파일은 저장소 fixture로 직접 커밋하지 않는다. | 저작권·개인정보·배포권 위험을 피하기 위함 |
| 2026-08-19 | `package.json`의 `2.5.0`을 canonical version으로 유지하고 현재 저장소 identity를 사용한다. `v.2.5.01`은 커밋 제목일 뿐 태그나 SemVer 릴리스가 아니므로 버전을 올리지 않는다. GUI appId와 `MVExtractor` scheme은 기존 사용자 상태 호환을 위해 유지한다. | 로컬 태그·로그·release notes·기존 배포 ZIP 대조 및 `docs/adr/0001-version-and-project-identity.md` |
| 2026-08-23 | JSON Schema 2020-12 checked-in 문서를 wire contract의 canonical source로 삼고, 현재 corpus에 필요한 deterministic subset validator와 static TypeScript type surface를 함께 유지한다. 전역 context는 제거하고 명시적 `OperationRuntime`과 단기 `AsyncLocalStorage` 호환 경계를 사용한다. | `docs/adr/0003-versioned-json-contracts-and-operation-runtime.md`, v1/v2·격리·취소 contract tests |
| 2026-08-23 | 프로덕션 audit 0을 강제하되, 배포되는 Electron 22.3.27과 electron-builder 22.14.13의 full-audit 항목은 예외 처리하지 않고 public binary release blocker로 둔다. major는 한 단계씩 별도 검증한다. | `docs/supply-chain/audit-policy.md`, `electron-upgrade-status.md`, 실제 `npm audit` 결과 |
| 2026-08-24 | Electron 43.4.1/electron-builder 26.15.7까지 ladder와 full audit 0을 완료했다. dependency blocker는 해제하되 결정적 패키징, packaged GUI, clean-source evidence, signing, 실제 샘플 플레이테스트는 독립 gate로 유지한다. | major별 clean matrix와 `electron-upgrade-status.md` |
| 2026-08-24 | GUI는 호환 surface, versioned CLI는 canonical agent interface로 유지한다. `exfiles`·외부 번역은 GUI 전용이며 CLI core는 offline이다. Node 22/24·npm 10/11, Linux core CI, Windows GUI/package를 지원하고 실제 corpus는 private catalog와 redacted record로 운영한다. | `package.json`, CI workflow, network/I/O 정책, corpus 문서와 현재 배포 구조 |
| 2026-08-24 | update는 metadata 알림으로 제한하고 자동 설치·실행하지 않는다. warning 문자열은 v1/v2에서 구조화 코드와 병행하며 v3 이전에 제거하지 않는다. | 기존 사용자 호환성과 공급망·wire-contract 안정성을 함께 보존하기 위함 |

---

## 11. Risk Register

| ID | 위험 | 가능성/영향 | 완화 |
|---|---|---|---|
| R-01 | legacy 동작을 잘못 정리해 기존 게임 호환성이 깨짐 | 높음/높음 | characterization snapshot, 작은 PR, 실제 corpus 검증 |
| R-02 | Electron 보안 설정 변경으로 renderer가 동작하지 않음 | 높음/중간 | preload API를 먼저 정의하고 화면별 IPC contract 테스트 |
| R-03 | compile output 경로 변경으로 GUI/CLI packaging이 누락됨 | 중간/높음 | clean-room package content 검사와 packaged smoke |
| R-04 | 의존성 major upgrade가 ASAR·stdio·builder 동작을 바꿈 | 높음/높음 | 한 major씩 별도 PR, artifact diff, launch probe |
| R-05 | 실제 game fixture를 저장소에 넣을 수 없음 | 높음/중간 | 합성 fixture + 외부 승인 corpus + hash-only 기록 |
| R-06 | Windows junction·대소문자·긴 경로의 예외 | 중간/높음 | Windows 전용 hostile path suite |
| R-07 | 전역 context 제거 중 깊은 legacy 코드가 상태를 잃음 | 높음/중간 | 경계부터 주입, 호환 wrapper, 단계별 격리 테스트 |
| R-08 | 구조화 warning/error 도입이 기존 소비자를 깨뜨림 | 중간/높음 | 기존 문자열 필드 병행, schema version, migration 기간 |
| R-09 | 외부 바이너리 분리로 GUI 번역 기능 배포가 복잡해짐 | 중간/중간 | optional bundle, 명확한 installer/release manifest |
| R-10 | 성능 개선이 안전 검사를 우회하거나 순서를 바꿈 | 낮음/높음 | benchmark와 불변 조건 테스트를 함께 실행 |
| R-11 | 실험적 appended ZIP/GDevelop 코드 지원이 오탐을 만듦 | 높음/높음 | opt-in, confidence gate, diagnostic-only fallback |

---

## 12. Errors Encountered

| 날짜 | 상태 | 내용 | 해제 조건 |
|---|---|---|---|
| 2026-08-15 | 기록 | 계획 수립 환경에서 저장소를 로컬 실행하지 못했으며 GitHub connector 기반 정적 검토로 작성했다. release notes의 테스트 통과 주장은 독립 검증하지 않았다. | Phase 0 clean-room 실행 결과를 `findings.md`에 기록 |
| 2026-08-19 | 해제 | clean-room과 local-augmented 기준선을 분리 재현했다. compile 전 tracked test/GUI build 실패 및 불완전 CLI ZIP 성공을 확인했고, compile 후 61/61·두 build·패키지 CLI 3계약을 검증했다. | Phase 0 완료 |
| 2026-08-19 | 해제 | staged package metadata 누락/entry point 덮어쓰기와 exclusion-only `win.files`의 default-root 재활성화를 실제 패키징에서 발견했다. 대상별 staged package와 단일 staging FileSet으로 수정했다. | GUI/CLI ASAR output 오염 0건, CLI 양순서 byte 동일 |
| 2026-08-23 | 해제 | 초기 manifest v1 schema가 과거 최소 RPG/Wolf 엔트리에 v2 수준 필드를 요구해 Wolf 진단과 경로 탈출 오류 계약을 가렸다. | v1은 `id`/`extractFile`/`hash` 최소 호환, v2는 엄격 필드 유지; 관련 56개 집중 검사와 전체 198개 검사 통과 |
| 2026-08-23 | 해제 | Phase 5 테스트 추가 후 README inventory가 35/175로 남아 통합 gate 한 건이 실패했다. | README·CI contract를 실제 39 files/198 checks로 갱신하고 inventory drift 0 확인 |
| 2026-08-23 | 해제 | `npm audit --omit=dev`가 `adm-zip <0.6.0`의 고위험 OOM 취약점을 검출했다. | `adm-zip` 0.6.0과 내장 TypeScript types로 전환, ZIP/fuzz/NW.js 회귀 통과, production audit 0 |
| 2026-08-23 | 해제 | 최초 실제 CLI package smoke가 `src/electron/processRegistry` 누락으로 시작하지 못하고 무기한 대기했다. | 공유 process/public-error 모듈을 `src/core`로 이동, smoke 15초 timeout 추가, 실제 ZIP에서 E_REQUEST_INVALID/exit1 확인 |
| 2026-08-23 | 해제 | npm 11 PowerShell 실행에서 `--output-dir`이 npm 옵션으로 소비되어 release evidence 위치가 전달되지 않았다. | package script에 고정 플래그를 두고 output/artifact는 위치 인수로 전달; dirty source는 명시적 non-release opt-in만 허용 |
| 2026-08-24 | 해제 | 현재 matrix 감사에서 release evidence에 artifact를 생략한 첫 호출이 거부됐고, 다음 호출의 `--allow-dirty`는 npm 11이 자체 옵션으로 소비해 clean-source guard가 다시 거부했다. manifest 확인 스크립트도 존재하지 않는 `artifacts` 키를 가정해 한 번 실패했다. | 문서화된 output/artifact 위치 인수와 parser가 허용하는 `allow-dirty` 위치 토큰으로 비릴리스 증거를 생성하고 실제 schema의 `files` 배열로 재검증했다. 생성물은 ZIP SHA와 일치하며 `sourceTreeDirty:true`를 명시한다. |
| 2026-08-24 | 해제 | 최종 프로세스 봉인 쿼리가 자신의 PowerShell command line에 포함된 portable 파일명을 매칭해 제품 프로세스 1개라는 false positive를 냈다. | command-line substring 조건을 제거하고 실제 프로세스 이름 `Tsukuru Agent.exe`/`Tsukuru Agent 2.5.0.exe`만 재조회해 잔류 0을 확인했다. |
| 2026-08-24 | 해제 | 통합 `verify`에서 ASAR unpacked sidecar 충돌, RPG optional metadata/comment mapping 불일치, GUI legacy 오류 문구와 CLI snapshot·inventory drift로 7건이 실패했다. | ASAR generated sidecar 우선 병합, RPG manifest의 명시 필드만 검증·comment entry 선택화, GUI 호환 오류 복원, snapshot/README/CI inventory 갱신 후 355/355 통과 |
| 2026-08-24 | 해제 | 실제 번역 팩에서 `*_BASELINE` warning만 있어도 top-level verify가 `E_VERIFY_FAILED`를 반환하고 portable pack의 engine 진단이 `unknown`으로 남았다. | warning severity를 검증 issue 구간에서만 비차단 처리하고 legacy fallback은 최종 감지 format을 engine type으로 사용; RED/GREEN E2E와 실제 22,439/22,439·exit 0 확인 |
| 2026-08-24 | 외부 제약 | stale manifest 세 팩의 새 write-mode 복구 재현을 위해 외부 드라이브 자료를 OS temp로 복사하려 했으나 실행 환경이 첫 파일 전 재귀 복사를 종료했다. | 원본 dry-run·SHA 불변과 기존 synthetic/과거 실제 복사본 증거는 확보했다. 추가 write-mode 실전 기록은 승인된 수동 corpus runner 환경에서 수행한다. 빈 temp residue는 제거 완료 |
| 2026-08-24 | 에이전트 소스 색인 | 같은 경로의 TypeScript와 내용이 다른 추적 JS 19개를 generated drift가 허용해 지식 그래프가 구형 `src/cli/run.js`를 우선 반환했다. 첫 전체 회귀에서는 `git ls-files`가 삭제 예정 항목도 반환해 build-chain snapshot이 ENOENT로 실패했다. | TS sibling JS 0개 계약을 RED/GREEN으로 추가하고 19개 레거시 산출물을 제거했다. compile은 `.build/app`에만 emit하며 재색인 후 공개 실행 경로는 `src/cli/run.ts`로 해석된다. runtime snapshot은 실제 존재하는 추적 입력만 해시하도록 수정해 focused 계약 20/20을 통과했다. |
| 2026-08-25 | 해제 | 전체 ASAR E2E에서 Windows `taskkill`이 프로세스를 제거한 뒤 Node `exit` 이벤트가 지연되면 프로브가 이미 종료된 프로세스를 `E_LAUNCH_PROBE_FAILED`로 오판하는 경합이 드러났다. | 실제 종료 후 실패 status를 강제로 반환하는 RED 회귀를 추가하고 `taskkill` 5초 상한 및 종료 이벤트 1초 grace를 적용했다. runtime 14/14, 정상·고정순서 361/361, core coverage 90.36/72.21/96.88%, benchmark 6/6 통과 |
| 2026-08-25 | 해제 | package verifier가 결손 요청의 `E_REQUEST_INVALID`/exit1만 실행해, 유효한 packaged CLI 요청이 모두 실패해도 릴리스 검증을 통과할 수 있었다. | RED CI 계약 뒤 격리된 1-entry RPG MV fixture와 15초 상한의 success/failure smoke를 추가했다. 실제 package는 1,791 ASAR entries와 `ok/exit0,E_REQUEST_INVALID/exit1`을 통과했고 임시 root를 전부 정리했다. |
| 2026-08-25 | 외부 중단 | Computer Use에서 메뉴 Up 입력은 화면 변화를 만들지 않았고, 좌표 클릭은 input/refresh 결과가 불확실하다고 반환한 직후 사용자가 turn을 중단했다. | 추가 UI 입력을 즉시 중지하고 정확한 복사본 경로의 root+3 children만 종료했다. 제목 화면과 번역된 window title 증거만 인정하며 New Game·대표 gameplay는 미확인으로 유지한다. 원본 count/bytes/critical hashes 재확인 완료 |

---

## 13. Immediate Next Actions

1. 사용자 승인된 현재 통합 변경을 검토 가능한 커밋 단위로 정리하고 공개 branch에 푸시한다.
2. hosted Windows CI의 verify/order/Electron/package smoke 성공 로그를 보존한다.
3. 해당 clean commit에서 `allow-dirty` 없이 checksum·manifest·SPDX SBOM을 다시 생성한다.
4. 승인된 실제 MV/MZ·Electron·Wolf·Tyrano·GDevelop 및 실험 wrapper corpus를 복사본에서 수동 플레이테스트하고 redacted record를 남긴다.
5. 서명·릴리스 게시·실제 샘플 변경은 각각의 명시적 사용자 지시 전까지 수행하지 않는다.

---

## 14. Definition of Done

전체 개선 프로그램은 다음 조건을 모두 만족할 때 완료한다.

### 재현성

- [~] 이전 clean worktree와 현재 dirty integration에 더해 현재 소스와 byte-identical한 disposable clean commit에서 install → verify → package → release evidence를 검증했다. 최종 canonical 통합 커밋의 clean-checkout evidence는 아직 생성하지 않았다.
- [x] lockfile, canonical version, package metadata, release artifact가 일치한다.
- [x] 컴파일 산출물이 source tree의 우연한 로컬 상태에 의존하지 않는다.
- [~] workflow가 typecheck, test, package, packaged CLI smoke를 정의하고 로컬 contract가 이를 검증한다. 현재 통합 변경에 대한 hosted CI 실행 증거는 아직 없다.

### 계약·안전성

- [x] 5개 operation과 v1/v2 계약이 versioned schema와 contract test로 고정된다.
- [x] 원본 보존, no-partial-output, atomic rollback, stdout JSON 불변 조건이 자동 검증된다.
- [x] archive hostile cases와 Windows path 경계를 테스트한다.
- [x] error/warning code가 중앙 registry에서 관리된다.

### 구조

- [x] CLI entrypoint, operation handler, engine adapter, validator, container adapter, transaction 경계가 분리된다.
- [x] `run.ts`가 대형 오케스트레이션 파일 역할을 하지 않는다.
- [x] module-level `activeContext`가 제거되고 작업 상태가 격리된다.
- [x] GUI와 CLI가 같은 core policy, engine service, runtime, transaction 경계를 재사용한다. GUI 전용 호환 기능은 별도 adapter로 유지한다.

### GUI 보안

- [x] 모든 renderer가 Node.js 권한 없이 동작한다.
- [x] typed preload와 allowlisted IPC만 사용한다.
- [x] path, URL, route, file mutation 입력이 중앙 검증을 통과한다.
- [x] navigation, CSP, lifecycle, fatal error rollback 정책이 테스트된다.

### 공급망·릴리스

- [x] 직접 의존성과 외부 실행 파일의 출처·버전·license·hash를 추적한다.
- [x] deprecated·미사용 의존성을 제거한다.
- [x] notices, checksums, release manifest와 SPDX SBOM을 생성한다.
- [x] 패키지된 CLI core가 불필요한 GUI 번역 바이너리를 포함하지 않는다.
- [x] Electron/electron-builder major ladder가 끝나고 full audit public binary release blocker가 해소된다.

### 기능·문서

- [x] README와 compatibility 문서가 실제 지원 범위·테스트 범위와 일치한다.
- [x] 실험 기능은 flag, fixture, rollback, Exit Gate를 갖는다.
- [x] 구조 검증과 실제 플레이테스트의 의미를 구분한다.
- [x] SECURITY, CONTRIBUTING, architecture, release 절차가 유지보수 가능한 상태다.

### 외부 증거 gate

- [ ] 최종 통합 커밋의 clean checkout에서 install → verify → package와 release evidence를 재현한다.
- [ ] hosted Windows/Linux CI 로그를 보존한다.
- [ ] 승인된 private corpus 복사본으로 대표 엔진·wrapper의 수동 플레이테스트 기록을 남긴다.
- [ ] 실제 공개 릴리스를 지시받은 경우에만 서명·게시·첨부물 검증을 완료한다.

---

## 15. Progress Log

| 날짜 | Phase | 상태 | 기록 |
|---|---|---|---|
| 2026-08-15 | 계획 수립 | 완료 | GitHub connector로 기준 커밋의 root, package, TypeScript 구성, CLI/core 주요 모듈, GUI main/renderer, 테스트 inventory, 기존 계획·release notes를 검토하고 후속 개선 계획을 작성했다. 코드와 저장소는 변경하지 않았다. |
| 2026-08-15 | Phase 0 | 대기 | clean-room 명령 실행과 실제 test/package 결과 확정이 다음 단계다. |
| 2026-08-19 | Phase 0 | 완료 | clean checkout 61 tests와 local-augmented 78 tests를 분리하고, compile 전후 build/package 차이, packaged CLI 계약, lock/test/external binary hash, normalized contract snapshot을 고정했다. Sol Pro 리뷰에 따라 첫 변경은 evidence-only로 제한했다. |
| 2026-08-19 | Phase 1a | 구현·검증 완료 | `chore/hardening-lockfile`에서 Node 24.14.0/npm 11.19.0 clean lock 624 records를 채택했다. ignored local lock 627 records와 version/placement 차이를 기록하고, package.json 무변경 상태로 `npm ci`, typecheck, compile, tracked 61/61, CLI package와 다섯 계약을 통과했다. 커밋·푸시는 하지 않았다. |
| 2026-08-19 | Phase 1b | 구현·검증 완료 | `chore/hardening-build-chain`에서 `.build/app` staging, GUI/CLI 대상별 package metadata, 자기 output만 정리하는 build scripts, 8개 회귀를 추가했다. typecheck·69/69, `CLI→GUI→CLI` 오염 0건, CLI byte 동일, packaged contracts와 GUI 5초 launch를 통과했다. 커밋·푸시는 하지 않았다. |
| 2026-08-19 | Phase 1c | 구현·검증 완료 | `chore/hardening-version-identity`에서 `package.json@2.5.0`을 canonical source로 고정하고 sync/check scripts, 현재 저장소 metadata, GUI branding/link, version-derived archive name, ADR와 6개 회귀를 추가했다. `npm ci`, typecheck, compile, 67/67, 실제 CLI ZIP 내부 identity와 packaged error contract를 통과했다. 커밋·푸시는 하지 않았다. |
| 2026-08-22 | Phase 2 | 통합 검증 완료 | 테스트를 28개 파일/150개 검사로 계층화하고 5개 CLI operation snapshot, fixture·invariant catalog, hostile archive/path, bounded fuzz, private corpus workflow, coverage baseline과 순서 교란 검증을 고정했다. |
| 2026-08-23 | Phase 3 | 구현·검증 완료 | secure BrowserWindow factory, sandbox typed preload, allowlisted/validated IPC, CSP·network/update 정책, atomic GUI 변경·버전 이식, lifecycle 정리를 구현했다. 실제 Electron에서 RPG/Wolf 추출·적용, 설정 저장·닫기, `home→RPG→Wolf→RPG` 전환과 네 renderer의 Node 비노출을 확인했다. `verify`와 `test:order`는 각각 150/150 통과했다. |
| 2026-08-23 | Phase 4 | 구현·검증 완료 | `run.ts` 92줄, `validator.ts` 28줄, `container.ts` 40줄의 호환 API로 축소하고 5-operation 및 engine-family registry, 엔진별 validator, ASAR/NW.js/directory adapter, provenance와 공통 `WorkspaceTransaction`, ADR 0002를 완성했다. `npm run verify`와 고정 seed `test:order`는 각각 175/175 통과했으며 snapshot·generated·inventory drift는 0이다. 통합 worktree에는 아직 커밋·푸시하지 않았다. |
| 2026-08-23 | Phase 5 | 구현·검증 완료 | request/result/manifest v1·v2, provenance v1, engine option v2 JSON Schema와 static types, error/warning registry, structured warning 호환, schema/README examples와 migration note를 완성했다. 전역 `activeContext`를 제거하고 explicit `OperationRuntime`, AsyncLocalStorage 호환 경계, dependency injection, CLI/GUI cancellation과 timeout/transaction rollback을 구현했다. `npm run verify`와 고정 seed `test:order`가 39 files/198 checks 전부 통과했고 generated/inventory drift는 0이다. |
| 2026-08-23 | Phase 6 | core Exit Gate 완료 / Electron ladder 차단 | 직접 의존성·외부 바이너리·vendored asset inventory, pinned hash 실행 정책, bounded HTTP client, lockfile notices, audit/upgrade/binary 정책, Dependabot, checksum·clean-source manifest·SPDX SBOM을 구현했다. `adm-zip` 0.6.0으로 production audit 0, 실제 CLI ZIP 97,054,332 bytes와 packaged E_REQUEST_INVALID/exit1, Electron smoke, `verify` 및 fixed-seed 42 files/209 checks를 통과했다. Electron 22/builder 22 full audit 4 moderate·11 high 때문에 public binary release는 별도 major ladder 완료 전까지 차단한다. |
| 2026-08-23 | Phase 7 | 핵심 경계 구현·검증 완료 / GUI 호환 경계 일부 잔존 | RPG/Wolf/Tyrano/GDevelop/ASAR/NW.js benchmark와 elapsed·peak RSS·file/byte/entry·stage·temp 기준선을 추가했다. progress/stage timing, redacted diagnostics, resource preflight, GUI worker와 종료 대기·자식 PID 정리를 구현하고 RPG/Wolf extract/apply·문자열 치환·버전 이식을 worker로 이동했다. project conversion과 외부 translation은 bounded async main-process 호환 경계로 문서화했다. `benchmark:check` 6/6과 46 files/225 checks를 통과했으며 inventory drift를 0으로 맞췄다. |
| 2026-08-23 | Phase 8A | 구현·검증 완료 | directory-form `package.nw`를 진단하고 명시적 opt-in에서만 deterministic provenance, wrapper 보존, 링크·정션·충돌 차단과 별도 복사본 round-trip을 허용했다. 실제 승인 샘플은 없어 launch/playtest는 미검증으로 남겼다. |
| 2026-08-23 | Phase 8B | 구현·검증 완료 | PE32/PE32+ appended ZIP을 정적으로 판별하고 unsigned 단일 후보만 opt-in으로 prefix 보존 재패키징했다. certificate table·malformed offset·다중 후보는 진단 전용으로 차단했다. |
| 2026-08-23 | Phase 8C | 구현·검증 완료 | Electron/GDevelop을 ASAR provenance transaction에 연결하고 unpacked·외부 resources·보호 runtime을 보존했다. 비정상 ASAR metadata cleaned repack은 별도 실험 opt-in으로 제한했다. |
| 2026-08-23 | Phase 8D | 구현·검증 완료 | Acorn 정적 AST에서 생성 객체의 직접 `setString`/`setBBText` 리터럴만 opt-in 후보로 채택했다. ambiguous report, source snapshot·span·callee 재검증, false-positive·mapping tamper rollback, loose/ASAR/NW.js 왕복을 포함한 관련 45개 검사가 통과했다. |
| 2026-08-23 | Phase 9 | 구현·검증 완료 / 전체 DoD 차단 | CLI/GUI README, architecture, compatibility matrix, SECURITY, CONTRIBUTING, error/warning reference, maintenance policy, release checklist와 canonical changelog를 완성했다. 깨끗한 `npm ci` 뒤 `verify` 46 files/236 checks, fixed-seed order 236/236, benchmark 6/6, CLI ZIP 3,471 entries와 재현 가능한 checksum/manifest/SPDX SBOM을 확인했다. Electron 22/builder 22 full-audit blocker만 전체 DoD에 남는다. |
| 2026-08-23 | Electron/builder ladder | builder 완료 / Electron 진행 중 | Electron 23.3.13을 검증하고 builder 23.6.0→24.13.3→25.1.8→26.15.7을 한 major씩 clean install, audit, verify 236/236, fixed-seed 236/236, 실제 Electron smoke, CLI ZIP/package smoke로 검증했다. builder 26에서 critical `tar`와 builder high가 제거되어 full audit는 Electron 계열 high 2건만 남았다. |
| 2026-08-24 | Phase 9 P3~P5 최종 통합 | 로컬 자동 gate 완료 / 외부 gate 대기 | 기준선 참조 분류, 컨테이너 translationDirectory transaction, recover dry-run/충돌 정책, 결정적 NW.js/CLI ZIP을 완료했다. 최종 verify·고정 seed는 47 files/243 tests, benchmark 6/6, audit 0, Electron/GUI/package smoke를 통과했다. 최신 CLI ZIP 두 빌드는 148,285,977 bytes·SHA-256 `73658e117b4e8bb479fc15277e0851d900e09e4a283339313ec8474378a4f8c6`로 byte-identical했다. 보안 감사에서 manifest junction 탈출과 release ZIP Windows alias 충돌을 RED/GREEN 회귀로 추가 차단했다. 커밋·푸시는 수행하지 않았다. |
| 2026-08-24 | 통합 회귀·문서 truth audit | 로컬 자동 gate 완료 / 외부 gate 대기 | ASAR unpacked sidecar 재조립, RPG optional manifest/comment semantics, GUI legacy 오류 계약, CLI 오류 privacy·detection 분류, snapshot·inventory를 보완했다. `verify`와 fixed-seed는 각각 실제 Node 355/355, generated 19 pairs, tracked inventory 50 files/350 top-level declared checks, supply-chain drift 0으로 통과했고 core coverage line 90.36%·branch 72.21%·function 96.88%, benchmark 6/6·production/full audit 0·Electron smoke를 재확인했다. CLI ZIP 두 빌드는 146,848,378 bytes·SHA-256 `af69fc1690671d1ec5a8f9639187a8aafe1e6407ea65dfe6f79a286c742be629`로 byte-identical했으며 package verifier는 1,791 entries와 `E_REQUEST_INVALID`/exit1을 확인했다. packaged GUI는 15초 내 5개 프로세스로 기동하고 종료 후 잔류 0이었으며, 두 dirty-worktree release evidence 세트도 동일했다. clean commit·hosted CI·수동 gameplay·서명·게시는 포함하지 않는다. |
| 2026-08-24 | 승인 corpus 검증기 재감사 | 구현·읽기 전용 실전 검증 완료 / 수동 gameplay 대기 | 실제 portable RPG 팩이 발견한 baseline-warning top-level 실패와 `engine=unknown` 진단을 RED/GREEN으로 수정했다. active 7팩 deep verify와 전후 트리 SHA를 실행해 4팩 즉시 통과, 3팩 stale hash 22,825·8,940·9,836건을 분리했다. 세 팩 recover dry-run은 동일 갱신 수·artifact 0·원본 불변으로 통과했다. 최종 `npm run verify`와 고정 seed `1414747474`는 각각 실제 Node 356/356을 통과했고 suite inventory는 50 files/351 top-level checks, core coverage는 line 90.36%·branch 72.21%·function 96.88%다. write-mode 재복사 시도는 외부 파일 복사 정책에 막혀 기존 synthetic·과거 실제 복사본 증거를 유지하며 수동 corpus gate와 분리한다. 커밋·푸시는 수행하지 않았다. |
| 2026-08-24 | 에이전트 source-of-truth 정리 | 구현·패키지 검증 완료 / 외부 gate 대기 | 최신 `.build/app`과 모두 달랐지만 실행에는 쓰이지 않던 TS sibling JS 19개를 제거하고 generated-drift를 추적 여부와 무관한 금지 gate로 강화했다. 재색인 graph는 2,137 nodes/4,920 edges이며 공개 실행 경로를 `src/cli/run.ts`로 반환한다. 현재 CLI ZIP 두 빌드는 146,848,473 bytes·SHA-256 `5da20f5aa2686e91585d6d2fc22e837edd3a906ea30975217df11b2436f1ad73`로 byte-identical했고 package verifier는 1,791 entries와 `E_REQUEST_INVALID`/exit1을 확인했다. 커밋·푸시는 수행하지 않았다. |
| 2026-08-24 | Goal 연속 완료 감사 | 로컬 전체 matrix 완료 / 외부 gate 대기 | canonical checkbox 288개를 재집계해 완료 278, 외부 증거 대기 4, 실제 표본 차단 1, 전체 DoD·외부 gate 5로 확인했다. 지정 GDevelop 실게임은 Electron ASAR이며 directory-form `package.nw`가 아니었다. 현재 소스에서 verify·fixed order·core coverage가 각각 356/356, benchmark 6/6, production/full audit 0, 실제 Electron smoke를 통과했다. 새 GUI portable은 108,510,865 bytes·SHA-256 `d63b21619544da5a67e98830e632a8970d1d764e58c99f255d00f5d3ddcf0940`, 15초 관찰 5 processes·잔류 0이다. dirty release evidence는 현재 CLI ZIP SHA를 재현하고 `sourceTreeDirty:true`를 기록했다. 커밋·푸시는 수행하지 않았다. |
| 2026-08-25 | 승인된 암호화 MV 실게임 검증 | 구현·복사본 실전·로컬 자동 gate 완료 / 외부 gate 대기 | 5,868파일·1,147,736,200바이트 원본을 경로별 SHA로 보존 확인한 뒤 복사본에서 171,602 entry 추출·사전 patch/apply·deep output verify·manifest recover를 완주했다. 첫 overlay의 693파일 재직렬화와 loose `launchProbe` 무시를 RED/GREEN으로 수정해 최종 변경은 `System.json` 1파일/12 text bytes, 보호 스크립트 피해 0, 점수 94가 되었다. 숨김 실행은 15초 생존·3 descendants·잔류 0이지만 visual/manual gameplay로 간주하지 않는다. 후속 Windows 종료 경합과 packaged success-smoke까지 고친 최종 verify·고정순서는 각각 362/362, inventory 50/355, core coverage 90.16/72.00/96.88%, benchmark 6/6이다. 통합 worktree는 아직 dirty이며 커밋·푸시는 수행하지 않았다. |
| 2026-08-25 | 최신 패키지 재현성·성공 계약 감사 | 구현·dirty-worktree 증빙 완료 / 외부 gate 대기 | CLI ZIP 2회가 146,848,992 bytes·SHA-256 `a2ac85b9f95610701243adef8112bd7526e0c0759d9b1c5e8df47da80adc4e2b`로 byte-identical했고 실제 success exit0/failure exit1 smoke를 통과했다. dirty evidence 2회도 동일하며 `sourceTreeDirty:true`를 기록했다. GUI portable/NSIS는 각각 108,527,703/108,737,198 bytes이며 unsigned이고, portable 15초 관찰 5 responding processes·잔류 0이다. 171,602-entry packaged deep verify는 193.137초에 score 94/exit0으로 완료했다. fresh online audit는 외부 metadata 제출 권한이 없어 실행하지 않았고 이전 audit와 분리했다. clean checkout·hosted CI·manual gameplay·실제 directory-form `package.nw`·signing/publication은 미완료다. |
| 2026-08-25 | 승인 MV 복사본 시각 확인 | 제목 화면·번역 title 확인 / 대표 gameplay 미완료 | Computer Use로 정확한 `playable-copy-fixed/Game.exe` 창 하나를 고정해 1186x698 제목 화면과 `[Tsukuru Agent E2E]` window title을 확인했다. 번역된 System title의 런타임 반영과 정상 asset/menu 렌더링은 직접 입증했다. 메뉴 입력 결과가 불확실해진 뒤 사용자 중단에 따라 즉시 멈췄고, root+3 NW.js children 종료·잔류 0·복사본 write 0·I: 원본 5,868 files/1,147,736,200 bytes 및 critical hashes 일치를 확인했다. New Game·map/dialogue/save를 포함한 representative manual gameplay는 여전히 외부 gate다. |
| 2026-08-25 | Phase 18 Linux 이식성·종료 경합 감사 | 구현·양 OS 로컬 gate 완료 / hosted CI 대기 | Node 22.17.1/npm 10.9.2 networkless Linux snapshot에서 Windows가 숨긴 27개 결정 실패를 RED/GREEN으로 해소했다. ASAR root prefix, Win32/POSIX 경로·key redaction, corpus privacy, lowercase license, host-independent PE/offline Electron test, CLI snapshot을 보강했고 GUI worker close 경합은 Linux 최종 40/40 반복으로 봉인했다. ASAR inspection은 103 lines/complexity 23에서 44/3으로 분해했다. Windows verify/fixed-order는 각각 365/365, Linux 최종 verify/fixed-order는 각각 361 pass·4 intentional skip·0 fail, 양쪽 core coverage는 90.36/72.21/96.88%다. 새 CLI ZIP은 146,849,315 bytes·SHA-256 `68decf43860673a99e03ff1cc74a695b1dcbf49699777489657741fbc6bbdd87`이며 1,791-entry success/failure package smoke를 통과했다. hosted CI·clean commit·fresh online audit·대표 gameplay·signing/publication은 외부 gate로 유지한다. |
| 2026-08-25 | Phase 19 install-script·exact clean candidate 감사 | 구현·로컬 clean release chain 완료 / canonical·외부 gate 대기 | npm 11이 노출한 미분류 `electron-winstaller@5.4.0` lifecycle hook을 RED 계약 뒤 명시적으로 deny하고 clean install의 pending decision을 0으로 만들었다. fresh production/full audit는 모두 0건이다. 현재 소스의 byte-identical disposable clean commit에서 normal/fixed-order 366/366, Electron smoke, benchmark 6/6, GUI portable·NSIS build, 10초 packaged GUI 기동·4 responding processes·잔류 0을 확인했다. CLI ZIP 두 빌드는 146,849,326 bytes·SHA-256 `3c9b3494bcdbbde2567ddaa6bc29ffb13f848b659c3649ac221f962d4e0997e1`로 동일하고 1,791-entry success/failure smoke와 clean-source checksum/manifest/SPDX SBOM 재현성을 통과했다. 이 synthetic commit은 canonical user commit이 아니므로 hosted CI·대표 gameplay·실제 directory-form `package.nw`·signing/publication gate는 유지한다. |
| 2026-08-28 | Phase 20 GUI 계획 화해·최종 실게임 검증 | T001–T035 및 로컬 release matrix 완료 / canonical·수동·hosted gate 대기 | 후발 GUI hardening 계획 35개를 현재 코드와 화해해 전부 구현 완료로 판정했다. corpus npm 11 인수 전달과 중복 경고 요약, `.extracteddata` 변형량 오계산을 RED/GREEN으로 수정했다. normal/fixed-order 395/395, inventory 58/388, core coverage 89.86/72.24/94.20, benchmark 6/6, audit 0, Electron smoke를 통과했다. GUI portable/NSIS를 빌드·기동했고 CLI ZIP 두 빌드는 146,850,322 bytes·SHA-256 `abc6bdc87327f9be47f987f3e963b696104d7c09c06d9995fc2be9cb02e7fee2`로 동일했다. packaged deep verify는 승인 RPG MV에서 159,532 mappings·score 94·변경 1파일/19바이트·보호 피해 0을 반환했고 원본 5,868파일의 핵심 hash는 불변이다. 대표 gameplay, final clean commit/hosted CI, signing/publication은 별도 gate다. |

---

## 16. GUI 디자인·보안 계획 T001–T035 화해 (2026-08-28)

후발 계획 `specs/001-gui-design-hardening/tasks.md`는 `main@4b0741f`의
78-test 기준에서 작성되었다. 현재 통합 구현과 수락 계약을 대조한 결과는 다음과
같다. 원본 계획 파일은 사용자 작업으로 보존하고 이 원장에 실행 상태만 반영한다.

| Task | 상태 | 현재 증거 |
|---|---|---|
| T001–T003 | 완료 | 원격 실행 script 0, 4개 HTML CSP, secure window factory + sandbox/context isolation + typed preload/allowlisted IPC 전체 이행 |
| T004–T008 | 완료 | 고정 Sass pipeline·규칙 화해·style drift, one-shot `textContent` i18n, 첫 페인트 팔레트, 불투명 surface와 유효한 `--Gap` |
| T009–T015 | 완료 | 공용 motion token, semantic button/label/lang/title/settings markup, 빈 control 제거, 구분되는 theme |
| T016–T023 | 완료 | press·panel·drawer·progress·selection feedback, hover capability gate, reduced motion, focus-visible 계약 |
| T024–T027 | 완료 | GUI markup/style/theme/localization/security 계약과 push/PR CI workflow |
| T028–T031 | 완료 | WolfDec size/SHA-256 고정, deprecated HTTP client 제거, Electron 43.4.1, 현재 package/repository identity |
| T032–T035 | 완료 | 모든 TypeScript 함수 cyclomatic <=40, translator/extract/CLI 분해, `run.ts` 8,808 bytes, TS sibling JS 0 + CI drift gate |

자동 수락 게이트는 `npm run verify`, 고정순서 395/395, 실제 Electron smoke,
GUI/CLI 패키징으로 통과했다. 단, 계획 G5의 주관적 motion curve·Tab 순회 feel-check와
승인 게임의 New Game 이후 대표 플레이는 자동 증거로 대체하지 않고 외부 수동 gate로
유지한다.
