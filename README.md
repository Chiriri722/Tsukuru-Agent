# Tsukuru Agent

> **작업 재개 안내 (2026-09-13):** D21 번역 적용 무결성 개선을 반영했습니다. [현재 상태](docs/current-state.md), [Task Plan](task_plan.md), [검증 기록](specs/003-translation-validation/verification.md), [내부 문서 안내](docs/README.md)에서 구현과 검증 범위를 확인하세요.

RPG Maker MV/MZ · Wolf RPG · TyranoScript · GDevelop 게임의 번역 텍스트 추출·패치·적용을 자동화하는 **Headless CLI**입니다. Electron `app.asar`와 NW.js `package.nw` 작업본도 원본 보존 방식으로 처리합니다.
[Tsukuru Extractor](https://github.com/gramedcart/tsukuru_extractor) 2.3.0(GPLv3)의 추출·적용 로직을 UI 비의존 서비스 계층으로 리팩터링하고, 에이전트·CI 환경에서 호출할 수 있는 JSON 요청/응답 CLI를 추가했습니다. 기존 Electron GUI도 동일한 서비스 계층 위에서 동작합니다.

> **English**: Headless CLI for RPG Maker MV/MZ, Wolf RPG, TyranoScript, and conservative GDevelop translation workflows — verify / extract / patch / apply / recover game text via JSON requests, including safe Electron ASAR and NW.js package.nw staging. Refactored from Tsukuru Extractor 2.3.0 (GPLv3, see [NOTICE.md](tsukuru-agent/NOTICE.md)).

## 주요 기능

- **5개 작업**: `verify` · `extract` · `patch` · `apply` · `recover`
- **포맷 자동 판별**: RPG Maker MV/MZ(data/*.json), Wolf RPG(.mps, Data.wolf), TyranoScript(data/scenario/*.ks), GDevelop(gdjs runtime + data.js)
- **manifest 기반 번역 워크플로**: 안정 ID·원문 SHA-256·매핑 범위·경로를 쓰기 전에 검사합니다. 해시 충돌은 전체 수와 상한이 있는 파일·ID 목록으로 보고합니다.
- **관련 산출물의 원자적 반영**: patch와 RPG 사전 적용을 staging에서 검증한 뒤 반영하며 후속 오류·취소·교체 실패 시 기존 작업본과 출력을 복구합니다.
- **원문 기반 번역 검사**: 제어코드·자리표시자·새 빈 값·U+FFFD 손상을 차단하고 출력값과 허용 변경 경로를 재확인합니다. `translationQuality`는 기계적 무결성, 언어·메시지 문맥 감수, 미실행 의미 검증을 구분합니다.
- **원본 보존**: MV/MZ는 `Completed`로 출력하고 Wolf/Tyrano/GDevelop 및 ASAR/NW.js는 별도 게임 복사본에만 적용
- **에이전트 친화적**: stdout은 최종 결과 JSON 전용, 모든 로그는 stderr
- **기존 GUI 산출물과 호환**: `Extract` · `Backup` · `Completed` · `.extracteddata` · TXT 형식 유지
- **휴대용 RPG 작업 팩 지원**: 원본 JSON 없이 `Backup` + `Extract/manifest.json` + `.extracteddata`만 옮긴 외부 작업 폴더도 자동 탐지하고, `Backup` JSON 구조·manifest 매핑을 검증한 뒤 `Completed`로 적용
- **v2.5 컨테이너 진단**: Electron `resources/app.asar`와 NW.js `package.nw` 내부 nested engine을 confidence와 함께 보고하며 비정상 archive 엔트리를 별도 계수
- **v2.5 검증 점수**: extraction/mapping/reinsertion/protected-script/container 5축 점수, 파일·텍스트·보호 스크립트 변형량, stderr human summary 제공
- **원본 구조 검증**: MV/MZ JSON root·DB ID/index·핵심 데이터/맵 참조·manifest line/hash/dataPath, Wolf 바이너리 offset·길이 prefix·널 종료·인코딩·원문 해시, Tyrano KS/TJS 토큰과 UTF-8/Shift_JIS, GDevelop projectData JSON Pointer/source snapshot을 교차 검증
- **RPG 기준선 인식**: 현재 데이터의 끊어진 맵 참조가 `Backup`에도 동일하면 기존 결함 warning으로 분리하고, 현재 작업본에서 새로 생긴 참조 손상만 blocking error로 처리
- **Tyrano 안전 파이프라인**: KS의 태그·명령·주석·스크립트를 제외한 대사 span만 추출하고, source snapshot과 column mapping을 검증한 뒤 `data/scenario/*.ks`만 별도 게임 복사본에 적용
- **GDevelop 안전 파이프라인**: `data.js`를 실행하지 않고 `gdjs.projectData` JSON만 파싱해 정적 Text/BBText 객체를 추출합니다. JSON Pointer와 source snapshot을 검증하고 `gdjs/`, `libs/gdjs/`, `Extensions/`, `code*.js`는 기본 보호합니다. 실험 opt-in에서는 생성 객체의 직접 `setString`/`setBBText` 정적 리터럴만 AST로 한정합니다.
- **NW.js 안전 적용**: 독립 `package.nw` ZIP을 zip-slip·링크·파일 수·해제 크기 제한 아래 staging에 전개하고 provenance로 원본 SHA-256·엔진·파일 목록을 대조한 뒤 새 게임 복사본으로만 재포장합니다.
- **ASAR 안전 적용**: 원본 archive를 읽기 전용으로 두고 sibling working directory에 추출한 뒤 provenance·원본 SHA-256·보호 스크립트를 검증해 새 게임 복사본으로만 재포장합니다. 비정상 메타데이터는 유효 엔트리만 선별하고 `app.asar.unpacked`의 정확한 unpack 표식과 외부 resources를 보존합니다.
- **Electron 런타임 진단**: Windows 실행 파일의 fuse wire, `INTEGRITY/ELECTRONASAR` 헤더 해시, Authenticode 상태를 읽기 전용으로 구분합니다. 무결성 fuse가 활성화된 패키지의 해시 불일치는 apply를 차단하며 우회하거나 실행 파일을 수정하지 않습니다.

## CLI 빠른 시작

유지보수 작업은 [Spec-kit·플러그인 워크플로](docs/development-workflow.md)와
[진행 중인 명세](specs/003-translation-validation/spec.md)에서 이어갑니다.

요구 사항: Node.js 22.x 또는 24.x, npm 10.x 또는 11.x

개발 환경에서는 `npm install`로 의존성 변경을 반영할 수 있습니다. CI와 릴리스 검증에서는 반드시 `npm ci`를 사용해 추적된 lockfile을 그대로 재현합니다.

```powershell
cd tsukuru-agent
npm install
npm run verify         # version, typecheck, tests, generated/inventory drift
npm run compile:cli    # TypeScript → .build/app staging

# 요청 파일로 실행
node .build/app/src/cli/main.js run --request request.json

# stdin으로 실행
Get-Content request.json -Raw | node .build/app/src/cli/main.js run --request -
```

### 요청 예시 (request.json)

<!-- contract-example:request:1 -->
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

<!-- contract-example:result:1 -->
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

<!-- contract-example:request:2 -->
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

## GUI 사용

GUI는 사람이 폴더를 선택하며 작업하는 기존 RPG Maker·Wolf 중심 흐름을 제공합니다. 에이전트 자동화, versioned request/result 계약, 컨테이너 provenance, 실험 호환성 flag는 CLI를 기준 인터페이스로 사용하십시오.

개발 환경에서 GUI를 실행하려면 다음 명령을 사용합니다.

```powershell
cd tsukuru-agent
npm ci
npm start
```

renderer에는 Node API가 노출되지 않습니다. sandbox preload의 허용된 API만 사용하고, main process가 IPC sender·payload·로컬 경로·외부 URL을 다시 검증합니다. GUI의 추출·적용과 문자열 일괄 변경은 worker 및 staging transaction에서 실행되며 취소나 오류가 발생하면 최종 출력으로 전환하지 않습니다. GUI 보안 경계와 개발 검증 방법은 [아키텍처 문서](docs/architecture.md)와 [기여 가이드](CONTRIBUTING.md)를 참조하십시오.

### 휴대용 RPG 작업 팩

게임의 `data` 폴더에서 추출 후 `Backup`, `Extract`, `.extracteddata`만 외부로 옮긴 폴더를 `projectPath`로 직접 지정할 수 있습니다. `verify`는 `Backup/*.json`을 엔진 데이터 기준선으로 사용하고 `Extract/manifest.json`의 줄·해시·dataPath를 교차 검증합니다. 현재 JSON과 Backup에 동일하게 존재하는 누락 참조는 `RPG_REFERENCE_MISSING_BASELINE` 또는 `RPG_MAP_FILE_MISSING_BASELINE` warning으로 보고하고, 현재에만 생긴 손상은 기존 blocking error로 유지합니다. `apply`는 미디어 추출물이 없을 때 루트 `System.json`을 요구하지 않으며 결과는 작업 팩 아래 `Completed/data`에 생성합니다.

RPG MV/MZ 번역 사전 폴더의 최상위 `*_trans.json`이 manifest ID를 키로 사용한다면 `patch` 또는 `apply` 요청의 `options.translationDirectory`에 그 폴더를 지정할 수 있습니다. loose 작업 팩뿐 아니라 RPG provenance가 있는 Electron ASAR 작업본의 container `apply`도 사전 patch부터 엔진 apply·repack·최종 출력 교체까지 하나의 임시 transaction에서 수행합니다. 어느 단계든 실패하면 기존 출력, 원본 archive, working extract를 바꾸지 않습니다. CLI는 manifest에 존재하고 현재 해시가 맞는 문자열만 선택하며, manifest가 가리키는 Extract·Backup·`.extracteddata` 경로의 심볼릭 링크와 정션을 따라가지 않습니다. 미등록 ID·빈 값·현재 텍스트와 같은 값·추출용 주석은 건너뛴 수를 `stats.dictionary`와 warnings로 보고합니다. 명시적 `patches`와 이 옵션은 동시에 사용할 수 없습니다.

이미 번역 TXT가 직접 교체되어 manifest 해시만 오래된 작업 팩은 별도 복사본에서 `recover`를 실행할 수 있습니다. `.extracteddata`의 ID·원본 경로·라인 매핑과 현재 Extract 텍스트를 모두 검증한 뒤 기존 manifest를 `manifest.pre-recovery*.json`으로 보존하고 새 해시를 원자적으로 기록합니다. `options.dryRun: true`는 대상·백업 경로와 충돌 여부만 보고하며 파일을 쓰지 않습니다. 실제 복구의 기본 `conflictPolicy`는 `backup-and-replace`이고, `fail-if-present`는 기존 manifest가 있으면 `E_OUTPUT_CONFLICT`로 중단합니다. 매핑 자체가 손상됐거나 Backup/Extract 파일이 없으면 복구하지 않습니다.

### TyranoScript 파이프라인

Tyrano 프로젝트 루트에 `extract`를 실행하면 `data/_Extract/manifest.json`과 `data/_Extract/scenario/**/*.ks.txt`가 생성됩니다. manifest ID와 해시로 `patch`한 뒤 `verify`하면 source snapshot, 추출 TXT, KS column mapping과 임시 재삽입본을 함께 검사합니다. `apply`에는 원본 밖의 `outputPath`를 지정하며, 성공한 복사본에는 `_Extract`가 포함되지 않습니다.

`data/system/Config.tjs`, `data/others/plugin`과 scenario 밖의 파일은 manifest를 변조해도 적용 대상으로 사용할 수 없습니다. Shift_JIS 원본은 동일 인코딩을 보존하며, 한국어처럼 표현 불가능한 문자가 있으면 손실 변환 대신 `E_ENCODING_UNREPRESENTABLE`로 중단합니다.

### GDevelop 및 package.nw 파이프라인

loose GDevelop 내보내기 루트에 `extract`를 실행하면 `_Extract/gdevelop-text.txt`와 `_Extract/manifest.json`이 생성됩니다. 기본 자동 추출 범위는 `data.js`의 `gdjs.projectData` 안에 직렬화된 `TextObject::Text.string` 및 `BBText::BBText.text`입니다. Sprite/resource 이름과 임의 JavaScript는 번역 대상으로 추정하지 않습니다.

`code*.js`는 기본적으로 전부 보호됩니다. `extract`와 `apply`에 `"experimentalGdevelopCodeStrings": true`를 각각 명시하면 JavaScript를 실행하지 않고 AST를 파싱해 `GD…Objects<number>[index].setString("literal")` 및 `setBBText("literal")`의 직접 정적 문자열만 후보로 추가합니다. 식별자·resource path·URL·변수·template/연산식·그 밖의 문맥은 자동 추출하지 않고 `_Extract/gdevelop-code-report.json`에 ambiguous 후보로만 기록합니다. apply는 원본 파일 hash와 AST span·호출 문맥을 다시 확인하고 승인된 코드 파일 외의 변화는 계속 차단합니다. 자세한 경계는 [`docs/gdevelop-code-profile.md`](tsukuru-agent/docs/gdevelop-code-profile.md)를 참조하십시오.

같은 정적 JSON Pointer 규칙과 선택형 코드 프로필은 Electron `app.asar` 안의 GDevelop에도 적용됩니다. provenance가 원본 ASAR hash·엔진 root·파일 목록·unpacked 목록을 고정하고, apply는 `gdjs/`, `libs/gdjs/`, `Extensions/`와 승인되지 않은 `code*.js` 변경을 재검사한 뒤 별도 Electron 게임 복사본을 만듭니다. ASAR unpacked 파일과 `resources`의 외부 파일도 보존됩니다. 구조 검사와 선택적 launch probe는 실제 플레이테스트와 별도 결과입니다.

경계를 벗어난 크기·offset 등 비정상 ASAR metadata가 있으면 정상 entry만 작업본으로 추출하고 경고합니다. 이런 archive를 다시 만들면 비정상 entry가 제거되므로 apply는 기본 차단되며, 영향을 이해하고 별도 복사본에서 시험할 때만 `"experimentalMalformedAsarRepack": true`를 지정할 수 있습니다. 원본 ASAR는 어느 경우에도 직접 변경하지 않습니다.

독립 `package.nw`가 있는 NW.js 게임은 `extract` 요청에 원본 밖의 `outputPath`를 지정해 작업 디렉터리를 만듭니다. 작업본의 `_Extract`를 `patch`·`verify`한 뒤, `apply`에서 `options.containerSourcePath`로 원본 게임 루트를 명시하면 원본 wrapper 파일을 복사하고 번역된 새 `package.nw`를 넣은 별도 게임 디렉터리를 만듭니다. `.tsukuru-container.json`에는 절대 원본 경로를 저장하지 않으며 원본 archive 해시와 파일 목록이 달라지면 적용을 중단합니다.

`package.nw`가 ZIP 파일이 아니라 디렉터리인 배포본은 진단에서는 항상 식별하지만 변경 작업은 기본적으로 거부합니다. 해당 변형을 명시적으로 시험할 때만 `extract`와 container `apply` 요청 모두에 `"experimentalNwDirectory": true`를 지정하십시오. 링크·정션·대소문자 충돌·원본 내부 출력은 staging publication 전에 거부되며, 원본 디렉터리 digest와 wrapper는 별도 출력 복사본에서 재검증됩니다. 실제 게임 플레이 검증이 끝나기 전에는 이 옵션을 자동화 파이프라인의 기본값으로 사용하지 마십시오. 세부 안전 경계는 [`docs/experimental-nw-directory.md`](tsukuru-agent/docs/experimental-nw-directory.md)에 기록되어 있습니다.

NW.js 실행 파일 뒤에 ZIP을 붙인 단일 실행 파일 배포본도 진단합니다. PE32/PE32+ header, EOCD, central/local header offset이 서로 일치하고 PE certificate table이 없는 단일 후보만 `"experimentalNwAppendedZip": true`로 extract/apply할 수 있습니다. 적용 시 실행 파일 prefix를 byte-for-byte 보존하고 새 ZIP만 조립한 뒤 prefix hash와 archive 구조를 다시 검사합니다. 서명·인증서 테이블, 잘못된 offset, ZIP64, 여러 후보는 자동 변경하지 않으며 구조 검증은 실행 성공을 뜻하지 않습니다. 자세한 정책은 [`docs/experimental-nw-appended-zip.md`](tsukuru-agent/docs/experimental-nw-appended-zip.md)를 참조하십시오.

### ASAR 작업본 apply 예시

ASAR 게임을 `extract`하면 작업본 루트에 `.tsukuru-container.json`이 생성됩니다. 그 작업본을 `patch`한 뒤 다음처럼 원본 게임 경로를 명시하면, 검증을 통과한 완전한 게임 복사본과 새 `resources/app.asar`를 만듭니다.

<!-- contract-example:request:2 -->
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

정적 fuse·ASAR 해시·코드 서명 검사는 항상 실행됩니다. `launchProbe`는 추출된 Electron ASAR/NW.js 컨테이너 작업본의 apply에서만 사용할 수 있는 명시적 선택 기능이며 기본값은 `false`, 제한 시간은 250~15000ms입니다. loose directory apply에서 요청하면 dictionary patch나 출력 생성 전에 `E_NOT_IMPLEMENTED`로 거부합니다. 활성화하면 완성본과 분리된 임시 복사본에서 실행 파일을 관찰하고 `running` 또는 조기 정상 종료만 통과시킵니다. Windows에서는 관찰 종료 시 NW.js/Electron 자식 프로세스 트리까지 정리합니다. 네트워크·입력 자동화는 하지 않으며 실제 플레이테스트를 대체하지 않습니다.

현재 실행 프로브는 Electron의 AppData 사용자 프로필까지 격리하지 않습니다. 게임 복사본도 같은 세이브·설정을 사용할 수 있으므로 해당 저장 방식을 쓰는 게임은 프로필 격리를 확인하기 전 `launchProbe`를 켜지 마십시오. 신규 실물 샘플의 정적 검사·재포장 결과와 후속 작업은 [D22 검증 기록](docs/reviews/2026-09-23-electron-corpus.md)에 있습니다.

## 작업 설명 (CLI 계약)

| 작업 | 설명 | 출력 위치 |
|---|---|---|
| `verify` | 읽기 전용 — 포맷·경로·manifest·매핑·출력 조건 검사 | (변경 없음) |
| `extract` | 원본 보존 추출 — 엔진별 텍스트 작업본과 `manifest.json` 생성 | MV/MZ `data/Extract`, Wolf/Tyrano `data/_Extract`, GDevelop `_Extract`, 컨테이너는 `outputPath` 작업본 |
| `patch` | manifest ID·원문 해시 검증 후 **추출 작업본만** 수정, 줄 매핑 재생성 | `manifest.json` 갱신 |
| `apply` | loose MV/MZ: `Completed` / Wolf·Tyrano·GDevelop: 게임 복사본 / provenance가 있는 ASAR·NW.js 작업본: 검증된 전체 게임 복사본 | `Completed` 또는 `outputPath` |
| `recover` | loose MV/MZ 작업 팩의 `.extracteddata`와 현재 Extract를 검증해 오래된 manifest 재구축 | 새 `manifest.json` + 기존 manifest 백업 |

**프로파일**: `standard`(기존 GUI 기본 추출 수준) · `full`(플러그인·스크립트·노트·추가 JSON 확장 추출) · `advanced`(버전 관리되는 의미 기반 옵션 직접 지정)

## 필요한 문서를 바로 찾기

- [아키텍처와 transaction 흐름](docs/architecture.md)
- [엔진·wrapper·container 호환성 표](docs/compatibility.md)
- [보안 정책과 취약점 신고](SECURITY.md)
- [기여·fixture·contract 변경 규칙](CONTRIBUTING.md)
- [오류와 경고 코드 reference](docs/reference/error-warning-codes.md)
- [schema migration·deprecation·실험 기능 정책](docs/maintenance-policy.md)
- [자동 검증과 수동 플레이테스트 release checklist](docs/release-checklist.md)
- [변경 이력](CHANGELOG.md)과 [v2.5 상세 release notes](v2.5-release-notes.md)

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
npm install         # 개발 환경: package 변경과 lockfile 갱신 허용
npm ci              # CI·릴리스: lockfile 그대로 재현
npm run compile     # TypeScript와 정적 자산 → .build/app staging
npm run styles      # SCSS → 배포 CSS 재생성
npm run typecheck   # tsc --noEmit
npm test            # node:test (61개 추적 테스트 파일)
npm run test:electron # Windows 실제 sandbox preload/IPC smoke
npm run verify      # version + typecheck + style/complexity/test/generated/inventory/supply-chain drift
npm audit --omit=dev # 릴리스용 프로덕션 의존성 감사
npm run build:cli
npm run verify:package # CLI ASAR allowlist와 packaged stdout/exit smoke
npm run release:evidence -- dist-cli/release-evidence dist-cli/tsukuru-agent-2.5.0-win.zip
npm run agent -- run --request request.json
```

`npm run verify`는 버전·타입·함수별 순환 복잡도 상한(40)·전체 테스트·생성물·문서·의존성·외부 바이너리·notice drift를 한 번에 검사합니다. `npm run build:cli`는 archive entry를 UTF-8 이름순으로 정렬하고 DOS timestamp를 고정하며 빌드마다 달라지는 NTFS extra field와 ZIP comment를 제거하는 후처리까지 실행합니다. `npm run verify:package`는 이 결정적 ZIP 속성, ASAR 파일 allowlist, 외부 번역 엔진 미포함, 패키지된 CLI의 stdout/exit-code 계약을 확인합니다. `release:evidence`는 배포 archive에 대한 `SHA256SUMS`, source commit과 빌드 환경이 든 manifest, SPDX 2.3 SBOM을 결정적으로 생성합니다. 세부 정책과 machine-readable inventory는 [`tsukuru-agent/docs/supply-chain`](tsukuru-agent/docs/supply-chain)에 있습니다.

## 테스트

`npm test`는 61개 테스트 파일에서 현재 426개 검사를 실행합니다. 이 inventory 수치는 top-level `test(...)` 선언 기준이며 nested subtest는 실행 결과에서 별도로 집계됩니다. 테스트는 책임별 디렉터리로 나뉘며 `test/helpers/`에는 공유 fixture·snapshot·INV-01~06 추적표만 둡니다. `npm run test:coverage`는 같은 suite의 전체 내장 coverage를 측정하고, `npm run test:coverage:core`는 안정화된 schema/path/transaction 경계에 core coverage 하한선 line 70%, branch 50%, function 85%를 적용합니다. `npm run test:order`는 고정 seed로 파일 순서를 섞어 재현 가능한 순서 의존성 검사를 수행합니다. Windows CI의 `npm run test:electron`은 실제 Electron에서 sandbox preload와 양방향 IPC뿐 아니라 RPG/Wolf 추출·적용 요청, 설정 저장·닫기, 화면 전환을 추가 검증합니다:

- `test/contract/build-chain.test.js` — staging compile, target metadata, output 정리 allowlist, 패키지 입력 격리
- `test/contract/ci-contract.test.js` — 지원 런타임, CI workflow, 계층 구조, 문서 inventory, generated/package drift 계약
- `test/contract/cli-snapshot.test.js` — 5개 operation의 성공·실패 request/result, stdout·stderr·exit-code 스냅샷
- `test/contract/corpus-workflow.test.js` — 사설 실제 샘플 입력과 경로가 제거된 공개 구조/플레이테스트 결과 계약
- `test/contract/electron-security.test.js` — 보안 BrowserWindow factory, preload 전용 renderer, CSP·고정 route·fatal 정책
- `test/contract/fixture-catalog.test.js` — 합성 fixture 엔진·wrapper 범위와 canonical 트리 해시
- `test/contract/gui-localization.test.js` — 일회성 안전 i18n과 텍스트 전용 번역 계약
- `test/contract/gui-markup.test.js` — 시맨틱 버튼·접근 가능한 이름·문서 언어·설정 label 계약
- `test/contract/gui-styles.test.js` — SCSS 생성·모션·포커스·진행 바·패널 전환 계약
- `test/contract/gui-theme.test.js` — 불투명 테마 표면·유효 토큰·첫 페인트 팔레트 계약
- `test/contract/performance-contract.test.js` — 엔진·컨테이너 benchmark 자원 지표, 기준선, worker/stream 경계 계약
- `test/contract/supply-chain.test.js` — dependency·외부 바이너리·vendored asset inventory, notice drift, release checksum·manifest·SBOM 계약
- `test/contract/version-identity.test.js` — canonical version, package/repository identity, GUI 링크와 archive 이름 정합성
- `test/contract/versioned-schema.test.js` — request/result/manifest/provenance v1·v2, option 조합, 예제·README·migration 계약
- `test/e2e/agent-workflows.test.js` — v2 verify 구조 보고서·점수·human summary, RPG 번역 사전 patch/apply·manifest recover, nested ASAR extract→patch→apply→repack, 원본/provenance/출력 안전 가드
- `test/e2e/cli-operations.test.js` — CLI 5개 operation의 stdout JSON·exit code와 RPG/Wolf round-trip
- `test/integration/compat.test.js` — `package.nw`, GDevelop loose/NW.js provenance와 copy-only apply
- `test/integration/atomic-text-replace.test.js` — `Extract` 문자열 일괄 변경과 버전 번역 이식의 staging·commit·rollback·binary 보존
- `test/integration/bounded-fuzz.test.js` — 고정 seed line mapping·Wolf binary offset bounded fuzz
- `test/integration/core.test.js` — ASAR staging/round-trip·unpacked 표식 보존, limits/symlink/path traversal, RPG JSON·참조·manifest, Wolf 바이너리 매핑, Tyrano KS/TJS·인코딩 구조 검증
- `test/integration/corpus-runner.test.js` — 실제 샘플 카탈로그 검증·해시·공개 결과 경로 비노출
- `test/integration/electron-lifecycle.test.js` — 추적된 번역기 자식 프로세스 트리의 timeout·종료 시 완전 정리
- `test/integration/electron-preload.test.js` — 실행된 preload allowlist·이벤트 격리와 IPC sender/payload/path/URL 정책
- `test/integration/gui-adapter.test.js` — GUI apply adapter의 legacy IPC 진행률·알림 계약
- `test/integration/manifest-recovery.test.js` — 빈 값·중복 ID·대형 mapping manifest 복구 경계
- `test/integration/patch-mappings.test.js` — 누락 좌표·미수정 이웃 중첩·경로 별칭 거부, 실패 시 바이트 보존, v1 읽기 호환
- `test/integration/project-convert.test.js` — 프로젝트 변환의 확장자 없는 파일 보존, 경로 경계, 원자적 rollback
- `test/integration/rpg-smoke.test.js` — MV/MZ extract→번역→apply 합성 round-trip과 custom output conflict·atomic force 교체
- `test/integration/runtime.test.js` — Electron fuse, PE 내장 ASAR 해시, Authenticode, 비ASCII 경로, opt-in launch probe
- `test/integration/translation-dictionary.test.js` — 대형·중복·stale hash·빈 값 번역 사전 경계
- `test/integration/tyrano.test.js` — Tyrano KS span, source snapshot, 보호 경계와 Shift_JIS 손실 차단
- `test/integration/wolf-smoke.test.js` — 합성 `.mps`의 offset·길이·NUL 보존 extract/apply round-trip
- `test/unit/archive-path.test.js` — archive traversal, NUL, drive, 긴 경로, Unicode·대소문자 충돌
- `test/unit/atomic.test.js` — 파일·산출물 그룹·디렉터리 원자적 교체와 복구 오류 인과성
- `test/unit/cli-dispatcher.test.js` — 5개 operation의 주입형 단일 라우팅과 미등록 작업 거부
- `test/unit/cli-entrypoint.test.js` — 주입형 request I/O, 인수 parsing, 단일 stdout JSON 직렬화와 오류 변환
- `test/unit/complexity-gate.test.js` — TypeScript AST 기반 함수별 순환 복잡도 상한과 중첩 함수 독립 집계
- `test/unit/container-registry.test.js` — 불변 container adapter registry, 공통 archive 정책, thin 호환 API 경계
- `test/unit/css-rule-diff.test.js` — CSS 규칙 보존과 미디어 컨텍스트 이동 분류
- `test/unit/diagnostics.test.js` — 절대 경로 redaction과 원자적 opt-in 진단 보고서
- `test/unit/engine-registry.test.js` — 요청/탐지 포맷 호환성 매트릭스와 불변 엔진 capability registry
- `test/unit/error-catalog.test.js` — 오류 코드 중복·오탈자·미등록 리터럴과 정규화 계약
- `test/unit/electron-update.test.js` — 업데이트 semver schema, timeout, offline·invalid-response 분리
- `test/unit/external-binary-policy.test.js` — 번들 실행 파일 SHA-256 허용과 변조 거부
- `test/unit/gui-cancellation.test.js` — 단일 GUI 작업의 취소 소유권과 typed IPC·adapter 연결
- `test/unit/gui-worker.test.js` — 메인 이벤트 루프 분리, 공유 취소, staging·자식 프로세스 종료 정리
- `test/unit/http-client.test.js` — HTTPS/loopback, timeout, redirect allowlist, response-size 정책
- `test/unit/operation-context.test.js` — 성공·예외·중첩·병렬 context 격리와 전역 singleton 제거
- `test/unit/operation-handlers.test.js` — 독립 5-operation handler·engine-family registry 경계와 엔진별 workspace 경로 정책
- `test/unit/operation-runtime.test.js` — 명시적 runtime dependency, AbortSignal·timeout, 취소 시 output transaction 보존
- `test/unit/path-safety.test.js` — 경로 포함 판정, 결정적 전체 파일 열거, 정션 추적 거부
- `test/unit/release-zip.test.js` — CLI 배포 ZIP의 고정 timestamp·정렬·바이트 재현성과 빌드 후처리 계약
- `test/unit/resource-policy.test.js` — 파일·바이트·임시 공간 사전 측정과 요청별 자원 제한
- `test/unit/schema-detect.test.js` — v1/v2 schema 및 nested engine detection
- `test/unit/style-drift.test.js` — SCSS/CSS 바이트 동기와 stale 생성본 검출
- `test/unit/test-temp.test.js` — 테스트 전용 임시 루트의 경계 검증과 완전 제거
- `test/integration/rpg-translation-validation.test.js` — 사전·GUI 저장 rollback, 원문 제어코드 lint, 최종 JSON/YAML/plugin/CSV 검증, 충돌 집계와 읽기 전용 품질 진단
- `test/unit/translation-lint.test.js` — 토큰·자리표시자와 진단 상한, 이벤트/페이지/indent 경계, 의미 검사 한계
- `test/unit/translator-pipeline.test.js` — 번역 provider 별칭·대상 파일 경계·메모리 기반 줄 배치 회귀
- `test/unit/validator-policy.test.js` — 검증 점수·이슈 severity registry·결정적 정렬·엔진별 보호 경로 정책
- `test/unit/workspace-transaction.test.js` — 성공 전 최종 경로 비노출, force backup, rollback, 실패 commit 복구

## 로드맵

- GDevelop custom extension·hand-written event code에 대한 추가 정적 프로필 연구
- directory-form·appended-ZIP·malformed-ASAR 실험 기능의 승인된 실제 샘플 플레이테스트
- 실제 MV/MZ · Wolf 프로젝트 fixture로 round-trip 확장
- 이후 Electron/electron-builder major의 GUI launch·CLI stdio·ASAR·Authenticode 재검증
- GUI IPC 자동 회귀 강화

## 라이선스 · 크레딧

- 원저작물: **Tsukuru Extractor (mvextractor)** 2.3.0 — Sziya / [gramedcart](https://github.com/gramedcart/tsukuru_extractor), GPLv3
- 이 저장소는 원저작물의 수정본으로 **GPLv3**로 배포됩니다 ([LICENSE](LICENSE), [NOTICE.md](tsukuru-agent/NOTICE.md) 참조)
