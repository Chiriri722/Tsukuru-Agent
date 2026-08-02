# Tsukuru Agent

RPG Maker MV/MZ · Wolf RPG 게임의 번역 텍스트 추출·패치·적용을 자동화하는 **Headless CLI**입니다.
[Tsukuru Extractor](https://github.com/gramedcart/tsukuru_extractor) 2.3.0(GPLv3)의 추출·적용 로직을 UI 비의존 서비스 계층으로 리팩터링하고, 에이전트·CI 환경에서 호출할 수 있는 JSON 요청/응답 CLI를 추가했습니다. 기존 Electron GUI도 동일한 서비스 계층 위에서 동작합니다.

> **English**: Headless CLI for RPG Maker MV/MZ & Wolf RPG translation workflows — verify / extract / patch / apply game text via JSON requests. Refactored from Tsukuru Extractor 2.3.0 (GPLv3, see [NOTICE.md](NOTICE.md)).

## 주요 기능

- **4개 작업**: `verify` · `extract` · `patch` · `apply`
- **포맷 자동 판별**: RPG Maker MV/MZ(data/*.json)와 Wolf RPG(.mps, Data.wolf)
- **안전한 번역 워크플로**: `Extract/manifest.json`(안정 ID·원문 SHA-256·줄 매핑·오프셋) 기반 `patch` — 해시 불일치·중복 ID·매핑 손상 시 **아무것도 변경하지 않음**
- **원자적 쓰기**: 임시 디렉터리/파일에서 완료·검증한 뒤 교체
- **원본 보존**: MV/MZ는 `Completed`로 출력, Wolf는 게임 복사본에만 적용
- **에이전트 친화적**: stdout은 최종 결과 JSON 전용, 모든 로그는 stderr
- **기존 GUI 산출물과 호환**: `Extract` · `Backup` · `Completed` · `.extracteddata` · TXT 형식 유지

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

## 작업 설명 (CLI 계약)

| 작업 | 설명 | 출력 위치 |
|---|---|---|
| `verify` | 읽기 전용 — 포맷·경로·manifest·매핑·출력 조건 검사 | (변경 없음) |
| `extract` | 원본 보존 추출 — `Extract` · `Backup` · `.extracteddata` · `manifest.json` 생성 | `data/Extract` |
| `patch` | manifest ID·원문 해시 검증 후 **추출 작업본만** 수정, 줄 매핑 재생성 | `manifest.json` 갱신 |
| `apply` | MV/MZ: `Completed` 출력 / Wolf: 게임 복사본에만 적용 | `Completed` |

**프로파일**: `standard`(기존 GUI 기본 추출 수준) · `full`(플러그인·스크립트·노트·추가 JSON 확장 추출) · `advanced`(버전 관리되는 의미 기반 옵션 직접 지정)

## 저장소 구성

```text
tsukuru-agent/          애플리케이션 (CLI + GUI + 서비스 계층)
  src/core/             Context·스키마·manifest·원자적 쓰기 (Electron 비의존)
  src/cli/              CLI 진입점·포맷 판별·patcher
  src/js/rpgmv/         RpgMakerService 및 MV/MZ 로직
  src/js/wolf/          WolfService 및 Wolf 로직
  src/electron/         GUI adapter (기존 IPC → 서비스 계층)
  test/                 스모크·회귀 테스트 (node:test)
fixtures/               합성 테스트 fixture
task_plan.md, notes.md  개조 계획·코드 분석 문서 (작업 이력)
NOTICE.md               GPLv3 수정 고지
```

## 개발 명령

```powershell
npm run compile     # tsc emit
npm run typecheck   # tsc --noEmit
npm test            # node:test (4개 스위트)
npm run agent -- run --request request.json
```

## 테스트

`npm test`는 4개 스위트를 실행합니다:

- `test/smoke-rpg.js` — MV/MZ extract→번역→apply round-trip (합성 fixture)
- `test/smoke-wolf.js` — 합성 .mps 바이너리 extract→apply round-trip (오프셋·널 종료 검증)
- `test/smoke-cli.js` — CLI 계약(4개 작업·오류 코드·stdout JSON·exit code)
- `test/smoke-gui-adapter.js` — GUI IPC 회귀(mock mwindow)

## 로드맵

- 실제 MV/MZ · Wolf 프로젝트 fixture로 round-trip 확장
- Headless Windows 실행 파일(electron-builder) 별도 빌드 + THIRD-PARTY-NOTICES
- GUI IPC 자동 회귀 강화

## 라이선스 · 크레딧

- 원저작물: **Tsukuru Extractor (mvextractor)** 2.3.0 — Sziya / [gramedcart](https://github.com/gramedcart/tsukuru_extractor), GPLv3
- 이 저장소는 원저작물의 수정본으로 **GPLv3**로 배포됩니다 ([LICENSE](LICENSE), [NOTICE.md](NOTICE.md) 참조)
