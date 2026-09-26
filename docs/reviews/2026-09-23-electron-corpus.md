# D22 — Electron 실물 샘플 추가 검증 (2026-09-23)

검증 기준은 `main@a9690a6`과 이번 RPG 옵션 스키마 수정이다. 수정은 로컬 작업 트리에
있으며 커밋·배포하지 않았다. 원본 게임을 별도 복사하고 현재 CLI로 검사했다.
게임명·실제 경로·세이브·추출문·원시 진단은 무시되는 로컬 증거에만 보관한다.

## 새 샘플과 기존 샘플 비교

| 현재 입력 | 기존 `electron-sample-01` | 신규 `electron-sample-02` |
|---|---:|---:|
| ASAR 크기(bytes) | 796,154,510 | 945,490,048 |
| 유효 파일 | 2,518 | 3,994 |
| 비정상 metadata | 19 | 18 |
| 엔진 / wrapper | MZ 1.10.0 / ElectronForMZ | MZ 1.10.0 / ElectronForMZ |

기존 샘플은 현재 원본의 정적 비교만 수행했다. 위 수치를 과거 다른 archive의
검증 결과로 대체하지 않는다. 두 샘플 모두 `project/` 안의 MZ를 같은 Electron
wrapper로 실행한다. 신규 main/preload에는 JPEG 저장 IPC가 추가돼 있지만 새로운
엔진이나 컨테이너는 아니다. 제품의 package version을 Electron 런타임 버전으로 읽지 않았다.

신규 샘플은 renderer Node 통합이 꺼져 있고 기본 저장 분기는 localforage를 사용한다.
실제 Electron 프로필의 IndexedDB/Local Storage도 확인했다. 폴더 복사만으로는
이 프로필을 격리할 수 없으므로 게임 실행·launch probe·저장/불러오기는 수행하지 않았다.

## 실제 도구 실행 결과

| 단계 | 결과 |
|---|---|
| 게임 복사 | 원본 74파일, 1,194,104,346 bytes와 복사본 SHA-256 일치 |
| raw ASAR verify | 추출 산출물 미존재로 예상된 `E_VERIFY_FAILED`; 게임 파손 판정이 아님 |
| full extract | 10개 텍스트 파일, 19,465 manifest 항목 추출 성공 |
| deep verify | 19,465항목 유효, 구조 오류 0, 기계적 검사 pass; 언어 감수 필요 |
| 기본 apply | 비정상 metadata 때문에 `E_EXPERIMENTAL_FEATURE_DISABLED`; 출력 미생성 |
| opt-in apply, 수정 전 | 탐지된 RPG 옵션 스키마가 `experimentalMalformedAsarRepack`을 거부 |
| opt-in apply, 수정 후 | 사전의 검증용 제목 1건 적용과 별도 전체 게임 재포장 성공 |
| 출력 대조 | 유효 파일 3,994개 유지; 3,993개 payload 동일; `System.json.gameTitle`만 의도대로 변경 |
| wrapper / 보호 코드 | ASAR 외 73파일 동일; 보호 스크립트 변경·피해 0 |
| 원본 / 작업본 / 세이브 | 원본·입력 복사본·추출 작업본 불변, 실제 AppData 48파일 해시·수정시각 동일 |

원본 ASAR SHA-256: `944de13678922720a03009b716f9673f8408e54c844c56321fff28b4e9741e68`.
출력 ASAR SHA-256: `c9a6c99fa9cdd3e37425089d306e119d394e98f08e7417675eb07431796fad98`.
재포장본은 18개 불가능한 metadata를 제외한 실험 결과이며, 전체 한글 패치가 아니다.
무결성 fuse는 disabled, 내장 ASAR hash는 absent, Authenticode는 NotSigned로
정적 검사됐다. 서명/fuse/보호 코드를 변경하지 않았다.

사용자는 검증 중 기존에 풀어둔 세이브 폴더를 직접 정리했다고 확인했다.
이를 도구 삭제나 원본 불변 증거로 오인하지 않았다. 남아 있는 원본 세이브 ZIP은
해시가 같고, 내부 8파일도 정리 전 폴더의 초기 해시와 모두 일치한다.

기존 `compat:corpus`에도 신규 추출 작업본을 등록해 통과했다.
[표준 corpus 결과](../../specs/003-translation-validation/electron-corpus-2026-09-23.json)의
`sourceSha256`은 **추출 작업본 디렉터리** digest다. 75점은 출력 비교 없는 deep verify
점수이며 번역률·게임 실행 점수가 아니다. 위 archive hash와 구분한다.

## 정리·수리된 작업팩 재검증

이전 14개 완전한 작업팩의 현재 위치를 대조했다. 이동은 이름과 manifest를 함께
확인하고, 전체 Extract/Backup/매핑 digest로 내용 변화를 판단했다. `.old` 사본을
현재 작업본으로 승격하지 않았다. 내용이 바뀐 5개와 새 작업팩 1개를 새 복사본에서 검사했다.

| ID | 이전 결과 | 이번 결과 | 남은 내용 |
|---|---|---|---|
| workspace-07 | 실패 | 통과 | 언어·메시지 문맥 감수 |
| workspace-09 | 통과 | 통과 | 원본 참조 경고 3개, 메시지 문맥 감수 |
| workspace-10 | 통과 | 통과 | 언어·메시지 문맥 감수 |
| workspace-12 | 실패 | 통과 | 언어·메시지 문맥 감수 |
| workspace-15 | 실패 | 통과 | 검사 대상 20,611개가 모두 원문 유지 상태; 번역 완료가 아님 |
| workspace-16 | 신규 | 실패 | 해시 불일치 12,776개, 제어코드 불일치 등 기계적 검사 실패 |

[재검증 결과](../../specs/003-translation-validation/corpus-recheck-2026-09-23.json)에
현재/이전 hash와 결과를 기록했다. 검사한 6개 모두 원본과 복사본 digest가 유지됐다.
나머지 9개는 D21과 digest가 같아 당시 결과를 유지했으며 이번에 재실행했다고 표시하지 않는다.
이들을 합친 현재 상태는 완전한 작업팩 15개 중 통과 11개·실패 4개다.
남은 실패 ID는 01·11·14·16이다. 비표준 workspace-08은 이 집계에 포함하지 않는다.
의미 감수와 실제 한글 패치 플레이는 전부 `not-run`이다.

## 수정과 자동 검증

- 원인: 공유 v2 `applyAuto`/`applyContainer`에는 옵션이 있지만 `applyRpg`에는
  빠져 있어 요청 형식 또는 탐지 결과가 RPG이면 dispatch 전에 거부됐다.
- 수정: 기존 boolean 옵션을 `applyRpg`에 추가했다. 기존 타입·기본 차단·원자적 출력과
  원본/보호 코드/런타임 검사는 유지한다. 새 의존성이나 기능 플래그는 만들지 않았다.
- 기존 계약 검사와 malformed ASAR workflow를 확장했다. 수정 전 2개 RED,
  수정 후 2개 GREEN. RPG 명시/자동 탐지, 잘못된 타입/타 엔진 거부,
  기본 차단·opt-in 성공·보호 파일/원본 보존을 확인했다.
- `npm run verify`, `npm run test:order`: 각각 433/433, skip 0.
  `npm run benchmark:check`: 6개 통과. Spec-kit prerequisite와 requirements 8/8 통과.
- 문서 갱신 후 계약/README 예시와 corpus workflow 검사 14개 및 `git diff --check` 통과.
- 첫 benchmark/corpus 실행은 고정 순서 테스트의 `.build` 재생성과 겹쳐 모듈 로딩에
  실패했다. 테스트 종료 뒤 다시 실행해 통과했다. 동시 실행 실패 로그도 보존했다.
- GUI/lifecycle/package 변경이 없어 Electron smoke와 배포 패키지는 이번에 재생성하지 않았다.
  기존 ZIP에는 이번 수정이 없으므로 사용 중인 소스 CLI와 구분한다.

로컬 재현 요청·로그·catalog·copy는 `tsukuru-agent/tmp/d22/`에 있다.
I: 검증 폴더의 안내 문서는 실제 경로와 ID 대응을 제공한다.

## 후속 우선순위

1. **P0 — 실행 프로브의 사용자 프로필 격리.** 현재 `runElectronApplyLaunchProbe`는
   게임만 복사하며 `runLaunchProbe`는 AppData 등 기존 환경을 상속한다. 동일 app 이름의
   synthetic Electron fixture와 실제 프로필 canary로 쓰기 격리·종료·정리를 검증한다.
   격리를 확인할 수 없는 wrapper는 실행을 보류한다.
2. **P1 — 실패 작업팩 01·11·14·16의 출처 대조.** 새 16의 해시·제어코드 손상을 먼저
   원문 ID 기준으로 확인한다. recover만으로 번역 의미가 복구됐다고 판정하지 않는다.
3. **P1 — 격리 후 신규 샘플 실행과 저장/불러오기·대표 장면 확인.** 구조 통과를 게임
   합격으로 승격하지 않는다. 기존 릴리스 수동 gate는 유지한다.
