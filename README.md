# Tsukuru Agent

> **작업 재개 안내 (2026-09-08):** 이 경로는 이전 구현의 `main`입니다. 후속 hardening 구현은 별도 `chore/hardening-integration` worktree에 있습니다. [현재 상태·경로·다음 작업](docs/current-state.md), [코드 리뷰](docs/reviews/2026-09-08.md), [내부 문서 안내](docs/README.md)를 먼저 확인하세요.

RPG Maker MV/MZ · Wolf RPG · TyranoScript · GDevelop 게임의 번역 텍스트 추출·패치·적용을 자동화하는 **Headless CLI**입니다. Electron `app.asar`와 NW.js `package.nw` 작업본도 원본 보존 방식으로 처리합니다.
[Tsukuru Extractor](https://github.com/gramedcart/tsukuru_extractor) 2.3.0(GPLv3)의 추출·적용 로직을 UI 비의존 서비스 계층으로 리팩터링하고, 에이전트·CI 환경에서 호출할 수 있는 JSON 요청/응답 CLI를 추가했습니다. 기존 Electron GUI도 동일한 서비스 계층 위에서 동작합니다.

> **English**: Headless CLI for RPG Maker MV/MZ, Wolf RPG, TyranoScript, and conservative GDevelop translation workflows — verify / extract / patch / apply / recover game text via JSON requests, including safe Electron ASAR and NW.js package.nw staging. Refactored from Tsukuru Extractor 2.3.0 (GPLv3, see [NOTICE.md](tsukuru-agent/NOTICE.md)).

## 주요 기능

- **5개 작업**: `verify` · `extract` · `patch` · `apply` · `recover`
- **포맷 자동 판별**: RPG Maker MV/MZ(data/*.json), Wolf RPG(.mps, Data.wolf), TyranoScript(data/scenario/*.ks), GDevelop(gdjs runtime + data.js)
- **manifest 기반 번역 워크플로**: 안정 ID·원문 SHA-256·줄 매핑·오프셋을 사용하며 해시 불일치와 중복 ID를 쓰기 전에 검사합니다. main의 정션·불완전한 매핑 검증 한계는 [코드 리뷰 R1/R2](docs/reviews/2026-09-08.md)를 참고하세요.
- **파일별 원자적 쓰기**: 임시 파일을 교체합니다. main의 여러 파일 patch 실패 복구 한계와 통합 브랜치의 보완은 [코드 리뷰 R3](docs/reviews/2026-09-08.md)에 기록되어 있습니다.
- **원본 보존**: MV/MZ는 `Completed`로 출력하고 Wolf/Tyrano/GDevelop 및 ASAR/NW.js는 별도 게임 복사본에만 적용
- **에이전트 친화적**: stdout은 최종 결과 JSON 전용, 모든 로그는 stderr
- **기존 GUI 산출물과 호환**: `Extract` · `Backup` · `Completed` · `.extracteddata` · TXT 형식 유지
- **휴대용 RPG 작업 팩 지원**: 원본 JSON 없이 `Backup` + `Extract/manifest.json` + `.extracteddata`만 옮긴 외부 작업 폴더도 자동 탐지하고, `Backup` JSON 구조·manifest 매핑을 검증한 뒤 `Completed`로 적용
- **v2.5 컨테이너 진단**: Electron `resources/app.asar`와 NW.js `package.nw` 내부 nested engine을 confidence와 함께 보고하며 비정상 archive 엔트리를 별도 계수
- **v2.5 검증 점수**: extraction/mapping/reinsertion/protected-script/container 5축 점수, 파일·텍스트·보호 스크립트 변형량, stderr human summary 제공
- **원본 구조 검증**: MV/MZ JSON root·DB ID/index·핵심 데이터/맵 참조·manifest line/hash/dataPath, Wolf 바이너리 offset·길이 prefix·널 종료·인코딩·원문 해시, Tyrano KS/TJS 토큰과 UTF-8/Shift_JIS, GDevelop projectData JSON Pointer/source snapshot을 교차 검증
- **Tyrano 안전 파이프라인**: KS의 태그·명령·주석·스크립트를 제외한 대사 span만 추출하고, source snapshot과 column mapping을 검증한 뒤 `data/scenario/*.ks`만 별도 게임 복사본에 적용
- **GDevelop 안전 파이프라인**: `data.js`를 실행하지 않고 `gdjs.projectData` JSON만 파싱해 정적 Text/BBText 객체를 추출합니다. JSON Pointer와 source snapshot을 검증하고 `gdjs/`, `libs/gdjs/`, `Extensions/`, `code*.js`는 보호합니다.
- **NW.js 안전 적용**: 독립 `package.nw` ZIP을 zip-slip·링크·파일 수·해제 크기 제한 아래 staging에 전개하고 provenance로 원본 SHA-256·엔진·파일 목록을 대조한 뒤 새 게임 복사본으로만 재포장합니다.
- **ASAR 안전 적용**: 원본 archive를 읽기 전용으로 두고 sibling working directory에 추출한 뒤 provenance·원본 SHA-256·보호 스크립트를 검증해 새 게임 복사본으로만 재포장합니다. 비정상 메타데이터는 유효 엔트리만 선별하고 `app.asar.unpacked`의 정확한 unpack 표식과 외부 resources를 보존합니다.
- **Electron 런타임 진단**: Windows 실행 파일의 fuse wire, `INTEGRITY/ELECTRONASAR` 헤더 해시, Authenticode 상태를 읽기 전용으로 구분합니다. 무결성 fuse가 활성화된 패키지의 해시 불일치는 apply를 차단하며 우회하거나 실행 파일을 수정하지 않습니다.

## 빠른 시작

요구 사항: Node.js 18+ (개발용 의존성 설치 필요)

```powershell
cd tsukuru-agent
npm install
npm run compile        # TypeScript → JavaScript (tsc)

# 요청 파일로 실행
node src/cli/main.js run --request request.json

# stdin으로 실행
Get-Content request.json -Raw | node src/cli/main.js run --request -
```

### 요청 예시 (request.json)

```json
{
  "schemaVersion": 1,
  "operation": "extract",
  "format": "auto",
  "projectPath": "C:\\Games\\MyGame",
  "outputPath": "C:\\Output",
  "profile": "standard",
  "options": {},
  "patches": []
}
```

### 결과 예시 (stdout)

```json
{
  "ok": true,
  "format": "rpgmv",
  "artifacts": ["C:\\Games\\MyGame\\www\\data\\Extract"],
  "stats": { "files": 4, "entries": 43, "textBytes": 12345, "elapsedMs": 210 },
  "warnings": [],
  "error": null
}
```

성공 exit code는 0, 실패 시 1이며 `error.code`에 구조화 오류(`E_PATH_NOT_FOUND`, `E_EXTRACT_EXISTS`, `E_PATCH_HASH_MISMATCH` 등)가 반환됩니다.

### v2.5 verify 예시

```json
{
  "schemaVersion": 2,
  "operation": "verify",
  "format": "auto",
  "projectPath": "C:\\Games\\ElectronMZ",
  "outputPath": "C:\\Games\\ElectronMZ_working",
  "profile": "standard",
  "options": {
    "verifyDepth": "deep",
    "humanSummary": true
  },
  "patches": []
}
```

결과의 `container`, `engine`, `scores`, `change`, `runtime`, `validation` 필드는 에이전트가 구조화해 읽고, `humanSummary`가 켜지면 동일 요약을 stderr 터미널에서 볼 수 있습니다. `validation`은 RPG/Wolf/Tyrano/GDevelop의 검사 파일·엔트리 수, 유효/무효 수, 인코딩 집계, 토큰·참조 오류와 위치가 포함된 issue code를 제공합니다. `runtime`은 실행 파일 후보, fuse, 내장 ASAR 해시, Authenticode, 선택적 실행 프로브와 `blocked`/`risk`를 분리해 제공합니다. `container.invalidEntryCount`는 ASAR/ZIP의 비정상 메타데이터·경로·링크 엔트리 수이며, 출력 비교가 없으면 보호 스크립트 피해도는 `unassessed`/50점으로 보수적으로 표시합니다. v1 요청과 v1 manifest도 계속 허용됩니다. 원본 archive는 직접 수정하지 않으며 컨테이너 extract의 기본 산출물은 sibling working directory입니다.

### 휴대용 RPG 작업 팩

게임의 `data` 폴더에서 추출 후 `Backup`, `Extract`, `.extracteddata`만 외부로 옮긴 폴더를 `projectPath`로 직접 지정할 수 있습니다. `verify`는 `Backup/*.json`을 엔진 데이터 기준선으로 사용하고 `Extract/manifest.json`의 줄·해시·dataPath를 교차 검증합니다. `apply`는 미디어 추출물이 없을 때 루트 `System.json`을 요구하지 않으며 결과는 작업 팩 아래 `Completed/data`에 생성합니다.

RPG MV/MZ 번역 사전 폴더의 최상위 `*_trans.json`이 manifest ID를 키로 사용한다면 `patch` 또는 `apply` 요청의 `options.translationDirectory`에 그 폴더를 지정할 수 있습니다. CLI는 manifest에 존재하고 현재 해시가 맞는 문자열만 선택하며, 미등록 ID·빈 값·현재 텍스트와 같은 값·추출용 주석은 건너뛴 수를 `stats.dictionary`와 warnings로 보고합니다. 명시적 `patches`와 이 옵션은 동시에 사용할 수 없습니다.

이미 번역 TXT가 직접 교체되어 manifest 해시만 오래된 작업 팩은 별도 복사본에서 `recover`를 실행할 수 있습니다. `.extracteddata`의 ID·원본 경로·라인 매핑과 현재 Extract 텍스트를 모두 검증한 뒤 기존 manifest를 `manifest.pre-recovery*.json`으로 보존하고 새 해시를 원자적으로 기록합니다. 매핑 자체가 손상됐거나 Backup/Extract 파일이 없으면 복구하지 않습니다.

### TyranoScript 파이프라인

Tyrano 프로젝트 루트에 `extract`를 실행하면 `data/_Extract/manifest.json`과 `data/_Extract/scenario/**/*.ks.txt`가 생성됩니다. manifest ID와 해시로 `patch`한 뒤 `verify`하면 source snapshot, 추출 TXT, KS column mapping과 임시 재삽입본을 함께 검사합니다. `apply`에는 원본 밖의 `outputPath`를 지정하며, 성공한 복사본에는 `_Extract`가 포함되지 않습니다.

`data/system/Config.tjs`, `data/others/plugin`과 scenario 밖의 파일은 manifest를 변조해도 적용 대상으로 사용할 수 없습니다. Shift_JIS 원본은 동일 인코딩을 보존하며, 한국어처럼 표현 불가능한 문자가 있으면 손실 변환 대신 `E_ENCODING_UNREPRESENTABLE`로 중단합니다.

### GDevelop 및 package.nw 파이프라인

loose GDevelop 내보내기 루트에 `extract`를 실행하면 `_Extract/gdevelop-text.txt`와 `_Extract/manifest.json`이 생성됩니다. 현재 자동 추출 범위는 `data.js`의 `gdjs.projectData` 안에 직렬화된 `TextObject::Text.string` 및 `BBText::BBText.text`입니다. Sprite/resource 이름, 이벤트에서 생성된 `code*.js` 문자열, 임의 JavaScript는 번역 대상으로 추정하지 않습니다.

독립 `package.nw`가 있는 NW.js 게임은 `extract` 요청에 원본 밖의 `outputPath`를 지정해 작업 디렉터리를 만듭니다. 작업본의 `_Extract`를 `patch`·`verify`한 뒤, `apply`에서 `options.containerSourcePath`로 원본 게임 루트를 명시하면 원본 wrapper 파일을 복사하고 번역된 새 `package.nw`를 넣은 별도 게임 디렉터리를 만듭니다. `.tsukuru-container.json`에는 절대 원본 경로를 저장하지 않으며 원본 archive 해시와 파일 목록이 달라지면 적용을 중단합니다.

### ASAR 작업본 apply 예시

ASAR 게임을 `extract`하면 작업본 루트에 `.tsukuru-container.json`이 생성됩니다. 그 작업본을 `patch`한 뒤 다음처럼 원본 게임 경로를 명시하면, 검증을 통과한 완전한 게임 복사본과 새 `resources/app.asar`를 만듭니다.

```json
{
  "schemaVersion": 2,
  "operation": "apply",
  "format": "auto",
  "projectPath": "C:\\Games\\ElectronMZ_working",
  "outputPath": "C:\\Games\\ElectronMZ_translated",
  "profile": "standard",
  "options": {
    "containerSourcePath": "C:\\Games\\ElectronMZ",
    "launchProbe": true,
    "launchTimeoutMs": 3000
  },
  "patches": []
}
```

`containerSourcePath`는 provenance에 절대 원본 경로를 저장하지 않기 위한 명시적 권한입니다. CLI는 원본 archive 경로·SHA-256·엔진 루트·파일 목록을 교차 검증하고, staging에서 apply한 뒤 번역용 `Extract`/`Backup`/`Completed`/`.extracteddata`를 제외해 pack합니다. 필수 entry, 전체 파일 목록, unpacked 표식, 보호 스크립트, 런타임 무결성과 원본 해시가 모두 맞아야 최종 출력 디렉터리로 전환됩니다. 기존 출력이 있으면 기본적으로 거부하며 의도적인 교체에만 `options.force: true`를 사용합니다.

정적 fuse·ASAR 해시·코드 서명 검사는 항상 실행됩니다. `launchProbe`는 apply에서만 사용할 수 있는 명시적 선택 기능이며 기본값은 `false`, 제한 시간은 250~15000ms입니다. 활성화하면 완성본과 분리된 임시 복사본에서 실행 파일을 관찰하고 `running` 또는 조기 정상 종료만 통과시킵니다. Windows에서는 관찰 종료 시 NW.js/Electron 자식 프로세스 트리까지 정리합니다. 네트워크·입력 자동화는 하지 않으며 실제 플레이테스트를 대체하지 않습니다.

## 작업 설명 (CLI 계약)

| 작업 | 설명 | 출력 위치 |
|---|---|---|
| `verify` | 읽기 전용 — 포맷·경로·manifest·매핑·출력 조건 검사 | (변경 없음) |
| `extract` | 원본 보존 추출 — 엔진별 텍스트 작업본과 `manifest.json` 생성 | MV/MZ `data/Extract`, Wolf/Tyrano `data/_Extract`, GDevelop `_Extract`, 컨테이너는 `outputPath` 작업본 |
| `patch` | manifest ID·원문 해시 검증 후 **추출 작업본만** 수정, 줄 매핑 재생성 | `manifest.json` 갱신 |
| `apply` | loose MV/MZ: `Completed` / Wolf·Tyrano·GDevelop: 게임 복사본 / provenance가 있는 ASAR·NW.js 작업본: 검증된 전체 게임 복사본 | `Completed` 또는 `outputPath` |
| `recover` | loose MV/MZ 작업 팩의 `.extracteddata`와 현재 Extract를 검증해 오래된 manifest 재구축 | 새 `manifest.json` + 기존 manifest 백업 |

**프로파일**: `standard`(기존 GUI 기본 추출 수준) · `full`(플러그인·스크립트·노트·추가 JSON 확장 추출) · `advanced`(버전 관리되는 의미 기반 옵션 직접 지정)

## 저장소 구성

```text
tsukuru-agent/          애플리케이션 (CLI + GUI + 서비스 계층)
  src/core/             Context·스키마·manifest·원자적 쓰기 (Electron 비의존)
  src/cli/              CLI 진입점·포맷 판별·patcher
  src/js/rpgmv/         RpgMakerService 및 MV/MZ 로직
  src/js/wolf/          WolfService 및 Wolf 로직
  src/js/tyrano/        TyranoService 및 KS span 파이프라인
  src/js/gdevelop/      GDevelop projectData/JSON Pointer 파이프라인
  src/electron/         GUI adapter (기존 IPC → 서비스 계층)
  test/                 스모크·회귀 테스트 (node:test)
fixtures/               합성 테스트 fixture
task_plan.md, notes.md  개조 계획·코드 분석 문서 (작업 이력)
docs/README.md         내부 문서의 읽는 순서
docs/current-state.md  브랜치·경로·검증·다음 작업
docs/reviews/          날짜별 코드 리뷰
v2.5-release-notes.md   v2.5 호환성 변경과 알려진 한계
tsukuru-agent/NOTICE.md GPLv3 수정 고지
```

## 개발 명령

```powershell
npm run compile     # tsc emit
npm run typecheck   # tsc --noEmit
npm test            # node:test (현재 로컬 10개, Git 추적 4개 파일)
npm run agent -- run --request request.json
```

## 테스트

2026-09-08의 main 검증은 **로컬 10개 파일 78/78**, **Git 추적 4개 파일 61/61**입니다. 아래 목록 중 smoke 4개 및 `v25-tyrano.test.js`, `v25-compat.test.js`는 ignored 로컬 파일이므로 새 clone에는 포함되지 않습니다. 먼저 `npm run compile`을 실행해야 합니다. 통합 브랜치는 이 파일들을 추적되는 테스트 구조로 옮겼으며, 별도 검증 결과는 [작업 재개 안내](docs/current-state.md)에 있습니다.

- `test/smoke-rpg.js` — MV/MZ extract→번역→apply round-trip (합성 fixture)
- `test/smoke-wolf.js` — 합성 .mps 바이너리 extract→apply round-trip (오프셋·널 종료 검증)
- `test/smoke-cli.js` — CLI 계약(4개 작업·오류 코드·stdout JSON·exit code)
- `test/smoke-gui-adapter.js` — GUI IPC 회귀(mock mwindow)
- `test/v25-core.test.js` — ASAR staging/round-trip·unpacked 표식 보존, limits/symlink/path traversal, RPG JSON·참조·manifest, Wolf 바이너리 매핑, Tyrano KS/TJS·인코딩 구조 검증
- `test/v25-cli.test.js` — v2 verify 구조 보고서·점수·human summary, RPG 번역 사전 patch/apply·manifest recover, nested ASAR extract→patch→apply→repack, 원본/provenance/출력 안전 가드
- `test/v25-tyrano.test.js` — Tyrano KS span extract→patch→verify→copy-only apply, source snapshot, 보호 스크립트 경계와 Shift_JIS 손실 차단
- `test/v25-compat.test.js` — package.nw ZIP 왕복·zip-slip 차단, GDevelop 정적 텍스트/JSON Pointer, loose 및 NW.js provenance CLI E2E
- `test/v25-schema-detect.test.js` — v1/v2 schema 및 nested engine detection
- `test/v25-runtime.test.js` — Electron fuse, PE 내장 ASAR 해시, Authenticode, 비ASCII 경로, opt-in launch probe

## 로드맵

- GDevelop event-generated `code*.js`의 명시적·검증 가능한 문자열 프로파일 연구
- NW.js 실행 파일 뒤 appended ZIP 및 directory-form `package.nw` 진단 확장
- 실제 MV/MZ · Wolf 프로젝트 fixture로 round-trip 확장
- Headless Windows 실행 파일(electron-builder) 별도 빌드 + THIRD-PARTY-NOTICES
- GUI IPC 자동 회귀 강화

## 라이선스 · 크레딧

- 원저작물: **Tsukuru Extractor (mvextractor)** 2.3.0 — Sziya / [gramedcart](https://github.com/gramedcart/tsukuru_extractor), GPLv3
- 이 저장소는 원저작물의 수정본으로 **GPLv3**로 배포됩니다 ([LICENSE](LICENSE), [NOTICE.md](tsukuru-agent/NOTICE.md) 참조)
