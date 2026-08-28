# Task Plan: GUI 디자인 개선 · 렌더러 보안 하드닝 (001-gui-design-hardening)

- 작성일: 2026-08-28
- 대상 레포: `C:\Users\White\Documents\GitHub\Tsukuru Agent\Tsukuru Agent`
  (branch `main`, HEAD `4b0741f`. 코드 작업트리 clean — `git status --porcelain` 은
  이 계획서 폴더 `?? specs/` 만 보고한다)
- 상태: **계획 수립 완료 / 구현 미착수** (T001–T035 전부 미시작)
- 코드베이스 메모리 프로젝트: `tsukuru-agent-design-audit-20260828` (1420 nodes / 3595 edges, mode=moderate)
- 디자인 기준: `C:\Users\White\.kiro\skills\` 의 `emil-design-eng`, `animate`,
  `find-animation-opportunities` (Emil Kowalski 디자인 엔지니어링 철학)
- 규약 기준: spec-kit (`specs/NNN-slug/tasks.md`), 참조 구현체
  `C:\Users\White\Documents\GitHub\S-MCP\specs\001-agent-scrivener-control\tasks.md`

---

## 0. 한 줄 요약

이 레포의 **CLI/서비스 계층은 건강하다** (78/78 통과, `tsc --noEmit` 클린). 문제는
전부 **Electron GUI 쪽**에 몰려 있다. 그리고 GUI에서 가장 먼저 고쳐야 할 것은
"예쁘게 만들기"가 아니라 **디자인 결함의 근본 원인이 되는 3가지 배선 오류**다 —
투명 서페이스 토큰, IPC 이후에야 도착하는 테마, 그리고 5ms마다 DOM을 다시 쓰는
i18n 루프. 이 3개를 고치지 않으면 그 위에 올리는 모션·포커스 스타일은 전부 지워진다.

동시에 **렌더러에 RCE 경로가 열려 있다**: `nodeIntegration: true` +
`contextIsolation: false` 창에 `https://unpkg.com` 원격 스크립트를 CSP 없이 로드한다.
디자인 작업과 같은 파일(`simple/index.html`, `wolf/index.html`)을 건드리므로
**Phase 0에서 함께 닫는다.**

---

## 1. 사전 조건 (실측 확인 상태)

| 구분 | 항목 | 필수 이유 | 실측 상태 (2026-08-28) |
| --- | --- | --- | --- |
| 레포 | `Tsukuru Agent` 본체 | 작업 대상 | 있음. `git status --porcelain` 출력 없음 = clean. 추적 파일 144개 |
| 도구 | Node.js 18+ / `node_modules` | 빌드·테스트 | `tsukuru-agent/node_modules` 존재 |
| 도구 | TypeScript 5.5 (`npx tsc`) | 타입 게이트 | `npx tsc --noEmit` → **exit 0** |
| 도구 | `node --test` | 회귀 게이트 | **78 tests / 78 pass / 0 fail**, duration 12.67s |
| 도구 | **sass 컴파일러** | `.scss` → `.css` | **없음.** `package.json` 에 `sass`/`node-sass` 의존성 없음, `scss` 스크립트 없음 → **T004에서 도입 필요** |
| 도구 | codebase-memory | 그래프·복잡도 근거 | `tsukuru-agent-design-audit-20260828` ready |
| 도구 | spec-kit 규약 | 산출물 형식 | 이 레포에는 `.specify/` 없음. 형식만 차용 (`specs/001-*/tasks.md`) |
| 자산 | Electron 실행 환경 | GUI 육안 검증 | `npm start` 존재. **미실행 — §7 Q1** |
| 자산 | 실물 RPG MV/MZ 프로젝트 | GUI E2E 검증 | `fixtures/rpgmv-basic/www` (합성). 실물 프로젝트는 미확보 |

> **차단 위험:** GUI 시각 검증은 사람 눈이 필요하다. T0xx의 "feel-check" 항목은
> 코드 리뷰로 통과 처리하지 않고 §6 게이트 G5에서 별도 확인한다.

---

## 2. 검증된 베이스라인 (회귀 판단 기준)

이 숫자보다 나빠지면 회귀다.

| 지표 | 값 | 확인 명령 |
| --- | --- | --- |
| 테스트 | 78 pass / 0 fail (10개 파일) | `cd tsukuru-agent; node --test` |
| 타입체크 | exit 0 | `cd tsukuru-agent; npx tsc --noEmit` |
| 추적 파일 수 | 144 | `git ls-files \| Measure-Object` |
| `dist-cli/*.zip` (98MB) | **미추적** (`.gitignore` 처리됨) | `git ls-files --error-unmatch tsukuru-agent/dist-cli` → 출력 없음 |
| 그래프 노드/엣지 | 1420 / 3595 | `index_status` |
| 언어 분포 | TS 38 / JS 21 / CSS 5 / HTML 5 / YAML 1 파일 | `get_architecture` |

### 2.1 이 계획서의 자체 검증

§3–§4의 모든 `file:line` 근거는 스크립트로 검증된다. 코드가 바뀌면 이 스크립트가
먼저 깨지므로, 계획서가 조용히 낡는 것을 막는다.

```powershell
cd specs\001-gui-design-hardening
node verify-plan-citations.js   # 인용된 file:line 이 실제 범위 안인지
node verify-plan-claims.js      # 인용된 줄의 '내용'이 주장과 일치하는지
```

| 스크립트 | 마지막 실행 결과 (2026-08-28) |
| --- | --- |
| `verify-plan-citations.js` | 70개 인용 / 70개 범위 내 / 문제 0 · exit 0 |
| `verify-plan-claims.js` | **34/34 주장 검증** · exit 0 |

> 구현이 진행되면 이 스크립트들은 **의도적으로 실패해야 한다** (결함이 사라졌으므로).
> 각 Task 완료 시 해당 주장을 `verify-plan-claims.js` 에서 제거하고,
> 그 반대 조건을 Phase 3의 `test/gui-*.test.js` 로 옮긴다.

---

## 3. 증거 — 디자인 감사 (필수 섹션)

### 3.1 디자인 표면 인벤토리

Electron이 실제로 로드하는 화면은 3개 + 설정 1개다 (`main.ts:90` →
`loadFile('./src/html/simple/index.html')` 가 최초 진입점. `main.ts:89` 는 주석 처리된
구 진입점 `main/index.html`).

| 화면 | 마크업 | 스타일 | 실제 로드되는 CSS |
| --- | --- | --- | --- |
| 런처 (진입점) | `src/html/simple/index.html` | `back.scss` / `back.css` | **`back.css`** |
| MV/MZ 메인 | `src/html/main/index.html` | `styles/main.scss` / `main.css` | **`main.css`** |
| Wolf 메인 | `src/html/wolf/index.html` | `back.scss` / `back.css` | **`back.css`** |
| 설정 | `src/html/config/settings.html` | `styles.css` | `styles.css` |

> **중요:** `.scss` 는 **죽은 소스**다. 빌드 스크립트도 sass 의존성도 없고, `.scss`/`.css`
> 양쪽이 동일 커밋 `446151c "V1 ready"`에서 마지막으로 변경됐다. **`.scss`만 수정하면
> 화면에 아무 일도 일어나지 않는다.** → T004가 이 파이프라인을 먼저 세운다.

### 3.2 근본 원인 3건 (이걸 먼저 고쳐야 나머지가 유효해진다)

**RC-1 · 투명 서페이스 토큰** — `src/js/rpgmv/styles.ts:5,15`
```ts
"--Highlight2": "#00000000",   // 알파 00 = 완전 투명
```
`--Highlight2`는 `.btn`(그리드 버튼 전체), `.btn2`(모드 버튼), `#loading_bar`(커스텀
타이틀바)의 `background-color`다 (`main.scss:97`, `:78`, `:153`). 즉 **앱의 주요 클릭
대상과 타이틀바가 전부 배경색이 없다.** 텍스트만 떠 있는 상태 → 버튼 경계·호버·
포커스를 표현할 서페이스 자체가 존재하지 않는다.

**RC-2 · IPC 이후에 도착하는 테마 (검은 화면 FOUC)** — `main.scss:2-11` vs `main.ts:119`
```scss
:root{ --mainColor:#000000; --Highlight1:#000000; --Background:#000000; /* 전부 검정 */ }
```
```ts
globalThis.settings.themeData = Themes[globalThis.settings.theme]  // main.ts:119
getMainWindow().webContents.send('getGlobalSettings', ...)          // main.ts:120
```
렌더러는 이 IPC를 받은 **뒤에야** `root.style.setProperty()`로 색을 넣는다
(`renderer.ts:73`). 그 전 첫 페인트에서는 `:root` 기본값이 적용된다 =
**검정 배경 + 검정 글자.** 창 로드/리로드마다 발생하며, 언어 변경은 실제로
`mwindow.reload()`를 호출하므로(`main.ts:66`) 매번 이 플래시를 본다.

**RC-3 · 5ms마다 innerHTML을 다시 쓰는 i18n 루프** — `src/lib/enlang/enlang.js:1-9`
```js
globalThis.loadEn = (async () => {
    while(true){
        for(const ele of document.querySelectorAll('[enlang]')){
            ele.innerHTML = ele.getAttribute('enlang')...   // 초당 약 200회
        }
        await new Promise(r => setTimeout(r, 5));
    }
})
```
영어 설정이면 4개 렌더러 전부가 이걸 호출한다 (`renderer.ts:67`, `simple/rend.ts:11`,
`wolf/rend.ts:21`, `config/script.ts:25`). 결과: ① 무한 메인스레드 점유,
② `innerHTML` 재작성이 자식 노드를 매번 교체하므로 **CSS transition·`:focus` 상태·
캐럿이 초당 200번 파괴된다** — 이 상태에서는 어떤 모션도 재생될 수 없다,
③ 속성값 → `innerHTML` 은 마크업 주입 싱크.

### 3.3 리뷰 표 (Before / After / Why)

`emil-design-eng` 규정 형식. 모든 행에 실측 `file:line` 근거가 있다.

| Before | After | Why |
| --- | --- | --- |
| `"--Highlight2": "#00000000"` (styles.ts:5,15) | 불투명 서페이스 토큰 (예 `#2f3140`) | 버튼·타이틀바에 배경이 없으면 호버/포커스/press 상태를 그릴 면이 없다 (RC-1) |
| `:root{ --Background:#000000; --mainColor:#000000 }` (main.scss:2-11) | 실제 기본 팔레트를 CSS에 하드코딩, IPC는 override만 | 검정-on-검정 FOUC 제거 (RC-2) |
| `"--Gap:": "0px"` (styles.ts:9,19) | `"--Gap": "0px"` | 키에 콜론이 붙어 `setProperty("--Gap:", …)`가 무효 → 그리드 간격을 테마로 바꿀 수 없음 |
| `while(true){ … innerHTML = … ; sleep(5) }` (enlang.js:1-9) | 1회 실행 + `textContent`, 변경 시에만 재실행 | 초당 200회 DOM 재작성이 transition·포커스를 파괴, `innerHTML`은 주입 싱크 (RC-3) |
| `transition: 0.2s` (main.css:163-164, wolf/back.css:219-220) | `transition: height 220ms var(--ease-drawer), opacity 160ms ease` | 축약형은 `transition: all` 과 동일 — 속성을 명시해야 한다 |
| 내장 easing (기본 `ease`) | `--ease-out: cubic-bezier(0.23,1,0.32,1)` / `--ease-in-out: cubic-bezier(0.77,0,0.175,1)` / `--ease-drawer: cubic-bezier(0.32,0.72,0,1)` | 내장 커브는 약해서 의도가 안 보인다 |
| `.btn` / `.btn2` / `#run` / `#runbtn` 에 `:active` 없음 | `:active{ transform: scale(0.97) }` + `transition: transform 160ms var(--ease-out)` | 눌린 걸 인터페이스가 들었다는 피드백이 전무 |
| 전체 CSS에 `:focus` / `:focus-visible` **0건** | `:focus-visible{ outline:2px solid var(--Selected); outline-offset:2px }` | 키보드 사용자에게 현재 위치 표시가 없음 |
| `.runbtn:hover` 무조건 적용 (wolf/back.css:211) | `@media (hover: hover) and (pointer: fine)` 로 감싸기 | 터치에서 탭이 hover로 잘못 걸린다 |
| 전체 CSS에 `prefers-reduced-motion` **0건** | `@media (prefers-reduced-motion: reduce)` 에서 transform 계열만 제거, opacity 유지 | 모션 민감 사용자 배려는 "0으로" 가 아니라 "더 부드럽게" |
| `.hiddenc{ visibility:hidden; position:absolute }` 로 모드 전환 (main.scss:206-217, renderer.ts:194-204) | `opacity:0; transform:scale(0.98)` → 정착, `180ms var(--ease-out)` | 패널이 순간이동한다 (jarring change) |
| `#border_r` 를 `style.width = '${tt}vw'` 로 갱신 (renderer.ts:82, wolf/rend.ts:205) | 고정폭 + `transform: scaleX()` + `transform-origin: left`, `transition: transform 200ms linear` | `width` 애니메이션은 layout+paint를 매 틱 유발. transform은 GPU |
| `<div id="runbtn" class="runbtn">RUN</div>` (wolf/index.html:50,66) | `<button type="button" id="runbtn" …>` | 앱의 **주 실행 버튼**이 div — 포커스도 Enter/Space 활성화도 안 된다 |
| `<div class="btnx" id="WolfBtn">` 등 모드/언어 전환 div (main/index.html:76,77, wolf:30,31,84, simple:42,43) | `<button type="button">` | 동일 이유 |
| 빈 `<button class="btn"></button>` **11개** (main/index.html) | 삭제하고 그리드 auto-flow에 맡김 | 라벨 없는 포커스 가능 탭스톱 11개가 키보드 순회를 오염 |
| `<button class="btn" id="changeAll"></button>` (wolf/index.html:76-77) | 텍스트 + `enlang` 속성 추가 | **동작하는** 버튼에 라벨이 아예 없다 (문자열 일괄 변경 / 버전 업 툴) |
| `<h class="right_main" id="info">` (main/index.html:56) | `<p>` 또는 `<output>` | `<h>` 는 HTML 요소가 아님 → 무스타일 인라인으로 파싱 |
| `simple/index.html` · `wolf/index.html` 에 `<html>` 태그 자체가 없음 (grep 0건), `main/index.html:2` 는 `lang` 없음 | `<html lang="ko">` 래퍼 복원 | 문서 루트와 언어 선언 누락 |
| `settings.html` 체크박스가 `<label for>` 없이 텍스트 옆에 나열 | 행 전체를 `<label>` 로 감싸기 | 텍스트를 눌러도 토글되지 않음 (클릭 타겟 13px) |
| `settings.html:24` `<div>기계번역 사용자 사전</label>` | 짝이 맞는 태그로 수정 | 열린 적 없는 `</label>` 종료 태그 |
| `settings.html` 전체가 한국어 하드코딩 (`enlang` 속성 0건) | 다른 화면과 동일하게 `enlang` 부여 | 설정 화면만 영어 전환이 안 됨 |
| `<title>MV Extractor++</title>` (main/index.html:10, simple:10, wolf:10) | `Tsukuru Agent` | 구 브랜딩 잔존 (README·릴리스는 Tsukuru Agent) |
| `Themes.Dracula` 와 `Themes.Classic` 이 값까지 동일 (styles.ts:2-21) | 실제로 다른 팔레트를 주거나 목록에서 제거 | 설정에 테마 2개가 보이지만 결과가 같다 |

### 3.4 애니메이션 기회 (게이트 통과분만)

`find-animation-opportunities` 게이트 4단계(빈도 → 목적 → 속도 → 기능) 전부 통과한
항목만 남겼다. 값은 스킬의 공용 토큰에서 그대로 가져왔다.

| # | 위치 | 현재 | 목적 | 빈도 | 제안 모션 |
| --- | --- | --- | --- | --- | --- |
| 1 | `wolf/index.html:50,66` `#runbtn`/`#runbtn2`, `main/index.html:29` `#run` | press 피드백 없음 | Feedback | Occasional | `:active{ transform: scale(0.97) }`, `transition: transform 160ms var(--ease-out)` |
| 2 | `renderer.ts:194-204` + `main.scss:206-217` 모드 패널 교체 | `visibility:hidden` 로 순간이동 | Preventing a jarring change | Occasional | 진입 `opacity:0; transform:scale(0.98)` → 정착, `180ms var(--ease-out)`. `@starting-style` 또는 `data-mounted` |
| 3 | `main.scss:135-140` `#addons` 드로어 (`height:0` ↔ 펼침) | `transition: 0.2s` (= all, 기본 ease) | Spatial consistency | Occasional | `transition: height 220ms var(--ease-drawer), opacity 160ms ease`. height는 아코디언 예외로만 허용 |
| 4 | `renderer.ts:82`, `wolf/rend.ts:205` 진행 바 `#border_r` | `width` 를 매 틱 재설정 | State indication | 작업 중 연속 | 고정폭 + `transform: scaleX(p)`, `transform-origin: left`, `transition: transform 200ms linear` (등속이므로 linear) |
| 5 | `.btnx` ↔ `.btxSel` 모드 선택 (main.scss:250-256) | 색이 즉시 튄다 | State indication | Occasional | `transition: background-color 150ms ease` — 색 변화이므로 `ease` |

### 3.5 의도적으로 거부한 후보 (필수 기록)

| 후보 | 죽인 게이트 | 이유 |
| --- | --- | --- |
| 창 등장 페이드 (`main.ts:92` `mainWindow.show()`) | ③ 속도 / ④ 기능 | 첫 페인트를 늦춘다. 창 등장은 컴포지터 몫 |
| `Swal.fire` 모달 진입 (renderer.ts 다수) | ② 목적 중복 | sweetalert2가 이미 애니메이션한다. 덧대면 300ms 예산 초과 |
| 언어 플래그 전환 (`simple/index.html:42,43` → `main.ts:66` `mwindow.reload()`) | ② 목적 | 창을 리로드하므로 모션이 살아남지 못한다 |
| `#loading-text` 퍼센트 숫자 (renderer.ts:112) | ④ 기능 | 사용자가 **읽고 있는** 숫자다. 읽는 데이터는 스타일로 움직이지 않는다 |
| 9칸 그리드 버튼 hover 확대 | ① 빈도 / ④ 기능 | 빈도 tens/day이고, 11칸이 빈 placeholder라 죽은 타겟을 광고하게 된다 |
| 추출 완료 축하 모션 (delight 예산) | ② 목적 | 완료 통보는 이미 Swal. 도구 성격상 축하는 과하다 |


---

## 4. 증거 — 코드 · 아키텍처 감사

### 4.1 보안 (최우선)

**SEC-1 · 렌더러 원격 코드 실행 경로.** 세 조건이 동시에 성립한다.

| 조건 | 위치 |
| --- | --- |
| `nodeIntegration: true`, `contextIsolation: false` | `main.ts:81-82`, `main.ts:195-196`, `src/js/libs/papagotrans.ts:26-27` |
| 원격 CDN 스크립트 로드 | `src/html/simple/index.html:5`, `src/html/wolf/index.html:7` (`https://unpkg.com/@popperjs/core@2/...`) |
| CSP 없음 | `main/index.html`, `simple/index.html`, `wolf/index.html` 에 `Content-Security-Policy` 없음. `config/settings.html:6` 에만 있다 |

즉 **unpkg 응답을 조작할 수 있는 위치(네트워크 MITM, CDN 침해, DNS)에서 임의 코드가
Node `fs` 권한으로 실행된다.** 이 도구는 사용자의 게임 폴더 전체를 읽고 쓰는 권한으로
동작하므로 영향 범위가 크다. 덧붙여 `popper.js`가 실제로 쓰이는지도 확인해야 한다
(sweetalert2는 popper를 요구하지 않는다) — 안 쓰면 **삭제**가 정답이다.

**SEC-2 · EOL 런타임 / 노후 의존성** (`package.json`)

| 패키지 | 현재 | 문제 |
| --- | --- | --- |
| `electron` | `^22.0.0` | Electron 22는 지원 종료(EOL). Chromium/V8 보안 패치 없음 |
| `axios` | `^0.24.0` | 0.x 계열. 알려진 취약점 다수 |
| `request` | `^2.88.2` | 2020년 deprecated. 유지보수 없음 |
| `jsdom` / `glob` | `^19` / `^8` | 구버전 |

### 4.2 복잡도 핫스팟 (codebase-memory 실측)

`query_graph` 결과 상위 항목. 이 값들이 리팩터 우선순위의 근거다.

| 함수 | 파일 | cyclomatic | cognitive | 중첩 루프(전이) | 루프 내 선형탐색 |
| --- | --- | --- | --- | --- | --- |
| `trans` | `src/js/rpgmv/translator.ts` | **120** | **669** | 6 | **9** |
| `extract` | `src/js/rpgmv/extract.ts` | 60 | 323 | 6 | 1 |
| `opVerify` | `src/cli/run.js` | 45 | 136 | 6 | 0 |
| `inspectRpgProject` | `src/core/validator.js` | 45 | 111 | 5 | 0 |
| `RpgMakerService.apply` | `src/js/rpgmv/RpgMakerService.ts` | 38 | 136 | 4 | 2 |
| `translate2` | `src/js/rpgmv/translator.ts` | 34 | 179 | 2 | 0 |
| `TyranoService.applyToCopy` | `src/js/tyrano/TyranoService.ts` | 31 | 55 | **7** | 1 |
| `inspectTyranoProject` | `src/core/validator.js` | 28 | 101 | 5 | 0 |
| `applyPatches` | `src/cli/patcher.js` | 27 | 43 | 4 | 0 |
| `forEvent` | `src/js/rpgmv/extract.ts` | 23 | 102 | 4 | 4 |
| `ConvertProject` | `src/js/rpgmv/projectConvert.ts` | 22 | 56 | 3 | 3 |

`src/cli/run.js` 는 78,507 bytes / `run.ts` 71,070 bytes 단일 파일로,
`opVerify`·`opApply`·`opExtract`·`opApplyAsarWorking` 등 CLI 오퍼레이션 전체를 담고 있다
(클러스터 0: 59 members, cohesion 0.72).

### 4.3 빌드 · 저장소 위생

| 항목 | 실측 | 영향 |
| --- | --- | --- |
| SCSS 파이프라인 | 없음 (sass 의존성 0, 스크립트 0) | `.scss` 수정이 화면에 반영되지 않음 → 디자인 작업 전면 차단 |
| 컴파일 산출물 커밋 | `src/**` 아래 `.js` 21개가 git 추적됨 (`.ts` 와 병존) | `tsc` 재실행을 잊으면 `.ts`/`.js` 가 조용히 갈라진다 |
| lint / format | 스크립트 없음 | 스타일 규칙 강제 수단 없음 |
| CI | 워크플로 없음 | 78개 테스트가 수동 실행에만 의존 |
| `package.json` name | `mv-extractor-pp`, `repository` → `gramedcart/mvextractor` | 현재 프로젝트(Tsukuru Agent)와 불일치 |
| GUI 자동 회귀 | `test/smoke-gui-adapter.js` (IPC mock)만 존재 | 마크업·접근성·CSS 회귀를 잡는 테스트가 0건 |

### 4.4 네트워크 표면 (get_architecture routes)

| 메서드 | 대상 | 위치 |
| --- | --- | --- |
| GET | `raw.githubusercontent.com/gramedcart/tsukuru_extractor/main/version.json` | `main.ts:104` (업데이트 확인) |
| GET | `github.com/Sinflower/WolfDec/releases/download/v0.3/WolfDec.exe` | 외부 실행 파일 다운로드 |
| GET | `http://localhost:8000/` | eztrans 로컬 브리지 |

`WolfDec.exe` 다운로드는 **실행 파일을 받아 실행하는 경로**다. 해시 고정 여부를
확인해야 한다 (T028).


---

## 5. Task 목록

표기: `[P]` = 선행 태스크가 같으면 병렬 실행 가능. 모든 태스크의 수락 기준은
**"확인 명령의 출력"** 으로 판정하며, 매 Phase 종료 시 §6 게이트를 통과해야 한다.

### Phase 0 — 차단 해제 · 보안 (선행: 없음)

디자인 작업이 물리적으로 불가능한 상태를 먼저 해소한다. T001–T003은
디자인 파일과 같은 파일을 건드리므로 여기서 함께 닫는다.

| ID | 태스크 | 대상 파일 | 수락 기준 |
| --- | --- | --- | --- |
| T001 | `unpkg.com` popper 스크립트 제거. 실사용 여부 먼저 확인하고, 필요하면 `src/lib/` 로 벤더링 | `src/html/simple/index.html:5`, `src/html/wolf/index.html:7` | 레포 전체 grep `https://unpkg\|https://cdn` → 0건 |
| T002 | 3개 렌더러에 CSP 메타 추가 (`default-src 'self'`). `settings.html:6` 과 동일 수준 | `main/index.html`, `simple/index.html`, `wolf/index.html` | grep `Content-Security-Policy` → 4개 HTML 전부 히트 |
| T003 [P] | `sandbox: true` / `contextIsolation: true` + preload 브리지로의 **이행 계획서** 작성 (이 Phase에서는 설계만) | `specs/001-gui-design-hardening/preload-migration.md` (신규) | 문서에 현재 IPC 채널 전수 목록과 채널별 노출 범위가 있을 것 |
| T004 | SCSS 빌드 파이프라인 도입: `sass` devDependency 고정 + `"styles": "sass src/html:src/html --no-source-map"` 스크립트 | `package.json` | `.scss` 에 마커 규칙 추가 → `npm run styles` → 해당 규칙이 `.css` 에 나타남 |
| T005 | `.scss` ↔ `.css` 화해 (바로 아래 **Phase 0 부록** 절차). sass 출력이 손으로 고친 `.css` 와 **바이트 일치할 수 없다**는 점을 전제로, "규칙 손실 0" 을 기준으로 삼고 재생성본을 새 baseline 으로 커밋한다 | `main/styles/*`, `wolf/back.*`, `simple/back.*` | ① `node scripts/css-rule-diff.js` → 손실된 셀렉터·선언 0건 ② 재생성본 커밋 후 `npm run styles; git diff --quiet -- '*.css'` → exit 0 (멱등) |
| T006 | RC-3: `enlang.js` 무한 루프 제거 → 1회 실행 + `textContent` + `MutationObserver`(필요 시) | `src/lib/enlang/enlang.js` | 파일에 `while(true)` 없음. 영어 모드 진입 후 DevTools Performance에서 유휴 시 스크립팅 시간 ≈ 0 |
| T007 | RC-2: `:root` 기본값을 실제 Dracula 팔레트로 교체. IPC 테마는 override 역할만 | `main/styles/main.scss`, `wolf/back.scss`, `simple/back.scss` (+ T004로 생성된 `.css`) | 어떤 `.scss` 에도 `#000000` 기본 팔레트가 남아있지 않을 것 |
| T008 | RC-1: `--Highlight2` 를 불투명 서페이스 값으로 교체. `--Gap:` 키 오타 수정 | `src/js/rpgmv/styles.ts` | `styles.ts` 에 `#00000000` 없음, `"--Gap:"` 없음. `npx tsc --noEmit` exit 0 |

### Phase 0 부록 · T005 절차 — `.scss` ↔ `.css` 화해 (자기 차단 방지)

**문제:** "`npm run styles` 후 `git diff` 가 비어야 한다" 를 T005의 조건으로 걸면
**정의상 실패한다.** sass 출력 포맷(들여쓰기, `@mixin` 전개, 속성 순서)은 손으로
유지해온 `.css` 와 바이트 일치할 수 없다. 따라서 기준을 바꾼다.

지켜야 할 안전 속성은 "바이트 동일" 이 아니라 **"렌더링 규칙이 하나도 사라지지 않았다"** 다.

1. **스냅샷.** 현재 `.css` 4개를 `tmp/css-baseline/` 로 복사한다. 이것이 실제 배포되고
   있던 진실이다.
2. **규칙 인벤토리 도구 작성** — `scripts/css-rule-diff.js` (신규):
   두 CSS를 (셀렉터 → 정규화된 선언 집합) 맵으로 파싱해 비교하고,
   `MISSING`(baseline 에만 있음) / `ADDED` / `CHANGED` 로 분류해 출력한다.
   포맷·순서·공백 차이는 무시한다.
3. **1차 재생성.** `npm run styles` 로 `.scss` → `.css` 를 생성하고
   `node scripts/css-rule-diff.js tmp/css-baseline src/html` 를 돌린다.
4. **MISSING 을 0으로.** `MISSING` 으로 나온 규칙은 `.css` 에만 손으로 추가됐고
   `.scss` 에는 없던 것들이다. 이것들을 `.scss` 로 역이식한다. 3–4를 `MISSING` 이
   0이 될 때까지 반복한다.
5. **ADDED / CHANGED 검토.** 각 항목이 sass 전개(`@mixin light()` 등)로 설명되는지
   1건씩 확인하고 계획서에 근거를 남긴다. 설명되지 않는 항목은 `.scss` 버그다.
6. **새 baseline 커밋.** `MISSING` = 0 이 되면 재생성된 `.css` 를 **새 baseline 으로
   커밋한다.** 이 시점부터 `.scss` 가 유일한 소스이고, `npm run styles` 는 멱등이 된다.
7. **이후부터** G3(`git diff --quiet -- '*.css'`)가 의미를 갖는다. 6번 커밋 이전에는
   G3를 적용하지 않는다.

> G3 는 **T005 완료 이후에만** 게이트로 작동한다. T004–T005 진행 중에는
> G3 대신 `css-rule-diff.js` 의 `MISSING = 0` 을 게이트로 쓴다.

### Phase 1 — 디자인 토큰 · 시맨틱 마크업 (선행: Phase 0)

| ID | 태스크 | 대상 파일 | 수락 기준 |
| --- | --- | --- | --- |
| T009 | 모션 토큰 정의: `--ease-out: cubic-bezier(0.23,1,0.32,1)`, `--ease-in-out: cubic-bezier(0.77,0,0.175,1)`, `--ease-drawer: cubic-bezier(0.32,0.72,0,1)`, `--dur-press:160ms`, `--dur-panel:180ms`, `--dur-drawer:220ms` | 각 `.scss` 의 `:root` | 세 화면 CSS 전부에서 토큰 조회 가능. 하드코딩된 `cubic-bezier` 리터럴 0건 |
| T010 [P] | 클릭 가능한 `div` → `<button type="button">` 승격 | `wolf/index.html:50,66` (`#runbtn`,`#runbtn2`), `wolf:30,31,84`, `main/index.html:76,77`, `simple/index.html:42,43` | 4개 HTML에서 `class="btnx"` / `class="runbtn"` / `id="lang-` 를 가진 `<div>` 0건. 이벤트 핸들러가 계속 동작 |
| T011 [P] | 빈 placeholder 버튼 11개 삭제, 그리드를 auto-flow로 | `main/index.html`, `wolf/index.html` | `<button class="btn"></button>` / `<div class="btn"></div>` 0건 |
| T012 [P] | 라벨 없는 실동작 버튼에 라벨 부여 (`#changeAll`, `#versionUp`) | `wolf/index.html:76-77` | 두 버튼 모두 텍스트 + `enlang` 속성 보유 |
| T013 [P] | `<h>` → `<output>`, `<html lang="ko">` 래퍼 복원, `<title>` 을 `Tsukuru Agent` 로 | `main/index.html:2,10,56`, `simple/index.html:10`, `wolf/index.html:10` | grep `<h ` → 0건, grep `MV Extractor++` → 0건, 3개 파일 모두 `<html lang=` 보유 |
| T014 [P] | 설정 화면: 체크박스 행 `<label>` 래핑, 짝 안 맞는 `</label>` 제거, `enlang` 속성 부여 | `config/settings.html` | 모든 `<input type="checkbox">` 가 `<label>` 후손. `enlang` 속성 개수 ≥ 체크박스 개수 |
| T015 | 테마 정리: `Dracula`/`Classic` 을 실제로 구분하거나 하나로 축약 | `src/js/rpgmv/styles.ts` | 두 테마의 값이 서로 다르거나, 테마가 1개 |

### Phase 2 — 모션 · 상태 피드백 (선행: Phase 1)

§3.4의 5개 기회만 구현한다. §3.5의 거부 목록은 구현하지 않는다.

| ID | 태스크 | 대상 | 수락 기준 |
| --- | --- | --- | --- |
| T016 | 기회 #1 · press 피드백: 모든 pressable에 `:active{transform:scale(0.97)}` + `transition: transform var(--dur-press) var(--ease-out)` | 3개 화면 CSS | `.btn`,`.btn2`,`.btnx`,`.runbtn`,`#run`,`#sel` 각각 `:active` 규칙 보유 |
| T017 | 기회 #2 · 모드 패널 전환을 `visibility` 에서 `opacity`+`transform:scale(0.98)` 로 교체 | `main.scss:206-217`, `renderer.ts:194-204` | CSS에 `.hiddenc{visibility:hidden}` 없음. `scale(0)` 0건 |
| T018 | 기회 #3 · `#addons` 드로어: `transition: 0.2s` → 속성 명시 + `--ease-drawer` | `main.scss:139`, `wolf/back.scss:199` | grep `transition:\s*0?\.[0-9]+s\s*;` → 0건 (축약형 금지) |
| T019 | 기회 #4 · 진행 바를 `width` → `transform: scaleX()` + `transform-origin: left` 로 전환 | `renderer.ts:82`, `wolf/rend.ts:205`, CSS | grep `style.width` → 0건. 진행 바가 0→100% 정상 표시 |
| T020 | 기회 #5 · `.btnx` → `.btxSel` 색 전환에 `transition: background-color 150ms ease` | `main.scss`, `wolf/back.scss`, `simple/back.scss` | 해당 규칙 존재 |
| T021 | `prefers-reduced-motion: reduce` 블록 추가 — transform 계열 제거, opacity 유지 | 3개 화면 CSS 전부 | 각 CSS에 `@media (prefers-reduced-motion: reduce)` 1개 이상 |
| T022 | `:hover` 규칙을 `@media (hover: hover) and (pointer: fine)` 로 게이팅 | `wolf/back.scss:189` (`.runbtn:hover`) 및 신규 hover 규칙 | 게이트 밖의 `:hover` + transform 조합 0건 |
| T023 | `:focus-visible` 링 추가 (모든 상호작용 요소) | 4개 화면 CSS | 각 CSS에 `:focus-visible` 1개 이상. Tab 순회로 현재 위치가 보일 것 |

### Phase 3 — GUI 회귀 방어 (선행: Phase 1, Phase 2와 병렬 가능)

디자인 수정이 다시 썩지 않게 고정한다. 지금은 이 층이 완전히 비어 있다.

| ID | 태스크 | 대상 | 수락 기준 |
| --- | --- | --- | --- |
| T024 | `test/gui-markup.test.js` 신규: 4개 HTML을 파싱해 정적 불변식 검사 — 라벨 없는 button 0건, `<h>` 0건, 클릭 div 0건, `lang` 속성 존재, CSP 존재, 원격 `src` 0건 | `test/gui-markup.test.js` | `node --test` 총 통과 수가 78 → 78+N 으로 증가, fail 0 |
| T025 [P] | `test/gui-styles.test.js` 신규: CSS 텍스트 검사 — `transition:` 축약형 0건, `scale(0)` 0건, `ease-in` 0건, `prefers-reduced-motion` 존재, `:focus-visible` 존재 | `test/gui-styles.test.js` | 동일 |
| T026 [P] | `test/gui-theme.test.js` 신규: `styles.ts` 토큰 검사 — 알파 `00` 서페이스 0건, `--` 키에 `:` 0건, `:root` 기본값이 검정-on-검정 아님 | `test/gui-theme.test.js` | 동일 |
| T027 | CI 워크플로 추가 (`typecheck` → `styles` 검증 → `node --test`) | `.github/workflows/ci.yml` | 워크플로가 3단계를 모두 실행하고, `.css` 재생성 후 `git diff` 가 비어야 통과 |

### Phase 4 — 의존성 · 보안 후속 (선행: Phase 0)

| ID | 태스크 | 대상 | 수락 기준 |
| --- | --- | --- | --- |
| T028 | `WolfDec.exe` 다운로드 경로에 SHA-256 고정 검증 추가 | `src/js/wolf/` 다운로드 지점 | 해시 불일치 시 실행 거부. 테스트로 커버 |
| T029 | `axios ^0.24` → 최신 1.x, `request` 제거 후 대체 | `package.json` + 호출부 | `npm ls request` 결과 없음. 78개 테스트 유지 |
| T030 | Electron 22 → 지원 버전 업그레이드 (별도 브랜치, 광범위 회귀 필요) | `package.json` | `npx tsc --noEmit` exit 0 + 78개 테스트 통과 + GUI 수동 확인 |
| T031 | `package.json` 메타데이터 정정 (`name`, `repository`, `description`) | `package.json` | `mv-extractor-pp` / `gramedcart/mvextractor` 문자열 0건 |

### Phase 5 — 복잡도 리팩터 (선행: Phase 3의 게이트가 살아있을 때)

**주의:** 이 Phase는 디자인과 무관하며 회귀 위험이 가장 크다. Phase 3의 테스트
망이 서기 전에는 착수하지 않는다.

| ID | 태스크 | 근거 | 수락 기준 |
| --- | --- | --- | --- |
| T032 | `translator.trans` 분해 (cyclo 120 / cog 669 / 루프 내 선형탐색 9) | §4.2 | 재색인 후 어떤 함수도 cyclo > 40 이 아님. 78개 테스트 유지 |
| T033 | `rpgmv/extract.extract` (cyclo 60 / cog 323) 및 `forEvent` (선형탐색 4) 분해 | §4.2 | 동일 |
| T034 | `src/cli/run.js` (78KB) 를 오퍼레이션별 모듈로 분할 | §4.2 클러스터 0 | `run.ts` < 20KB. CLI 계약 테스트(`smoke-cli.js`, `v25-cli.test.js`) 무변경 통과 |
| T035 | 컴파일 산출물(`src/**/*.js`) 을 git 추적에서 제외하거나 pre-commit 으로 동기 강제 | §4.3 | `.ts`/`.js` 드리프트가 CI에서 검출됨 |

---

## 6. 검증 게이트

각 Phase 종료 시 아래를 순서대로 통과해야 한다. 하나라도 실패하면 다음 Phase로
넘어가지 않는다.

| # | 게이트 | 명령 / 방법 | 기준 |
| --- | --- | --- | --- |
| G1 | 타입 | `cd tsukuru-agent; npx tsc --noEmit` | exit 0 |
| G2 | 회귀 | `cd tsukuru-agent; node --test` | pass ≥ 78, fail = 0 |
| G3 | 스타일 동기 | **T005 완료 후**: `npm run styles; git diff --quiet -- '*.css'`. **T004–T005 중**: `node scripts/css-rule-diff.js tmp/css-baseline src/html` | 전자는 exit 0, 후자는 `MISSING = 0` (§5 Phase 0 부록) |
| G4 | 디자인 정적 규칙 | `node --test test/gui-*.test.js` | fail 0 |
| G5 | **육안 / feel-check** | `npm start` 후: ① 창 첫 페인트에 검은 화면 플래시 없음 ② Tab만으로 모든 버튼 도달 가능 ③ press 시 눌림 반응 ④ 모드 전환이 순간이동하지 않음 ⑤ DevTools 애니메이션 패널에서 2–5배 감속 재생해 커브·타이밍 확인 | 5개 항목 모두 확인 |
| G6 | 원격 코드 | `grep -r "https://unpkg\|https://cdn" src/` | 0건 |

> G5는 코드 리뷰로 대체할 수 없다. `emil-design-eng` 의 "다음 날 새 눈으로 다시 보기"
> 원칙에 따라, Phase 2 완료 후 하루 뒤 재확인을 권한다.

---

## 7. 미해결 질문 · 사용자 승인 필요

| # | 질문 | 왜 지금 결정할 수 없는가 | 기본 가정 |
| --- | --- | --- | --- |
| Q1 | GUI를 실제로 실행해 육안 검증해도 되는가 | `npm start` 는 Electron 창을 띄우고 `electron-store` 설정을 디스크에 쓴다. 이 세션에서 미실행 | 사용자 승인 후 실행 |
| Q2 | `popper.js` 가 실제로 필요한가 | sweetalert2는 popper를 요구하지 않는다. 다른 코드가 `Popper` 전역을 쓰는지 확인 필요 | 미사용으로 가정, T001에서 확인 후 삭제 |
| Q3 | Electron 22 → 최신 업그레이드(T030)를 이번 범위에 포함할지 | 메이저 업그레이드는 GUI 전면 회귀를 유발할 수 있다. 별도 브랜치가 안전 | 별도 브랜치로 분리 |
| Q4 | 컴파일된 `.js` 를 계속 커밋할지(T035) | 릴리스 배포 방식(electron-builder가 `.ts` 를 제외하고 패키징)에 의존한다 | 현행 유지 + CI 드리프트 검사 추가 |
| Q5 | 디자인 방향: 현재 Dracula 팔레트를 유지할지, 새 시각 언어를 정의할지 | 취향 결정. §3은 "지금 깨진 것"만 다루며 리브랜딩은 다루지 않는다 | 기존 팔레트 유지, 결함만 수정 |
| Q6 | `preload` + `contextIsolation` 이행(T003)을 언제 실행할지 | IPC 채널 전수 조사가 선행되어야 하고, 범위가 이 계획보다 크다 | 이번 범위는 **설계 문서까지**, 구현은 후속 spec |

---

## 8. 범위에서 제외한 것

- **CLI / 서비스 계층 기능 추가.** 78개 테스트가 통과하는 건강한 층이다. 이 계획은
  건드리지 않는다 (Phase 5의 리팩터는 동작 변경 없는 구조 정리로 한정).
- **README 로드맵 항목** (GDevelop `code*.js` 프로파일, NW.js appended ZIP 진단 등).
  별도 spec으로 다룬다.
- **리브랜딩 / 새 시각 언어.** Q5 참조.
- **모바일 / 터치 대응.** Windows 데스크톱 Electron 앱이다. `@media (hover: hover)`
  게이팅은 규칙 준수 목적이며 터치 지원 선언이 아니다.
