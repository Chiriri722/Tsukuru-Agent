# Task Plan: Tsukuru Extractor Headless CLI 개조 (a.k.a Tsukuru agent)

## Goal
Electron GUI에 강결합된 Tsukuru Extractor 2.3.0의 추출·적용 로직을 UI 없는 서비스 계층(`RpgMakerService`/`WolfService`)으로 분리하고, `tsukuru-agent run --request <file|->` 형식의 Headless CLI(verify/extract/patch/apply)를 manifest 기반 안전성과 함께 제공한다. 기존 GUI는 동일 서비스를 호출하는 adapter로 유지한다.

## 원본 계획서
`C:\Users\White\Documents\GitHub\Tsukuru_agent\Tsukuru Extractor Headless CLI 개조 계획 (a.k.a Tsukuru agent).md`

## 대상 소스
`C:\Users\White\Documents\GitHub\Tsukuru_agent\tsukuru_extractor-2.3.0 source\tsukuru_extractor-2.3.0\`

## Phases
- [x] Phase 1: 계획·환경 설정 및 기준(baseline) 확보
  - 작업용 소스 트리 확정(원본 보존 여부 결정), `npm install`, TypeScript 컴파일 명령 확립
  - CLI 제외 기능 목록 확정(네트워크 업데이트, GUI 알림, 확장 프로그램, 번역 엔진)
  - 기존 GUI 동작 기준점(Extract/Backup/Completed/.extracteddata 산출물 형태) 기록
- [x] Phase 2: 코어 추상화 계층 구현
  - `ProgressSink`, `Logger`, `OperationError` 인터페이스 정의
  - 작업 Context 타입 정의(RPG: settings/gb/externMsg 대체, Wolf: WolfMetadata/WolfExtData/WolfCache/sourceDir)
  - CLI 요청/결과 스키마 타입(schemaVersion 1, ok/format/artifacts/stats/warnings/error)
- [x] Phase 3: RpgMakerService 분리 (MV/MZ)
  - `main.ts:299 extractor` → `RpgMakerService.extract` (GUI IPC·전역 상태 제거)
  - `apply.ts:14 apply` → `RpgMakerService.apply` (webContents.send 제거, Context 주입)
  - extract.ts의 `globalThis.settings/gb/externMsg` 의존을 Context로 이관
  - fileCrypto.ts mwindow 의존 제거, main.ts/apply.ts thin adapter 재배선, 합성 fixture extract→apply round-trip 스모크 통과(`test/smoke-rpg.js`: SMOKE OK)
- [x] Phase 4: WolfService 분리
  - `extractWolfFolder`, `makeText`, `wolfAppyier`를 `WolfService`로 이동
  - `WolfMetadata`, `WolfExtData`, `WolfCache`, `sourceDir`를 전역 → Context 필드로 이관(9개 로직 파일 ctx() 치환, globalThis/mwindow 0건 확인)
  - `.extracteddata`(msgpack+zlib) 읽기/쓰기의 Context 기반 재구현
  - wolf/main.ts thin adapter 재작성, 합성 .mps 바이너리 fixture로 extract→apply round-trip 스모크 통과(`test/smoke-wolf.js`: SMOKE OK, 오프셋·길이 필드·널 종료 검증)
- [x] Phase 5: Manifest 및 안전성 구현
  - `Extract/manifest.json` 생성: 안정 ID, 원본 파일/데이터 경로, 추출 텍스트 줄 범위, 원문 SHA-256, MV 메타/Wolf 오프셋, 인코딩·널 종료 여부
    - 빌더: `src/core/manifestBuild.ts`(RPG: gb의 origin/val/originText / Wolf: extData+오프셋, 해시=txt 표기 원문의 UTF-8 SHA-256)
    - extract.ts에 qpath 보존 필드 추가(.extracteddata에 additive 필드, 하위호환)
  - Wolf 적용 전 원본 바이트·오프셋·길이 검증: 기존 skip 로직을 `WolfApplyResult{applied,skipped}` 수집 반환으로 개선, 서비스가 경고 로그
  - 원자적 쓰기: `src/core/atomic.ts`(atomicWriteFileSync: 임시 파일+rename / makeStagingDir+replaceDirSync: 스테이징→교체, 실패 시 롤백). manifest·wolf 바이너리·Completed 트리에 적용
  - 스모크 2종에 manifest 단언 추가, 전체 통과(RPG 45 entries / Wolf 1 entry, 해시·줄 범위·오프셋 검증)
- [x] Phase 6: CLI 진입점 구현
  - `tsukuru-agent run --request -` / `--request request.json` 파서(`src/cli/main.ts`, stdin/파일 모두 지원)
  - `verify`: 읽기 전용 검사(포맷·경로·manifest·매핑·출력 조건) — 이슈 수만큼 warnings, 실패 시 E_VERIFY_FAILED
  - `extract`: 원본 보존 + Extract/Backup/.extracteddata/manifest 생성, 기존 산출물 시 E_EXTRACT_EXISTS(options.force로 우회)
  - `apply`: MV/MZ는 Completed 출력(outputPath 시 사본 추가, 존재 시 E_OUTPUT_CONFLICT), Wolf는 dataDir 사본에만 적용(`WolfService.applyToCopy` + wolfAppyier reroot, 기본 출력 `<게임 루트>/Completed`, 원본 무손상 검증됨)
  - stdout=최종 JSON만(레거시 console을 stderr로 리다이렉트), 로그=stderr, 성공 exit 0 / 실패 exit 1
  - format auto 판별: `src/cli/formatDetect.ts`(Wolf 마커 우선 → MV/MZ → projectPath 자체). `test/smoke-cli.js` 전 항목 통과
- [x] Phase 7: patch 작업 구현
  - `id`, `expectedHash`, `text` 입력 검증, 불일치·중복 ID·매핑 손상 시 무변경 실패
  - 추출 작업본만 수정, 여러 줄 치환 후 manifest/.extracteddata 줄 매핑 재생성(delta walk: RPG gb cid/m 재구성, Wolf textLineNumber 재구성, 해시 재계산)
  - 구현: `src/cli/patcher.ts`(사전 전수 검증 후에만 쓰기, 모든 기록 원자적). 오류 계약: E_PATCH_EMPTY/DUPLICATE_ID/NOT_FOUND/HASH_MISMATCH, MAPPING_CORRUPT. smoke-cli에서 1줄→2줄 치환 + 후속 항목 이동 + patch→verify→apply round-trip 검증 통과
- [x] Phase 8: GUI adapter 회귀 정합
  - 기존 Electron IPC(`extract`, `apply`, `wolf_ext`, `wolf_apply`)가 서비스 계층 호출로 교체(Phase 3~4에서 thin adapter로 재배선 완료)
  - `instantapply`는 legacy adapter로만 유지 (CLI v1 원본 덮어쓰기 미제공 — 서비스 RpgApplyOptions.instantapply는 GUI adapter 경로에서만 사용)
  - GUI IPC 결과가 기존 동작과 동일한지 회귀 테스트: `test/smoke-gui-adapter.js` 통과(mock mwindow로 apply adapter 검증 — 누락 Extract 시 기존 한글 안남문+worked(0), 성공 시 alert2/loading/worked 유지, 진행률 IPC 전달). extract/wolf adapter는 electron ipcMain 의존으로 Node 로드 불가 → 컴파일+구조적 동일성으로 커버(한계 기록)
- [x] Phase 9: 프로파일·호환성
  - `standard`: renderer.ts 기본값 확인 결과 GUI는 모든 확장 플래그 off → standard = 확장 플래그 없음(기본 추출만). `full`: ext_note+ext_src+ext_javascript+ext_plugin+exJson 활성화(플러그인·스크립트·노트·추가 JSON). `advanced`: options 객체를 RpgExtractOptions/Wolf config로 그대로 전달(의미 기반 옵션) + force 보존
  - 기존 Extract/Backup/Completed/.extracteddata/TXT 형식 호환 확인: 스모크 3종이 기존 산출물 형식(.extracteddata zlib+iconv / wolf msgpack+zlib / TXT 줄 매핑)으로 round-trip 검증. standard 변경으로 CLI extract entries 45→43(노트 off, GUI 기본과 동일 동작)
- [~] Phase 10: 테스트 (부분 완료)
  - 실제 MV/MZ 프로젝트·Wolf 프로젝트 fixture 확보 — **미해결(Key Question 3)**: 현재 합성 fixture(rpgmv-basic 정적 JSON + 스크립트 생성 .mps 바이너리)로 커버, 실제 프로젝트 확보 시 round-trip 확장 필요
  - 포맷별 extract→patch→apply→verify round-trip: 스모크 4종으로 검증 완료
  - 오류 케이스: 경로 오류(E_PATH_NOT_FOUND), 기존 산출물(E_EXTRACT_EXISTS), 손상 manifest(E_MANIFEST_CORRUPT·파싱), stale hash(E_PATCH_HASH_MISMATCH+묵변경), 줄 수 변경(1→2줄 매핑 재생성), Wolf 바이트 불일치(skipped 수집), 출력 충돌(E_OUTPUT_CONFLICT) — 모두 smoke-cli에서 검증
  - 명시적 TypeScript 컴파일·Node 테스트 명령 추가: `npm run compile`/`typecheck`/`test`(node --test 자동 탐색 4/4 통과)/`agent`. 잔여: 스모크의 node:test 형식 정식 전환(단언을 test() 블록으로 구조화)
- [x] Phase 11: 빌드·배포
  - electron-builder로 GUI 없는 headless Windows 실행 파일 별도 빌드: `electron-builder.cli.yml`(별도 구성: extraMetadata.main=src/cli/electronMain.js, asar, files에 CLI·core·js·LICENSE·NOTICE·THIRD-PARTY-NOTICES), `npm run build:cli`. CLI 실행기를 `src/cli/run.ts`(runAgent)로 분리하고 Node용 `main.ts`·Electron용 `electronMain.ts` thin 엔트리 구성
  - 배포 형태 결정: **zip**(dist-cli/tsukuru-agent-2.0.0-win.zip, 93.6MB) — nsis portable 래퍼는 래퍼 체인에서 stdout/stderr 유실로 CLI 파이프 사용 불가임을 실측(포터블 exe 빌드 후 폐기). 압축 해제형 exe는 실측으로 stdout JSON·exit code 정상(실제 프로젝트 verify ok, 32,248 entries)
  - GPLv3 LICENSE 기준 package metadata·의존성 고지 정리: license MIT→GPL-3.0-only 정정, bin.tsukuru-agent 추가, NOTICE.md 작성, `scripts/generate-notices.js`로 THIRD-PARTY-NOTICES 생성(26개 패키지)

## Key Questions
1. 작업 위치: 원본 소스 트리를 직접 개조할 것인가, 작업용 복사본/새 폴터에서 진행할 것인가?
2. CLI 런타임: 순수 Node(ts-node/컴파일 JS) 진입점 + pkg형 패키징 vs electron-builder headless exe(계획서는 electron-builder 지정)?
3. 테스트 fixture: 로컬에 사용 가능한 실제 MV/MZ·Wolf 프로젝트 경로가 있는가?
4. Wolf 출력 위치: `apply` 시 "게임 복사본"의 기본 경로 규칙을 무엇으로 할 것인가? (예: `<game>_Completed`)
5. `format: auto` 판별 규칙: MV/MZ(data/*.json+www 구조) vs Wolf(Data.wolf/.mps) 감지 순서 확정 필요.

## Decisions Made
- 계획 문서 위치: 프로젝트 루트(`C:\Users\White\Documents\GitHub\Tsukuru_agent\`)에 생성 — 실제 작업 대상이 이 디렉터리이며 CWD(`_tmp\Output-game`)는 무관한 프로젝트이므로.
- 저장소 이전(2026-08-03): 작업 결과물이 GitHub 저장소 [`Chiriri722/Tsukuru-Agent`](https://github.com/Chiriri722/Tsukuru-Agent)(로컬 `C:\Users\White\Documents\GitHub\Tsukuru Agent\Tsukuru Agent\`)로 이전·공개됨. 이 문서 내 기존 절대 경로(`...\Tsukuru_agent\work\...`)는 이전 당시 기록이며, 현재 앱 경로는 `<repo>\tsukuru-agent\`, 계획·분석 문서는 저장소 루트에 있음.
- 분석 기준 커밋/버전: tsukuru_extractor 2.3.0 소스(압축 해제본)를 기준으로 함.
- 작업 위치(2026-08-02 사용자 결정): **작업용 복사본** `C:\Users\White\Documents\GitHub\Tsukuru_agent\work\tsukuru-agent\`에서 진행. 원본 2.3.0 소스 트리는 참조용으로 보존(수정 금지).
- CLI 런타임: 계획서 지정대로 electron-builder headless exe를 최종 산출물로 하되, 개발·테스트는 순수 Node(컴파일된 JS) 진입점으로 수행.
- TypeScript 버전: 5.5.4 고정(최신 7.0.2는 신규 네이티브 코드베이스라 구형 Electron 프로젝트에 위험). baseline `tsc --noEmit` 0 errors 확인.
- 장시간 명령(npm install 등): 30초 셸 타임아웃 회피를 위해 Start-Process 백그라운드 + 로그 폴ling 패턴 사용.
- Context 전달 방식: extract.ts 등 심층 로직의 전면 매개변수화 대신 **명시적 Context 홀더**(`src/core/context.ts`의 `setActiveContext`/`ctx()`) 사용. 기존 동작 동일성을 기계적 치환으로 보장하고, GUI/CLI 모두 프로세스당 1작업 모델과 일치. 서비스 메서드 진입 시 setActiveContext 호출.
- Phase 3에서 GUI 재배선 선행 포함: extract.ts를 ctx() 기반으로 바꾸면 기존 GUI 경로가 깨지므로, main.ts/apply.ts를 서비스 호출 thin adapter로 함께 전환(IPC 회귀 테스트는 Phase 8에서 검증).
- RpgMakerService.apply의 `Completed` 처리: 기존 코드의 `.Completed` 오타 로직(사실상 미삭제)을 의도 수정하여 항상 재생성 — CLI 출력 결정성 필요(notes.md 참조). GUI 영향: Completed가 매번 새로 생성됨(원본·Extract·Backup 무손상).
- decrypter.ts headless 대응: extentions(electron 의존)를 lazy require로 변경, 해석 실패 시 복호화 미설치 처리(경고 후 계속 — 기존 건너뜀 동작과 동일). CLI는 확장 설치·네트워크 미수행 원칙 유지.
- applyWolf.ts 잠재 버그 수정: msgpack round-trip 후 cache가 Uint8Array가 되어 readUInt32LE/writeInt32LE 불가 → `Buffer.from(ctx().wolf.cache[...])`로 복원. 이 버그와 wolf_apply의 _Extract 경로 불일치(sourceDir 규칙 차이)로 GUI wolf apply는 2.3.0에서 사실상 동작 불가였을 것으로 추정(notes.md). 서비스는 기존 경로 규칙을 유지하고, CLI 요청 계층에서 extract/apply 경로를 정규화해 일관성 확보(Phase 6).

## Errors Encountered
- `npm install` 전경 실행이 30초 셸 타임아웃으로 중단: Start-Process 백그라운드 실행 + 로그 폴ling 방식으로 전환(로그: `work\npm-install.log`, `work\npm-install-err.log`). 장시간 명령은 모두 이 패턴을 사용.
- `npx tsc` 미설치 상태에서 실행 시 "This is not the tsc command you are looking for"(tsc 오해 소지 패키지): typescript를 devDependency로 명시 설치 필요(notes.md 환경 섹션과 동일 결론).
- `[System.IO.File]::ReadAllText`에 상대 경로 전달 → .NET은 PowerShell 위치가 아닌 프로세스 CWD(`_tmp\Output-game`) 기준으로 해석하여 DirectoryNotFoundException: PS에서 .NET 정적 파일 API 사용 시 **항상 절대 경로** 사용(파일은 미변경 상태로 확인 후 재실행).
- npm install 완료 후 `require('./src/core/schema.js')` MODULE_NOT_FOUND: 같은 run_commands 배치의 tsc emit과 node 스모크 테스트가 **동시 실행**되어 emit 전에 require 시도. 파일 생성 확인 후 재실행으로 해결 — 이후에는 컴파일과 테스트를 분리 실행.
- PS 리터럴 히어스트링(`@'...'@`) 내 작은따옴표 이중화(`''utf8''`)가 그대로 파일에 기록되어 main.ts 구문 오류: 리터럴 히어스트링은 이스케이프를 처리하지 않음. editor 도구로 정정 — **한글 없는 코드도 PS 히어스트링 대신 editor 도구 사용**이 안전.
- RpgMakerService.ts 8,998자 단일 생성 시도 → editor 6,000자 제한 초과: 3~4천 자 청크 + 자리표시자(`// __PART__`) 분할 패턴으로 작성.
- headless `node test\smoke-wolf.js` 실행 시 `Electron failed to install correctly`: WolfService→decrypter→extentions 체인이 모듈 로드 시 electron을 요구. ELECTRON_SKIP_BINARY_DOWNLOAD=1 환경에서는 electron 패키지 로드 자체가 실패 → decrypter를 lazy require로 수정하여 해결.
- patternBased.ts에 ctx import 누락(TS2304): PS 치환 앵커가 세미콜론 포함 `from "./io";`였으나 실제는 무세미콜론 — 앵커 문자열은 파일마다 정확히 확인 필요.
- smoke-wolf 크기 단언 오류(190 !== 187): '안녕하세요'를 4자로 착각(실제 5자=15바이트)하여 기대값 산정 실수. 코드는 정상이었으며, 번역문을 '안녕'(7바이트)으로 바꿔 오프셋 조정까지 검증하도록 테스트 수정.
- editor 도구 old_text 불일치 다수(applyWolf.ts): PS 치환 시 삽입한 CRLF와 원본 LF가 혼재하는 **혼합 줄 끝**이 원인. 전체 수정 파일을 LF로 일괄 정규화하여 해결 — PS로 파일에 개행을 삽입할 때는 기존 줄 끝과 통일하거나 사후 정규화 필요.
- editor 도구가 특정 한글 음절('너')을 반복 깨뜨림(걷�뜀/건�뛴): 원인 불명 — 해당 위치는 영문 주석/로그로 대체. 한글 문자열 작성 후에는 diff로 실제 기록 내용을 반드시 확인.
- verify 오판 "추출 텍스트 파일이 없습니다": manifest의 RPG extractFile이 `Extract/` 접두사 포함이라 verify가 extractDir과 이중 결합 — extractFile 기준을 **추출 디렉터리 상대**로 통일(RPG `Actors.txt`, Wolf `Texts/map.txt`)하여 해결.
- opVerify의 .extracteddata 경로 오류: RPG는 data 폼더, Wolf는 _Extract 날� — 포맷별 분기로 수정.
- `node --test test/` 실패(MODULE_NOT_FOUND, 빈 requireStack): Node 24가 `test/` 인수를 모듈로 해석 — `node --test`(자동 탐색)로 변경하니 4/4 통과.
- task_plan.md Phase 7 체크박스 편집 2회 실패: old_text의 '묵'(U+BB34)을 '물'(U+BB3C)로 반복 오타 — 파일 읽기 결과에서 정확한 문자를 복사하지 않고 기억에 의존한 것이 원인. 문제 단어를 포함하지 않는 앵커로 분할하여 해결.
- nsis portable exe(stdout/stderr 유실, exit=1 무출력): 포터블 래퍼가 자식 프로세스 체인에서 stdio를 전달하지 않음. win-unpacked exe로 동일 요청 시 정상 출력 확인 후 **zip 타겟으로 전환**(결정 기록).
- Start-Process -ArgumentList에 공백 포함 경로 전달 시 분할 오류(ENOENT 'C:\\...\\Tsukuru'): 배열 인수는 quoting 없이 결합됨 — 인수 문자열을 변수로 만들고 경로를 큰따옴표로 감싸 전달. 이후 node -e 인라인 요청 생성 2회도 PS 이중 인용 문제(TerminatorExpectedAtEndOfString)로 실패 → 요청 JSON은 editor로 파일 작성이 안전.
- `npm test` 스크립트 `node --test test/`는 환경에 따라 모듈 해석 오류 — `node --test`(자동 탐색)로 확정(이전 기록 참조).


**후속(2026-08-03)**: 원격 푸시 완료(5df0d4f..7e34c58). dist-cli 빌드 산출물은 git 추적 제외 정책 확정 → 배포는 GitHub Release(v2.0.0, zip 첨부)로 전환. git 이력 전 구간에 검증 프로젝트명·원본 경로 잔재 없음(git grep 스캔 CLEAN).

**삽입 테스트 완료(2026-08-03, 두 번째 실제 MV 프로젝트)**: 번역 에이전트 산출물(완성 JSON 57개, 자체 보고 번역률 92.1%)을 게임 `www/data/`에 직접 덮어쓰기 방식으로 적용(CLI patch/apply 경로 아님). 절차: ① 독립 사전 검증 — 57/57 파싱·구조 동등성(루트 배열 길이·키 집합·타입) 일치(tmp/validate-insert.js) ② 원본 백업 — `_work/backup/pre-insert-20260803/data` 64/64 SHA-256 일치 ③ 삽입 — 57/57 해시 일치 ④ 사후 검증 — 게임 data/ 64/64 파싱 OK, 미대상 7파일(Animations·Tilesets·빈 맵 4·ContainerProperties) 원본 동일, `._*` 부산물 0, 한국어 텍스트 대량 확인(MapInfos 한글 220/가나 1, CommonEvents 한글 38,138/가나 140 — 잔여 가나는 보고된 의도적 코드성 보존분). 남은 것: 실제 게임 실행 플레이테스트(사용자 수동, Game.exe). 저장소에는 프로젝트명 미기재(비공개 원칙 유지).
- git push 원격 거부(GH001, pre-receive hook): `dist-cli/` 빌드 산출물 73개가 커밋에 포함(150MB exe > GitHub 100MB 제한, 93.6MB zip > 50MB 권장). 원인은 .gitignore에 `dist/`만 있고 `dist-cli/`가 누락된 것. `git reset --soft HEAD~2` → `git rm -r --cached dist-cli` → .gitignore 보강 → 단일 커밋(7e34c58)으로 재작성 후 push 성공. 부수 효과: 미푸시 상태에서 재작성되어, 이전 커밋 task_plan.md에 남아 있던 검증 프로젝트명이 **전체 이력에서 완전 제거**됨(git grep 패턴 파일 스캔 CLEAN 확인).

## Status
**전 Phase 완료(1~9, 11) + Phase 10 부분 완료(2026-08-03)** — 실제 프로젝트 검증: standard extract 118txt/29,671 entries/6.0MB/4.4s, verify·patch(2건)·apply(118파일/3.3s) 통과, Completed 한글 반영·Backup 원본 보존·I:\ 원본 무손상 확인. full 프로파일: 123파일/32,248 entries(ext_plugins·ext_scripts·ext_javascript·ext_note 생성, verify ok). **Phase 11 완료**: headless exe(zip, 93.6MB) 빌드·실측(verify ok, stdout JSON·exit code 정상), THIRD-PARTY-NOTICES 26개 패키지. **잔여 선택 작업**: 스모크의 node:test 정식 전환, 번역 완료 후 실제 삽입(apply) 테스트(사용자 진행 예정), pkg/SEA 등 더 가벼운 단일 exe 대안 검토(nsis portable은 stdio 유실로 부적합 판정).
