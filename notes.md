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
