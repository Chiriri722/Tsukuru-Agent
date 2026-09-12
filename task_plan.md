# Task Plan: Tsukuru Extractor Headless CLI 개조 (a.k.a Tsukuru agent)

> **현재 계획 + 구현 이력:** 맨 위 D21 계획은 2026-09-13 검증을 반영합니다. 아래 초기 단계의 경로·체크박스·수치는 당시 기록입니다. hardening 구현은 별도 통합 작업트리에 있으므로 [작업 재개 안내](docs/current-state.md)의 실행 경로를 먼저 확인하세요.

## 현재 계획 — Daybreak 후속 검증 (2026-09-13)

**검증·계획 갱신 완료 / 아래 구현 작업은 미착수.**
실행 근거와 원 제안 7개의 대조표는
[Daybreak 후속 검증](docs/reviews/2026-09-13-daybreak-followup.md)에 있다.
기존 구현·릴리스 이력은 아래에 보존하고, 장기 단계는
[New-task-plan.md](New-task-plan.md)의 최신 상태와 연결한다.

### 확인된 기준선

- 보고서는 main `8c7d773`의 78개 로컬 테스트를 기준으로 했다.
  후속 구현 대상은 `chore/hardening-integration@80d2043` + 9월 8일 미커밋 수정이다.
  일반 경로의 main에는 이 구현이 아직 병합되지 않았다.
- 통합의 Backup JSON/없는 dataPath/비문자 대상은 이미 치명 오류이며,
  합성 3개 사례에서 작업본 바이트 보존을 확인했다. 같은 차단을 다시 구현하지 않는다.
- 제어코드 변경·이중 escape·빈 direct patch·U+FFFD·언어 잔존·101/401 괄호 불연속은
  통과했다. 해시 충돌 2개는 첫 ID만 보고하지만 그 실패에서는 쓰지 않는다.
- 추가 발견: 일반 RPG 사전 patch 이후 Backup 검사에서 apply가 실패하면
  Completed는 없지만 Extract/Actors.txt와 Extract/manifest.json의 선행 변경은 남는다.
- 조사 15개 사례 + 관련 기존 회귀 65/65 + TypeScript build 통과.
  실제 게임 품질이나 전체 suite를 이번에 재인증한 결과는 아니다.

### 우선 구현 작업과 완료 조건

- [ ] **D21-01 / P0 — 일반 RPG 사전 적용 전체 rollback.**
  사전 patch→재삽입→검증을 staging/transaction으로 묶는다.
  후속 오류·취소·출력 교체 실패에도 기존 작업본/출력/원본·Backup이 보존되어야 한다.
- [ ] **D21-02 / P0 — 공유 translation-lint.**
  원문 ID·Backup 출처를 대조하고 제어코드/자리표시자·새 빈 값/U+FFFD 손상을
  patch와 모든 RPG apply 진입점에서 검사한다. 정상 escape·플러그인 인수·의도한
  빈 값/원문 보존 정책을 회귀로 고정한다. 검사 불가를 성공으로 표시하지 않는다.
- [ ] **D21-03 / P0 — 최종 출력 공개 전 검사.**
  Backup+staged Completed 병합본을 구조 검사하고 실제 적용값·허용 dataPath 밖
  변경을 대조한다. 원본부터 있던 참조 warning은 유지하고 새 손상은 commit 전에 차단한다.
- [ ] **D21-04 / P1 — 사전 해시 충돌 일괄 진단.**
  전체 충돌 수·파일·ID를 모으되 상세 상한/생략 수를 둔다.
  기존 skip 통계·오류 계약과 충돌 시 무변경을 유지한다.
- [ ] **D21-05 / P1 — 101/401 메시지 연속성·언어 잔존.**
  이벤트/페이지/블록 경계를 지키며 여러 줄 괄호를 검사한다.
  인명·크레딧·의도한 따옴표 변경은 예외 근거를 남기고 의미 품질은 needs-review로 구분한다.
- [ ] **D21-06 / P1 — AppleDouble 후보 제외 정책.**
  사전 로더의 기존 제외를 유지하고 RPG JSON/YAML 등 파싱 후보에 일관되게 적용한다.
  archive 원본·provenance/hash·파일 수/크기 제한은 무조건 필터링하지 않는다.
- [ ] **D21-07 / P2 — 치명 오류의 파일/ID 문맥 보완.**
  parseBackup/setRpgDataPath 차단을 유지하면서 알 수 있는 파일·bucket·entry/dataPath를
  반환한다. 없는 ID를 만들거나 개인 경로/번역 전문을 노출하지 않는다.
- [ ] **D21-08 — 단계별 회귀 및 최종 수락.**
  원 제안 6의 fixture를 각 작업보다 먼저 RED로 추가한다.
  “제어코드 일치·일본어 0인데 의미만 다른 ID로 이동”은 자동 판별 한계 대조군으로 남긴다.
  구현 후 verify/order/benchmark와 영향받는 GUI·패키지 검증을 통과한다.

**실행 순서:** D21-01 → D21-02 → D21-03 → D21-04 → D21-05 → D21-06 → D21-07.
D21-08의 테스트는 마지막에 몰아서 작성하지 않고 각 단계에 포함한다.
구현 시작 시 공식 Spec-kit으로 별도 명세/설계를 구체화하고 기존 002 완료 기록을 보존한다.
후보 폴더 자동 발견은 읽기 전용 목록과 사용자가 선택한 후보의 명시적 전달부터 검토하며,
파일명만으로 최종본을 자동 선택·승격하지 않는다.

**완료 해석:** 구조 검증·토큰 보존·언어 잔존·의미 감수·실게임 실행은 서로 다른 결과다.
recover는 현재 해시/매핑을 재구축하므로 잘못 정렬된 번역을 복구했다는 증거가 아니다.
원문 ID 재정렬·언어 감수·실게임 복사본 확인 없이 “한글 패치 배포 완료”로 표시하지 않는다.

## Goal (초기 개조 이력)

Electron GUI에 강결합된 Tsukuru Extractor 2.3.0의 추출·적용 로직을 UI 없는 서비스 계층(`RpgMakerService`/`WolfService`)으로 분리하고, `tsukuru-agent run --request <file|->` 형식의 Headless CLI(verify/extract/patch/apply/recover)를 manifest 기반 안전성과 함께 제공한다. 기존 GUI는 동일 서비스를 호출하는 adapter로 유지한다.

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


## v2.5 Research & Plan (2026-08-06)

- [x] 사용자 제공 ASAR 포스트와 Electron 공식 문서 대조
- [x] 외부 Electron/MZ 샘플을 읽기 전용으로 검사하고 nested project 구조 확인
- [x] GDevelop, ElectronForMZ, TyranoScript, NW.js 변형의 공식 포장·파일 구조 조사
- [x] 정량 검증기·컨테이너 어댑터·엔진 프로파일 계획 작성
- [x] Phase 12: schema v2 및 ContainerAdapter/AsarContainer — 진단·선별 추출·provenance·CLI apply/repack 완료
- [x] Phase 13: deep verify, round-trip dry-run, 점수·변형량·스크립트 피해도 — MV/MZ JSON·참조·manifest, Wolf 바이너리, Tyrano KS/TJS·인코딩 구조 검증과 CLI 점수 연동 완료
- [x] Phase 14: nested MZ/ElectronForMZ, Tyrano, loose GDevelop 및 NW.js package.nw 실동작 파이프라인
- [~] Phase 15: synthetic archive fixture와 외부 fixture 회귀 — synthetic 및 사용자 샘플 읽기 전용 회귀 완료, 실제 샘플 자동 주입/apply는 명시적 요청 전까지 보류
- [x] Phase 16: 문서·빌드·v2.5 배포 검증 — README·release note·라이선스 고지와 headless 배포 재빌드 검증 완료

상세 계획: v2.5-validation-compatibility-plan.md
조사 메모: notes.md의 v2.5 조사 기록
현재 판단: 댓글의 GDevelop 추정은 확정하지 않고, 실제 샘플은 Electron ASAR + nested RPG Maker MZ + ElectronForMZ 계열로 분류한다.
## v2.5 implementation progress (2026-08-11)

- [x] v2 request compatibility: schemaVersion 1/2 수용, 새 format 후보와 diagnostics result 필드 추가.
- [x] Container core: loose directory, Electron app.asar, nested root 및 rpgmz/ElectronForMZ/GDevelop/Tyrano/Wolf marker 진단.
- [x] AsarAdapter 기본 흐름: staging extract → 별도 archive pack → required entry 재목록 검증. 원본 archive hash 보존 테스트 포함.
- [x] 정량 검증 코어: 가중 점수, risk, protected script damage, text/file byte diff, source/output directory snapshot.
- [x] CLI verify 연결: container/engine 진단, quick/deep 점수, outputPath 비교, humanSummary stderr와 stdout JSON 분리.
- [x] v2.5 synthetic tests와 기존 RPG/Wolf/GUI/CLI smoke를 node:test 회귀로 유지.
- [x] 코드 리뷰 보강: raw ASAR apply/patch 차단, 원본 트리 내부 pack 거부, manifest 경로 이탈 차단, symlink/junction 거부, 정확한 파일 수 제한.
- [x] 사용자 샘플에서 정상 2,519파일과 비정상 메타데이터 18개를 분리하고 `rpgmz + ElectronForMZ + Live2D/Effekseer`를 읽기 전용으로 실측 탐지.
- [x] `@electron/asar@3.4.1` 직접 의존성과 MIT 라이선스를 THIRD-PARTY-NOTICES에 반영(이후 fuse/resedit 포함 29 packages로 재생성).
- [x] ASAR 작업본 apply/repack: `.tsukuru-container.json` provenance, 명시적 `containerSourcePath`, source hash/engine/file-list 교차 검증, staging RPG apply, 번역 산출물 제거, 보호 스크립트 검증, 전체 게임 복사본 원자적 출력.
- [x] ASAR 보존 회귀: 원래 unpacked 엔트리 metadata를 정확히 재생성하고 `app.asar.unpacked`·외부 resources·실행 파일을 보존하며 malformed 원본의 유효 파일만 clean repack.
- [x] ASAR 안전 회귀: 변경된 원본, 보호 스크립트 변형, provenance traversal, 원본/작업본과 겹치는 출력, 기존 출력 충돌을 모두 출력 생성 전에 차단.
- [x] Electron runtime 진단: 실행 파일 선택, fuse wire, PE `INTEGRITY/ELECTRONASAR` SHA-256, Authenticode 상태, 비ASCII 경로 회귀 구현.
- [x] apply runtime gate: 무결성 fuse가 강제하는 ASAR 해시 불일치를 `E_RUNTIME_INTEGRITY`로 차단하고, opt-in launch probe는 별도 임시 게임 복사본에서만 실행.
- [x] 실제 사용자 샘플 읽기 전용 실측: fuse integrity disabled, embedded resource absent, Authenticode NotSigned, runtime apply blocker 없음, 원본 크기·수정시각 무변경.
- [x] Phase 13 구조 심화: Wolf offset·length prefix·null termination·UTF-8/Shift_JIS·원문 hash와 Tyrano KS 제어 태그·TJS delimiter·encoding을 issue code/위치와 함께 검증.
- [x] CLI verify 구조 연동: `validation` JSON 보고서, 실제 유효 매핑 비율 점수, stderr `validation=...` human summary 추가.
- [x] MV/MZ 심화 무결성: JSON parse/root type, DB id/index, Actor/Class/Skill/Enemy/Troop/CommonEvent/Map 핵심 참조, manifest line/hash/dataPath 검증.
- [x] Tyrano 전용 파이프라인: KS 대사 span extract, manifest patch, source snapshot dry-run verify, scenario-only copy apply, KS/TJS 재검증.
- [x] Tyrano 안전 경계: system/plugin manifest 위장 차단, 원본 변경 감지, Shift_JIS 손실을 `E_ENCODING_UNREPRESENTABLE`로 차단.
- [x] NW.js `package.nw` 컨테이너: ZIP 내부 목록/크기/링크/경로 검증, zip-slip 차단, staging extract, 별도 archive pack, required entry 및 원본 SHA-256 검증.
- [x] GDevelop 전용 파이프라인: `data.js`의 `gdjs.projectData`를 실행 없이 JSON 파싱하고 정적 Text/BBText 필드만 JSON Pointer manifest로 extract→patch→verify→copy-only apply.
- [x] NW.js + GDevelop E2E: `.tsukuru-container.json` provenance, 명시적 `containerSourcePath`, wrapper 복사, 보호 runtime 및 archive file-list 대조 후 새 `package.nw` 재포장.
- [x] 휴대용 RPG 작업 팩: `Backup` + `Extract/manifest.json`만 있는 외부 폴더 자동 탐지, Backup JSON 구조 검증, 미디어 추출물 없는 apply의 루트 System.json 오탐 제거.
- [x] Phase 15: 실제 번역 팩 읽기 전용 검증, manifest 기반 번역 사전 자동 patch/apply, 오래된 manifest 복구, 두 전체 게임 복사본 실행 프로브까지 완료. 원본 세 팩 집계 SHA-256 불변.
- [x] Phase 16: README·release note·third-party notices 갱신 및 headless zip 재빌드 검증 완료. 패키징된 app.asar에서 GDevelopService, adm-zip, THIRD-PARTY-NOTICES 포함 확인.
- [x] Phase 17 P0~P2: 사전 21,021항목 중 20,476 안전 적용(미등록 466·빈 값 2·동일 값 77 제외), manifest 9,112항목 복구(8,940 hash 갱신), 실게임 복사본 두 개 5초 실행 및 잔류 프로세스 0 확인.
- [x] Phase 17 P3: 원본부터 존재하는 끊어진 RPG map reference와 번역으로 유입된 손상의 기준선 비교·severity 분리.
- [x] Phase 17 P4: 컨테이너 사전 조립/단일 transaction과 recover dry-run·충돌 정책 구현.
- [x] Phase 17 P5: package lock·고지 점검과 결정적 CLI/NW.js ZIP의 최종 clean-build 재현성 증거 확정.

### Errors Encountered

- npm install --save @electron/asar는 현재 npm cache-only 네트워크 환경에서 ENOTCACHED로 실패. 기존 설치된 transitive @electron/asar 3.4.1을 직접 runtime dependency로 package.json에 고정하고 package-lock 해당 노드를 dev 플래그 없이 갱신.
- npm test/node --test는 기본 sandbox에서 child-process spawn EPERM이 발생한다. 승인된 비샌드박스 실행으로 현재 전체 78/78 통과를 확인했다.
- 실제 NW.js 실행 프로브에서 부모 종료 후 자식 Game.exe 5개가 남는 현상을 재현했다. Windows `taskkill /T /F`를 shell 없이 호출하도록 수정하고 분리 자식 회귀 및 실제 복사본 재검증에서 잔류 0을 확인했다.
- PowerShell ProcessStartInfo의 기본 stdin 인코딩으로 비ASCII 장경로가 손상될 수 있어 실전 배치에서는 UTF-8을 명시했다. CLI 자체의 UTF-8 JSON 입력 계약과 직접 경로 인수는 정상이다.
- ASAR statFile은 listPackage가 반환하는 선행 backslash를 그대로 넘기면 실패하는 Windows API 특성이 있어, 선행 구분자를 제거한 archive-relative path로 정규화.
- 실제 사용자 ASAR에는 물리 archive보다 큰 가짜 size/offset을 가진 18개 헤더 엔트리가 있어 기존 총 크기 제한이 오탐했다. 유효 offset 범위 검사와 selective extraction으로 정상 파일과 분리.
- Windows PowerShell 5.1은 비ASCII 실행 파일 경로의 Authenticode 상태를 빈 값으로 반환할 수 있어 PowerShell 7을 우선 사용하고 공식 SignatureStatus enum 회귀를 추가.

### Current verification commands

- `npm run compile` 통과
- `npm run typecheck -- --pretty false` 통과
- `npm test` 통과: 78 tests, 78 pass, 0 fail (비샌드박스 실행)
- `npm run build:cli` 통과: win-unpacked + `tsukuru-agent-2.5.0-win.zip` 재생성(98,353,504 bytes), 내부 package version 2.5.0·manifestRecovery·translationDictionary·runtimeDiagnostics/GDevelopService/adm-zip/@electron/fuses/resedit/THIRD-PARTY-NOTICES 포함 확인
- 빌드된 `tsukuru-agent.exe` smoke: stdout JSON parse 성공, verify 실패 exit code 1과 `E_VERIFY_FAILED` 계약 일치
- `node -e "require('./test/v25-core.test.js')"`, `v25-cli`, `v25-schema-detect` 개별 실행도 통과
- `node -e "require('./test/smoke-rpg.js')"`, `smoke-wolf`, `smoke-gui-adapter` 개별 실행도 통과

## Phase 18: Post-v2.5 hardening baseline (2026-08-19)

제안 원본: `New-task-plan.md` (`tsukuru-agent-post-v2.5-hardening`)

- [x] Phase 18.0: 기준선 재현과 증거 고정
  - [x] 제안서 전체 검토 및 로컬 정적 사실 대조
  - [x] 기존 구현 이력과 충돌하지 않도록 `task_plan.md`·`notes.md` 보존 결정
  - [x] 커밋 `17fa6e7`의 독립 clean worktree에서 install/typecheck/test/build 전후 상태 기록
  - [x] 추적 테스트와 ignored 테스트의 이력 및 실제 실행 개수 기록(61 tracked-only / 78 local-augmented)
  - [x] CLI 요청/응답, manifest, diagnostics의 최소 계약 스냅샷 고정
  - [x] `exfiles/` 외부 실행 파일의 이름·크기·SHA-256·라이선스 근거 기록(실행하지 않음)
- [x] Phase 18.1: 재현 가능한 하드닝 변경을 독립 단위로 진행
  - [x] lockfile-only: Node 24.14.0/npm 11.19.0 clean 생성본을 채택하고 `.gitignore` 한 줄과 `package-lock.json`만 별도 worktree에 구성.
  - [x] lockfile-only Exit Gate: `npm ci`, typecheck, compile, tracked 61/61, CLI package 및 실패/성공 계약 통과.
  - [x] build-chain: `.build/app` staging, 대상별 compile 선행, tracked source 무변경, 자기 output만 정리, `CLI→GUI→CLI` 오염 0건과 CLI byte 동일성 검증.
  - [x] version/identity: `package.json@2.5.0` canonical source, sync/check scripts, 현재 저장소 metadata·GUI 링크, 버전 기반 CLI ZIP 이름, ADR와 67/67 회귀 검증.
  - [x] 최소 CI: Ubuntu 검증·coverage·순서 교란과 Windows 검증·CLI 패키지 smoke·7일 artifact를 구성하고 workflow 계약을 고정.
- [x] Phase 18.2: 테스트 진실성·계약·fixture·archive/fuzz·선택형 corpus 체계.
  - [x] 23개 테스트 파일을 unit/contract/integration/e2e/helpers로 재구성하고 README inventory를 126개 검사와 자동 대조.
  - [x] 5개 operation 성공·실패 CLI snapshot, 오류 catalog, manifest/사전 경계, INV-01~INV-06 연결을 고정.
  - [x] 합성 fixture catalog, hostile archive/path, seeded Tyrano/Wolf fuzz, 실행 순서 교란과 단일 임시 루트 정리를 자동화.
  - [x] Node 내장 coverage 기준선(line 76.91%, branch 64.67%, function 77.98%)을 기록하되 안정화 전 threshold는 보류.
  - [x] private corpus 경로를 공개 결과에서 제거하는 수동 self-hosted compatibility workflow를 추가.
- [x] Phase 18.3: Electron GUI 보안 경계와 실제 preload/IPC 계약을 TDD로 재구성.
  - [x] 모든 창을 secure factory로 통합하고 `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, navigation/popup/webview 차단을 강제.
  - [x] typed preload bridge와 send/invoke/on allowlist, sender·payload·route·path·HTTPS host 검증, 구조화 오류를 구현.
  - [x] IPC 등록을 window/settings/project/operation handler 모듈로 나누고 `openFolder`를 handle/invoke로 전환.
  - [x] `changeAllString`과 구버전 번역 이식을 전체 `Extract` staging/commit/rollback 트랜잭션으로 전환.
  - [x] CSP·update timeout/offline·network 문서, 자식 프로세스/shortcut/Papago 종료 정리와 오류 경로 비노출 회귀를 추가.
  - [x] 실제 Electron에서 home/RPG/settings/Wolf renderer의 Node 비노출, RPG/Wolf 추출·적용 IPC, 설정 저장·닫기, 화면 전환을 통과.
  - [x] 안정화된 schema/path/transaction 파일에 line 70%·branch 50%·function 85%의 CI coverage gate를 활성화(실측 81.68%·64.26%·96.08%).
- [x] Phase 18.4: application/validator/container/transaction 경계 분해.
  - [x] `run.ts` 40개 함수와 의존성·파일/프로세스/ASAR side effect를 측정·기록하고 기존 5-operation CLI snapshot을 characterization 기준으로 고정.
  - [x] request 인수·stdin/파일 로딩·stdout 단일 JSON 직렬화를 주입 가능한 `entrypoint.ts`/`presenter.ts`로 이동.
  - [x] 5개 operation을 완전한 typed handler map으로 라우팅하는 독립 `dispatcher.ts`와 단위 계약 추가.
  - [x] human summary의 score·damage/integrity·runtime·validation 조립을 presenter로 이동해 `run.ts`의 직접 stderr 접근 제거.
  - [x] 엔진 capability/patch format/extract layout 불변 registry와 요청 포맷 compatibility matrix를 중앙 정책으로 분리.
  - [x] operation handler 실제 이동: extract/patch/apply/recover/verify를 독립 모듈로 이동하고 extract/apply/verify의 engine-family handler registry를 고정.
  - [x] `WorkspaceTransaction`의 conflict/force/backup/rollback과 성공 전 최종 경로 비노출 계약 구현; ASAR/NW.js extract·repack과 RPG/Wolf/Tyrano/GDevelop apply 출력에 적용.
  - [x] validator를 RPG/Wolf/Tyrano·score·report·protected-path·file-map 정책으로, container를 ASAR/NW.js/directory adapter·공통 archive 정책·registry·provenance로 분해.
  - [x] `docs/adr/0002-application-validation-container-boundaries.md`에 의존성 방향, provenance/transaction 순서, archive 불변 조건을 기록.
- [x] Phase 18.5: 버전 관리 계약, 명시적 runtime, 취소·timeout.
  - [x] request/result/manifest v1·v2, container provenance v1, engine options v2를 canonical JSON Schema 2020-12 문서와 static TypeScript type surface로 고정.
  - [x] operation/format discriminated union, v2 unknown-option 거부, detect 후 재검증, option 타입·범위·의존성 계약 구현.
  - [x] error/warning registry와 legacy `warnings` + v2 `warningDetails` 병행 호환 구현.
  - [x] schema example 8종·README JSON 4종 자동검증, ADR 0003, v2 migration guide 추가.
  - [x] module-level `activeContext` 제거, AsyncLocalStorage 호환 경계, explicit `OperationRuntime`과 logger/progress/fs/clock/temp/AbortSignal 주입.
  - [x] CLI SIGINT/SIGTERM·GUI cancel·operation timeout을 transaction rollback과 연결하고 순차·중첩·병렬·예외·no-partial-output 회귀 추가.
  - [x] `npm run verify`와 고정 seed `npm run test:order` 모두 39 files/198 checks 통과, generated/inventory drift 0.
- [-] Phase 18.6+: 공급망·성능·호환성·문서는 `New-task-plan.md`의 Phase 6 이후 게이트를 따른다.
  - [x] Phase 6 core: dependency/binary/asset inventory, bounded HTTP/process policy, notices, production audit 0, checksum·manifest·SPDX SBOM, 실제 CLI package smoke.
  - [!] Electron 23.3.13/electron-builder 26.15.7: builder major ladder 완료, full audit는 Electron 계열 high 2건. public binary release는 Electron 24 이후 major별 검증 완료까지 차단.
  - [x] Phase 7: 6개 엔진/container benchmark, progress·stage timing, diagnostics redaction/report, resource preflight, GUI worker·취소/종료 cleanup 완료.
  - [x] Phase 8A: directory-form `package.nw`의 opt-in provenance·round-trip 계약과 합성/기존 ZIP 회귀 완료. 실제 directory-form corpus 샘플은 미확인.
  - [x] Phase 8B: unsigned 단일 PE-appended ZIP opt-in round-trip과 signed/ambiguous 진단 전용 경계 완료.
  - [x] Phase 8C: Electron/GDevelop JSON Pointer apply, protected runtime, ASAR unpacked/resources 보존, malformed-ASAR opt-in 경계 완료.
  - [x] Phase 8D: Acorn AST 기반 `code*.js` opt-in profile, ambiguous report, source/span/callee 재검증, loose·ASAR·NW.js apply와 false-positive/rollback 회귀 완료.
  - [x] Phase 9: README·architecture·compatibility·SECURITY·CONTRIBUTING·오류 reference·maintenance/release checklist·canonical changelog 동기화와 clean install/package evidence 완료.

### Phase 18 Decisions

- `New-task-plan.md`는 외부 제안서 원본으로 유지하고, 실제 진행 상태는 기존 단일 이력인 `task_plan.md`에 기록한다.
- Phase 0과 Phase 1을 한 번에 구현하지 않는다. 깨끗한 체크아웃에서 재현된 증거를 먼저 고정한 뒤 첫 변경 단위를 결정한다.
- ignored smoke 테스트가 포함된 현재 작업 트리의 78개 통과 기록과 clean checkout의 추적 테스트 결과를 별도 지표로 취급한다.
- GUI build 입력에서 `dist-cli/**`가 제외되지 않아 CLI 산출물 77개가 GUI ASAR에 재포장되는 순서 오염을 Phase 18.1 build-chain의 필수 회귀로 추가한다.

### Phase 18 Errors Encountered

- `agbrowse web-ai send`가 0.2.0의 ChatGPT surface preflight에서 `capability.unsupported`로 안전 중단됨. 정확한 기존 대화 URL과 Pro 모델을 화면에서 재검증한 뒤 일반 브라우저 입력으로 폴백했다. 전역 CLI 0.2.1 업데이트는 사용자 승인 없이 수행하지 않았다.
- 일반 브라우저 입력의 최초 element ref가 화면 갱신으로 만료되어 전송되지 않음. 새 snapshot으로 입력창을 다시 식별한 뒤 전송했다.
- Phase 18.5 초기 manifest v1 schema가 과거 최소 RPG/Wolf 엔트리에 v2 필드를 요구해 Wolf 진단과 경로 탈출의 기존 오류 코드를 가렸다. v1만 최소 필드로 완화하고 v2 strict 계약은 유지했다.
- Phase 18.5 테스트 추가로 README/CI inventory가 35/175에서 일시적으로 뒤처졌다. 실제 전체 결과 39/198로 동기화하고 drift 검사까지 통과했다.

### Phase 18 Status

**과거 Phase 18 체크포인트:** 당시 47개 테스트 파일/242개 검사와 Electron/builder ladder, P3~P5 clean matrix를 추적했다. 이후 결과는 날짜별 기록으로 남아 있으며 이 문단을 현재 상태로 사용하지 않는다. 2026-09-08 대조 결과, 구현은 `chore/hardening-integration@80d2043`에 커밋되어 있고 58개 파일·388개 top-level 선언·395개 실행 검사가 통과한다. main 미병합 상태와 새 patch 매핑 결함은 [작업 재개 안내](docs/current-state.md)에 기록했다.
