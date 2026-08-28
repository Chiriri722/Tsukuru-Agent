# ADR 0002: Application, validation, container, transaction 경계

- 상태: Accepted
- 날짜: 2026-08-23
- 대상: Tsukuru Agent 2.5 hardening

## Context

기존 `src/cli/run.ts`, `src/core/validator.ts`, `src/core/container.ts`는 요청 I/O, operation 선택, 엔진별 처리, report 정책, archive 라이브러리, 파일 쓰기를 한 파일에서 함께 수행했다. 이 구조에서는 엔진 또는 컨테이너 하나를 추가해도 넓은 조건문과 side effect를 동시에 수정해야 했고, 개별 정책을 독립적으로 검증하기 어려웠다.

## Decision

Application 계층의 의존성은 다음 한 방향으로 유지한다.

```text
CLI entrypoint → request parser → compatibility policy → dispatcher
                                                    ↓
                                          operation handler
                                  ┌─────────────────┼──────────────────┐
                                  ↓                 ↓                  ↓
                           engine registry   validator policy   container registry
                                  └─────────────────┼──────────────────┘
                                                    ↓
                                         WorkspaceTransaction
```

구체적인 경계는 다음과 같다.

1. `src/cli/entrypoint.ts`만 인수·stdin/file request·stdout/stderr를 소유한다. `run.ts`는 요청 검증, 탐지, 호환성 적용, dispatcher 호출과 오류 정규화만 조립한다.
2. `src/cli/dispatcher.ts`는 다섯 operation을 exhaustive typed record로 선택한다. `extract`, `apply`, `verify`는 각각 불변 engine-family handler registry를 사용하고, verify 구현은 ASAR/RPG·Wolf/Tyrano/GDevelop 모듈로 나뉜다. 각 `src/cli/operations/**` handler는 `process`, `console`, Electron API에 직접 의존하지 않는다.
3. `src/core/validation/engines/*.ts`는 엔진 구조 검사만 담당한다. 점수, severity registry·정렬, 보호 경로, file-map 비교는 각각 독립 정책 모듈이다. `validator.ts`는 이전 import를 보존하는 얇은 barrel이다.
4. `src/core/container/registry.ts`는 directory, Electron ASAR, NW.js ZIP adapter의 단일 registry다. 공통 archive 경로·충돌·크기 정책은 adapter 밖의 공통 모듈에 둔다. `container.ts`는 이전 import를 보존하는 얇은 barrel이다.
5. archive 추출은 adapter preflight를 통과한 뒤에만 staging을 만든다. archive pack 결과는 operation이 소유한 `WorkspaceTransaction.stagingPath` 아래에만 기록하고, 구조·필수 entry·provenance·원본 해시 검증 이후 commit한다.
6. `.tsukuru-container.json` provenance는 추출 transaction의 staging 안에서 생성·검증·기록한다. apply는 provenance와 명시된 원본 archive를 다시 대조하고, 새 archive 역시 최종 output transaction 안에서 검증한 뒤 전환한다.
7. 모든 transaction 사용부는 `try/finally`에서 `dispose()`를 호출한다. 성공 전 final path를 만들지 않고, force 교체는 backup·rollback 경로를 거친다.

## Invariants

- 원본 게임과 원본 archive는 in-place로 수정하지 않는다.
- traversal, 절대 경로, NUL, Windows alias 충돌, 링크·정션, path/segment 길이 초과, 파일 수·용량 초과를 쓰기 전에 거부한다.
- 잘못된 NW.js archive는 staging 경로조차 만들지 않는다.
- pack이 성공해도 output 검증과 원본 재검증이 끝나기 전에는 final path가 보이지 않는다.
- 지원하지 않는 엔진·컨테이너는 registry에 암묵적으로 fallback하지 않는다.
- 기존 `validator.ts`, `container.ts`, `containerProvenance.ts` import 경로는 호환 barrel로 유지한다.

## Consequences

새 엔진 validator는 engine module과 issue registry를 추가해 확장할 수 있고, 새 container는 adapter와 registry 항목을 추가해 확장할 수 있다. archive 라이브러리의 세부 API는 해당 adapter 밖으로 노출되지 않는다. 반면 registry interface와 transaction 순서는 contract가 되므로 변경 시 characterization, hostile archive, round-trip, rollback 테스트를 함께 갱신해야 한다.

## Validation

- `test/contract/cli-snapshot.test.js`
- `test/e2e/agent-workflows.test.js`
- `test/integration/core.test.js`
- `test/integration/compat.test.js`
- `test/unit/cli-dispatcher.test.js`
- `test/unit/operation-handlers.test.js`
- `test/unit/validator-policy.test.js`
- `test/unit/container-registry.test.js`
- `test/unit/workspace-transaction.test.js`
