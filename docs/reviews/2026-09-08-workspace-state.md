# 작업 재개 안내 — 2026-09-08

## 현재 판단

**2026-09-13 후속 계획:** Daybreak 제안 대조와 합성 재현을 완료했다.
[D21 작업 계획](../../task_plan.md)의 일반 RPG 사전 적용 rollback, 번역 lint,
공개 전 출력 검증을 우선한다. [항목별 근거](2026-09-13-daybreak-followup.md)는
기존에 해결된 Backup/dataPath 차단과 새로 필요한 작업을 구분한다.
이번에는 계획만 갱신했으며 해당 신규 구현은 미착수다.

후속 개발 기준은 `chore/hardening-integration@80d2043`의 작업 트리다. 일반 경로의 main은 이전 구현이며, hardening 완료 기록만으로 최신 구현이 main에 들어왔다고 판단하면 안 된다. 후속 작업에서 [R1](2026-09-08.md#r1-p2-v1-manifest의-줄-매핑-누락을-patch-전에-거부해야-한다)과 관련된 이웃 범위 중첩·파일 별칭 문제를 수정했다. Spec-kit 1.0.4, Codex Security 리뷰, Linear DAV-38~41, Sentry 읽기 전용 조회도 연결했다. 최신 실행 증거는 통합 worktree의 `specs/002-safe-patch-workflow/verification.md`를 기준으로 한다. 변경은 아직 커밋·병합하지 않았다.

## 경로와 Git 상태

- 저장소: `C:\Users\White\Documents\GitHub\Tsukuru Agent`
- main 앱: `<repo>\tsukuru-agent`
- 통합 worktree: `C:\Users\White\Documents\GitHub\.worktrees\Tsukuru-Agent\hardening-integration`
- remote: `https://github.com/Chiriri722/Tsukuru-Agent.git`

| 브랜치 | HEAD | 이번 작업 시작 시 상태 |
|---|---|---|
| `main` | `8c7d77332eb8567d082844dc306a6d1d2a1d9969` | clean; 로컬 origin/main과 일치 |
| `chore/hardening-integration` | `80d2043c67ac8bd9a0a4a466107777ef07489d0a` | clean; 로컬 origin 추적 ref와 일치 |
| `chore/hardening-build-chain` | `17fa6e7` | 미커밋 변경·새 파일 있음 |
| `chore/hardening-lockfile` | `17fa6e7` | 미커밋 변경·새 lockfile 있음 |
| `chore/hardening-version-identity` | `17fa6e7` | 미커밋 변경·새 문서/스크립트 있음 |

Git 원격을 fetch하지 않았으므로 이 표는 로컬 ref 기준이다. main과 통합 브랜치는 각각 고유 커밋 1개/6개로 갈라져 있다. main 고유 커밋은 GUI 계획과 검증 스크립트 추가이며, 공통 조상 이후 통합 변경은 306개 파일이다. 문서 수정 전 두 커밋의 `git merge-tree --write-tree main chore/hardening-integration`은 충돌 없이 종료했다. 실제 병합은 수행하지 않았고, 문서 변경 및 후속 수정 후에는 다시 확인해야 한다.

### 중복 폴더 정리

기존 `GitHub\Tsukuru Agent\Tsukuru Agent`의 21개 최상위 항목을 한 단계 위로 이동했다. 숨김 `.git`, ignored 테스트, node_modules, 빌드·임시 산출물도 함께 이동했다. 목적지에는 내부 폴더 하나만 있었으며, 경로·정션 여부·이름 충돌을 확인한 후 이동했다. 비어 있음을 확인한 내부 폴더만 삭제했다.

`git worktree repair`로 연결된 4개 worktree의 `.git` 참조를 복구했고, 이동 전후 HEAD와 각 worktree의 tracked/untracked Git 상태가 동일함을 확인했다. 세 예전 작업 worktree는 미커밋 결과가 있어 그대로 보존했다. Codex에 등록된 로컬 프로젝트는 상위 `GitHub`였으므로 등록 경로 수정은 필요하지 않았다.

## 구현 지도

| 영역 | main | 통합 브랜치 |
|---|---|---|
| CLI | `src/cli/run.ts`에 큰 operation 흐름 집중 | entrypoint / dispatcher / `operations/` 분리 |
| JSON 계약 | TypeScript 런타임 검사 | v1/v2 JSON Schema, 오류·경고 registry, resolved-option 재검증 |
| 파일 변경 | 파일별 atomic write, 일부 경로 검사 | batch rollback, `WorkspaceTransaction`, 공통 pathSafety |
| 실행 context | 호환 context 중심 | `OperationRuntime`, AsyncLocalStorage, 취소·timeout·자원 정책 |
| 엔진 | RPG MV/MZ, Wolf, Tyrano, GDevelop 서비스 | 같은 엔진에 매핑 검증·회귀·실험 profile 확장 |
| 컨테이너 | ASAR / ZIP package.nw, provenance | adapter 분리, directory/appended ZIP opt-in, 보호 파일 검증 |
| Electron | renderer Node 사용, 원격 스크립트 포함 | secure window factory, preload/IPC allowlist, worker |
| 빌드 | 소스 옆 JS, compile 별도 실행 | `.build/app` staging, compile 선행, 출력·EOL 정규화 |
| 문서·테스트 | 과거 기록과 일부 ignored 로컬 테스트 | ADR/정책/계약, 58개 추적 테스트 파일, CI 설정 |

통합 브랜치의 자세한 설계는 그 브랜치의 `docs/architecture.md`를 읽는다. 인덱스는 새 경로에서 `tsukuru-review-main`(1,480 nodes)과 `tsukuru-review-integration`(2,564 nodes)로 생성했다. main의 동일 이름 TS/JS 쌍은 그래프가 JS를 대표 소스로 반환할 수 있어 TS 원문과 컴파일 후 Git drift도 확인했다. fast 인덱스가 제외한 테스트·스크립트는 직접 파일로 대조했다.

## 이번 검증

후속 수정의 최종 검증은 통합 worktree에서 `verify` 403/403,
`test:order` 403/403, `benchmark:check` 6개 case 통과다. 아래 표는 수정 전
기준선으로 보존한다. 최종 회귀 8개는 좌표 누락·이웃 범위·Windows 별칭/장치 경로,
실패 시 바이트 보존과 기존 v1 읽기·정상 multiline 동작을 확인한다.

환경: Windows, Node `24.14.0`, npm `11.19.1`. 이미 설치된 의존성을 사용했다.

| 대상 | 명령/검사 | 결과 |
|---|---|---|
| main | `npm run typecheck`, `npm run compile` | 통과; 추적 소스 drift 없음 |
| main | `npm test` | 로컬 10개 파일, 78/78 통과 |
| main | 추적된 `v25-core`, `v25-cli`, `v25-schema-detect`, `v25-runtime`만 `node --test` | 4개 파일, 61/61 통과 |
| 통합 | `npm run verify` | 통과, 실행된 Node tests 395/395 |
| 통합 | verify 내 version/style/complexity/generated/inventory/supply-chain | 전부 통과 |
| 통합 | inventory | 58개 파일, top-level 선언 388개; nested subtest 포함 실제 395개 |
| 양쪽 | 정션, manifest 저장 실패, lineStart 누락을 합성 작업본에서 재현 | 리뷰 R1–R3 참조 |
| 통합 | 실제 extract 결과를 v1 manifest로 바꿔 lineStart를 지운 뒤 `executeAgentRequest` patch | 잘못된 성공과 작업본 손상 재현 |
| Git | 이동 전후 상태, worktree repair, 모의 병합 | 통과 |

처음 테스트 실행은 샌드박스의 `spawn EPERM`으로 시작이 차단됐다. 이후 승인된 샌드박스 밖 실행에서 위 결과를 확인했다. 새 의존성 설치, 온라인 audit, 패키지 재빌드, GUI 실행, 실게임 검사, hosted CI 조회는 이번 검증에 포함하지 않았다. `check:supply-chain` 통과는 로컬 inventory 대조이며 새로운 취약점 조회 결과가 아니다.

로컬 원문 로그와 재현 스크립트는 각 앱의 ignored `tmp/review-2026-09-08/`에 있다. main에는 `typecheck.log`, `compile.log`, `test.log`, `tracked-tests.log`, `reproduce-review.cjs`, `reproduce-cli.cjs`와 JSON 결과가 있고, 통합 앱에는 `verify.log`가 있다. 다음 clone에도 필요한 요약 증거는 [리뷰](2026-09-08.md)에 보존했다.

## 다음 작업

1. [D21 계획](../../task_plan.md)과 [제안 검증](2026-09-13-daybreak-followup.md)을 기준으로 일반 RPG 사전 적용 rollback부터 시작한다. 통합 worktree의 `docs/development-workflow.md`를 따라 새 feature 명세를 작성한다. 기존 `specs/002-safe-patch-workflow`의 좌표·중첩·별칭 수정은 완료 기록으로 보존하고 중복 구현하지 않는다.
2. 해당 결과의 검증 상태를 확인하고 미커밋 코드·문서·Spec-kit 자산을 함께 리뷰한다. Sentry 교체 토큰의 최근 24시간/prod/미해결 조회는 성공했고 결과는 0개였다. 토큰은 저장소 밖 공유 대상이 아니며 로컬 exclude로 보호한다.
3. main 병합에 앞서 이번 문서 정리와 통합 브랜치의 최신 계획서를 화해한다. 오래된 main 계획서로 최신 구현 상태를 덮어쓰지 않는다. 병합 후 `verify`, 빌드·패키지 계약, hosted CI를 해당 커밋에 연결한다.
4. release checklist의 실게임 수동 검증, 실제 directory-form `package.nw` 표본, 서명·게시 등은 확보한 증거별로 갱신한다. 과거 dirty-worktree 빌드 해시를 새 커밋 산출물로 재사용하지 않는다.

위의 "이번 검증" 표는 최초 리뷰 시점의 기준선이다. 이후 코드 수정과 플러그인 연결은 별도 통합 worktree에서 진행했다. main에서는 문서 정리와 경로 이전만 수행했고 브랜치 전환·병합, 커밋·푸시·게시를 수행하지 않았다.
