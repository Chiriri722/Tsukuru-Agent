# Notes: Tsukuru Extractor 2.3.0 코드베이스 분석

## Sources

### Source 1: 원본 계획서
- 경로: `C:\Users\White\Documents\GitHub\Tsukuru_agent\Tsukuru Extractor Headless CLI 개조 계획 (a.k.a Tsukuru agent).md`
- Key points:
  - 핵심 변경 지점 3곳: `main.ts:299 extractor`, `apply.ts:14 apply`, `wolf/main.ts:11 wolfInit`
  - 서비스 분리: `RpgMakerService`, `WolfService` / 추상화: `ProgressSink`, `Logger`, `OperationError`
  - CLI: `tsukuru-agent run --request -|request.json`, 작업: verify/extract/patch/apply
  - stdout=최종 JSON only, 로그=stderr, 성공 exit 0
  - `Extract/manifest.json` 추가(안정 ID, SHA-256, 오프셋, 인코딩/널 종료)
  - patch는 `id`+`expectedHash`+`text`, 불일치 시 물변경
  - CLI 제외: 네트워크 업데이트, GUI 알림, 확장 프로그램 설치, 번역 엔진 실행
  - 프로파일: standard / full / advanced
  - GPLv3 기준 메타데이터 정리, electron-builder로 headless Windows exe 별도 빌드

### Source 2: 직접 소스 분석 (tsukuru_extractor-2.3.0)
- 경로: `...\Tsukuru_agent\tsukuru_extractor-2.3.0 source\tsukuru_extractor-2.3.0\`
- Key points: 아래 Synthesized Findings 참조

## Synthesized Findings

### 전역 상태 (globals.d.ts + 암묵 전역)
- 선언됨: `mwindow`, `settings`, `keyvalue`, `oPath`, `sourceDir`, `iconPath`, `WolfExtData`, `WolfEncoding`, `WolfCache`, `WolfMetadata`
- 암묵 전역(추가 분리 대상): `gb`(추출 버퍼, extract.ts), `externMsg`, `useExternMsg`, `externMsgKeys`(main.ts), `settingsWindow`, `externMsgKeys`
- → 모두 작업 Context로 이관 대상

### GUI 결합 지점 (제거/추상화 대상)
- `globalThis.mwindow.webContents.send(...)`: `loading`(진행률), `alert`/`alert2`(완료/오류), `worked`(작업 종료), `check_force`(덮어쓰기 확인)
- 경로 전달: `arg.dir`이 **base64 인코딩된 문자열** (CLI 계약의 `projectPath`는 평문 경로 → 디코딩 로직 제거)
- 진행률: extractor 0~100, wolf extract 0~50 + makeText 50~100, wolf apply 0~100
- `tools.packed` 분기(개발 모드에서만 `./test/ed.json` 덤프) — apply.ts:45

### RPG MV/MZ 흐름
- Extract(`main.ts:299 extractor`):
  1. dir 검증(data 폼더명, `arg.force` 없으면 check_force IPC)
  2. `arg.ext_plugin` 시 plugins.js → `ext_plugins.json` 생성
  3. ExternMessage.csv → `ExternMsgcsv.json`(settings.ExternMsgJson 분기)
  4. `.json.yaml` 임시 변환 → JSON
  5. `ExtTool.init_extract(arg)` → 파일별 `ExtTool.extract(file, conf, ftype)` → `format_extracted`
  6. `globalThis.gb`를 `Extract/*.txt`(ext_javascript는 .js)로 기록, `edTool.write`로 `.extracteddata` 작성
  7. `arg.decryptImg/decryptAudio` 시 `DecryptDir`
- Apply(`apply.ts:14 apply`):
  1. Extract/.extracteddata 존재 검사
  2. `!arg.instantapply` 시 Completed/, Completed/data, Completed/js 생성 (버그 주의: `.Completed` 오타 체크 후 `Completed` 삭제 — 28~41행)
  3. `edTool.read` → Backup JSON 로드 → Extract txt 라인을 `setObj`로 원본 구조에 삽입
  4. `arg.autoline`(얼굴 유무 80/60바이트 기준 줄바꿈), `arg.isComment`(주석 스킵), `arg.useYaml` 분기
  5. ext_plugins.json → plugins.js, ExternMsgcsv.json → ExternMessage.csv(`pack_externMsg`)
  6. `EncryptDir(img/audio, instantapply)` → **리소스 재암호화가 apply에 포함됨** (CLI에서 옵션 분리 필요)
- `.extracteddata`(MV): JSON → iconv utf8 → zlib deflate (`edtool.ts`). 읽기는 `{dat:{dat:...main}}` 중첩 언랩 루프
- `extract.ts` 주요 export: `setObj`, `init_extract`, `parse_externMsg`, `pack_externMsg`, `extract`, `format_extracted`, `DecryptDir`, `EncryptDir`
- `datas.ts`: `settings` 기본값, `onebyone`(파일→타입 매핑), `ignores`, 번역 가능 태그 목록

### Wolf 흐름
- `wolf/main.ts wolfInit`: IPC `wolf_ext`, `wolf_apply`
  - dir 정규화(Data/data 폼더 탐색), Data.wolf 존재 시 `wolfDecrypt`(globalThis.keyvalue 사용 가능성)
  - `globalThis.sourceDir = arg.folder`(게임 루트), `WolfExtData = []`
- `extractWolfFolder(DataDir, conf)`: .mps 전수 조사 → 버퍼를 `WolfCache[map]`에 저장 → `wolfExtractMap`/`wolfExtractMapPattern` → `extractEvent(...)`(WolfExtData에 push). CommonEvent.dat 처리는 주석 상태
- `makeText()`: `decodeEncoding`(WolfMetadata.ver===2 → Shift_JIS, 아니면 utf-8) → `\` 이스케이프 이중화 → 널 종료 시 `endsWithNull` → `_Extract/Texts/<extractFile>.txt` 작성 + `_Extract/.extracteddata`(msgpack+zlib: ext/cache/meta) 생성
- `wolfAppyier()`: `_Extract/.extracteddata` 읽기 → 파일별 누적 오프셋(totalOffset) 계산 → 길이(pos1~pos2 UInt32LE)와 원본 바이트(pos2~pos3) 검증 → 텍스트 교체·길이 갱신 → **원본 .mps에 직접 덮어쓰기** (계획서 요구: 복사본에만 적용 + 사전 바이트 검증 + 임시 디렉터리 쓰기로 변경 필요)
- `.extracteddata`(Wolf): msgpack 인코딩 → zlib deflate. **WolfCache(원본 바이너리 전체)를 포함**하여 파일이 큼

### 포맷 감지 힌트 (`select_folder` IPC, main.ts:265)
- `data` 폼더명 → MV/MZ 계열로 간주
- `www/data` 존재 → MV/MZ(배포형), `data` 존재 → 프로젝트형
- `Data.wolf` 존재 → Wolf
- → `format: auto` 판별 로직의 기반으로 재사용 가능

### 환경
- Node v24.14.0, npm 11.19.0 사용 가능
- **TypeScript가 devDependencies에 없음** — `tsc` 미설치. 컴파일 명령 확립 시 typescript를 devDependency로 추가 필요
- package.json: `"license": "MIT"` 이지만 **LICENSE 파일은 GPLv3** → 계획서대로 GPLv3으로 메타데이터 정정 필요
- 빌드: electron-builder 22.x, `build`(portable+nsis) / `build2`(portable) 스크립트 존재
- test 코드·test 스크립트 없음 (`!test/*` 빌드 제외 패털만 존재)

### CLI 계약 초안 (계획서 §CLI 계약)
```json
{
  "schemaVersion": 1,
  "operation": "verify|extract|patch|apply",
  "format": "auto",
  "projectPath": "C:\\Game",
  "outputPath": "C:\\Output",
  "profile": "standard",
  "options": {},
  "patches": []
}
```
- 결과 JSON: `ok`, `format`, `artifacts`, `stats`, `warnings`, `error`

### 위험·주의 사항
- `apply.ts` 28~41행: `.Completed` 존재 검사 후 `Completed`를 지우는 오타 로직 — 서비스 이전 시 의도적 수정 여부 결정 필요(호환성 노트에 기록)
- `wolfAppyier`는 원본 파일을 직접 변경 — CLI에서는 계획서대로 복사본 대상으로 변경하되, GUI legacy 동작과의 차이를 문서화
- `extractor`는 `arg.dir` base64 가정, `updateVersion` IPC가 `extractor`를 난수 옵션으로 재호출 — 서비스 분리 시 호출부 정리 필요
- `decodeEncoding`이 전역 `WolfMetadata` 의존 → Context 주입으로 변경

- Electron 22 + nodeIntegration: renderer 직접 Node 접근 — CLI는 Electron 없이 순수 Node로 동작해야 함

### v2.5 조사 기록 (2026-08-06)

#### 사용자 제공 포스트와 로컬 샘플 대조
- 포스트의 `npx asar extract app.asar app_extracted` → 수정 → `npx asar pack app_extracted app.asar` 절차는 Electron ASAR의 공식 CLI 흐름과 일치한다.
- ASAR는 암호화가 아니라 Electron 앱 파일을 묶는 읽기 전용 아카이브다. 따라서 원본 `app.asar`를 직접 수정하지 않고, 임시 추출본을 수정·검증한 뒤 새 아카이브를 복사본에 생성해야 한다.
- Arca 페이지 자체는 현재 웹 도구에서 열리지 않았으므로 댓글의 엔진 추정은 독립 근거로 사용하지 않는다. 사용자가 제공한 포스트 내용과 로컬 `app.asar` 검사를 교차 검증 기준으로 삼는다.

#### 실제 Electron/MZ 샘플 (사용자 제공 외부 fixture)
- `resources/app.asar` 존재, 약 796 MB, 아카이브 엔트리 약 2,631개. `resources/app.asar.unpacked`는 확인되지 않았다.
- 아카이브 내부가 단순한 MZ 루트가 아니라 `project/` 하위에 `data/`, `js/`, `assets/`, `effects/`를 둔 중첩 프로젝트다.
- `project/js/rmmz_core.js`, `rmmz_managers.js`, `rmmz_objects.js`, `rmmz_scenes.js`, `rmmz_sprites.js`, `rmmz_windows.js`, `plugins.js`, `project/js/plugins/ElectronForMz.js`가 확인된다.
- MZ 플러그인 약 76개 경로, JS 약 94개, JSON 약 242개, Live2D/Cubism 관련 경로 약 24개, Effekseer 관련 경로 약 2개가 확인된다.
- 따라서 이 샘플의 확정 분류는 `Electron + ASAR + nested RPG Maker MZ + ElectronForMZ/Live2D/Effekseer plugin stack`이다. GDevelop은 댓글의 가능성 중 하나일 뿐이며 이 샘플의 확정 엔진명으로 기록하지 않는다.

#### 웹 조사 결과
- Electron 공식 문서는 Windows/Linux 앱이 `resources/app.asar`에서 시작할 수 있고, ASAR의 파일은 읽을 수 있지만 아카이브 자체는 수정할 수 없다고 명시한다. `asar pack`, `list`, `extract` CLI도 공식 도구에 포함된다.
- Electron ASAR Integrity는 활성화된 빌드에서 아카이브의 헤더/블록 해시가 맞지 않으면 런타임 종료를 유발할 수 있다. v2.5 검증기는 무결성 메타데이터를 탐지하고, 재포장 후 갱신 여부를 결과에 표시해야 한다. 무결성 우회나 강제 패치는 기본 동작으로 삼지 않는다.
- electron-builder는 기본적으로 앱 파일을 ASAR에 넣고, 네이티브 모듈·실행 파일·대형/랜덤 액세스 리소스는 `app.asar.unpacked`로 분리할 수 있다. 따라서 컨테이너 검사는 `app.asar`만 보지 말고 `.unpacked`와 외부 `resources`도 함께 봐야 한다.
- GDevelop 공식 문서는 수동 데스크톱 내보내기가 Electron 프로젝트를 만들고 electron-builder로 `dist/win-unpacked`를 생성한다고 설명한다. 즉 GDevelop은 별도 포맷이라기보다 Electron 컨테이너 안에 HTML/JS/리소스를 넣는 엔진 프로파일로 취급해야 하며, 고정 파일명만으로 확정하지 않는다.
- ElectronForMZ 공식 저장소는 MZ 코어와 Electron/electron-builder를 함께 사용하고 `asar: true`, `project/` 하위 MZ 프로젝트, `ElectronForMz.js` 플러그인을 예시로 보여준다. 로컬 샘플과 구조적으로 일치한다.
- TyranoScript 공식 문서는 `data/scenario/*.ks`를 핵심 텍스트로 설명하고, 배포 때 스크립트/에셋 숨김 옵션과 동일 프로젝트 계층의 패치 생성을 제공한다. v2.5에서는 `data/scenario`, `data/system/Config.tjs`, `data/others/plugin`을 별도 후보로 인식하되 MZ/Wolf 바이너리 규칙에 섞지 않는다.
- NW.js 공식 문서는 `package.json`의 `main`을 기준으로 평문 폴더, `package.nw` zip, 또는 exe 뒤에 zip을 붙인 단일 실행 파일을 지원한다고 설명한다. RPG Maker MV 공식 문서도 Windows 배포가 게임 폴더 단위임을 설명하므로, `www/`와 `package.nw`/NW.js manifest를 별도 컨테이너 후보로 추가한다.

#### v2.5 설계 결론
- 감지 단위는 `format` 하나가 아니라 `container + engine + wrapper + features`의 진단 객체로 확장한다.
- 우선순위는 `loose directory → Electron app.asar → app.asar.unpacked/external resources → NW.js package.nw → unknown archive`이며, 엔진 판정은 각 컨테이너를 열어 본 뒤 수행한다.
- 추출 대상은 엔진 프로파일이 허용한 텍스트만 선택한다. `rmmz_*.js`, Electron main/preload, 플러그인 코드는 기본적으로 보호하고, 플러그인 문자열 추출은 `full/advanced`에서만 별도 표시한다.
- 적용은 항상 `copy → edit → repack → structural verify → optional launch probe` 순서다. 원본 해시 불변은 필수이며, `app.asar.unpacked`·외부 리소스·서명/무결성 정보는 별도 결과로 남긴다.
