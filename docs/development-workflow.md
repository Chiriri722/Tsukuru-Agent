# 명세에서 검증까지

현재 작업은 `chore/hardening-integration`의
[003-translation-validation](../specs/003-translation-validation/spec.md)입니다.
[계획](../specs/003-translation-validation/plan.md)과
[체크리스트](../specs/003-translation-validation/tasks.md)에 구현·검증 상태를 남깁니다.
다른 worktree의 미완료 변경은 이 작업의 결과에 포함하지 않습니다.

## Spec-kit

[공식 Spec-kit 1.0.4](https://github.com/github/spec-kit/releases/tag/v1.0.4)의
Codex skills 10개와 PowerShell scripts를 저장소에 설치했습니다.
`.specify/memory/constitution.md`는 원본 보존·계약 호환·회귀 증명 기준입니다.
Python CLI는 개발 도구이며 애플리케이션 배포물에 포함되지 않습니다.

새 checkout에서 CLI가 필요하면 저장소 루트에서 실행합니다. uv와 Python 3.13이 필요합니다.

```powershell
$env:UV_CACHE_DIR = Join-Path $PWD 'tmp/spec-kit-cache'
uv venv --python 3.13 tmp/spec-kit-venv
uv pip install --python tmp/spec-kit-venv/Scripts/python.exe specify-cli==1.0.4
& ./tmp/spec-kit-venv/Scripts/specify.exe version
```

이미 설치된 자산은 다시 `init --force`하지 않습니다. 업그레이드할 때는 별도 임시
폴더에 아래 명령으로 생성한 뒤 constitution과 프로젝트 문서를 보존하며 diff를 검토합니다.

```powershell
& ./tmp/spec-kit-venv/Scripts/specify.exe init tmp/spec-kit-scaffold --integration codex --integration-options='--skills' --script ps --ignore-agent-tools --non-interactive
```

현재 feature를 선택하고 공식 prerequisite 검사를 실행합니다. 이 명령은 Git branch를
전환하지 않으며, 무시되는 `.specify/feature.json`에 checkout별 선택을 보관합니다.

```powershell
$env:SPECIFY_FEATURE = '003-translation-validation'
$env:SPECIFY_FEATURE_DIRECTORY = Join-Path $PWD 'specs/003-translation-validation'
& ./.specify/scripts/powershell/check-prerequisites.ps1 -Json -RequireSpec -RequireTasks -IncludeTasks
```

Codex가 이 저장소의 skills를 읽은 세션에서 `$speckit-specify`, `$speckit-plan`,
`$speckit-tasks`, `$speckit-analyze`, `$speckit-implement` 순으로 사용합니다.
설치 전에 열린 작업은 새 세션에서 발견 여부를 확인합니다. 기존 작업에서는 위
공식 PowerShell 명령과 명세 파일을 직접 사용할 수 있습니다.
공식 `taskstoissues`는 GitHub용이므로 이 프로젝트의 Linear 작업을 중복 생성하는 데
사용하지 않습니다.

출처·라이선스·파일 크기·SHA-256은 `.specify/upstream-assets.json`에 기록했습니다.
업스트림 자산은 LF로 고정하며 프로젝트가 작성한 constitution/spec은 별도로 관리합니다.

## Codex Security

입력에서 파일 쓰기까지의 경로를 확인하고, 실패 재현을 추가한 다음 공유 검증 경계에서
수정합니다. `codex-security:fix-finding`을 사용할 때는 해당 skill이 요구하는
독립 사전 조사와 후보 수정 리뷰를 수행합니다. 결과는 feature의 `verification.md`에
원래 재현·정상 입력·명령·결과·검증하지 않은 범위를 구분해 기록합니다.
이 연결은 Codex에서의 코드 리뷰 워크플로이며 원격 상시 스캔을 구성한 것은 아닙니다.

## Linear

[Tsukuru Agent 프로젝트](https://linear.app/david-lee-722/project/tsukuru-agent-e05ff1b625ae)를 사용합니다.
팀·프로젝트·이슈 ID는 [maintenance-integrations.json](maintenance-integrations.json)에 있습니다.
기존 이슈를 먼저 조회하고 동일 문제를 갱신합니다.

| 작업 | 증명할 내용 |
| --- | --- |
| DAV-38 | patch 좌표 누락·비정상 이웃을 쓰기 전에 차단 |
| DAV-39 | 수정하지 않는 이웃까지 범위 중첩 차단 |
| DAV-40 | 동일 파일의 별칭이 검증 그룹을 우회하지 않음 |
| DAV-41 | 명세·리뷰·이슈·오류 조회 연결 상태 기록 |

이슈에는 합성 재현과 검증 요약을 남깁니다. 로컬 검증, 커밋/병합, 배포 여부를
구분하며 게임 텍스트·로컬 개인 경로·인증 정보를 첨부하지 않습니다.

## Sentry

조직은 `the-voltex-club`, 프로젝트는 `tsukuru-agent`, API는
`https://de.sentry.io`입니다. 2026-09-08 교체 토큰으로 읽기 전용 조회가 성공했습니다.
확인한 범위인 최근 24시간·`prod` 환경·미해결 이슈의 결과는 0개입니다.
다른 환경·기간·해결된 이슈까지 0개라는 뜻은 아닙니다. 처음 제공된 토큰에서는
HTTP 403이 반환됐으며, 해당 실패와 교체 후 성공을 구분해 기록합니다.

Sentry 플러그인의 `sentry:sentry` skill과 번들 `scripts/sentry_api.py`를 사용합니다.
프로젝트 접근이 가능한 `project:read`, `event:read`, `org:read` 권한의 토큰을
현재 프로세스의 `SENTRY_AUTH_TOKEN`에 공급합니다. 토큰을 채팅·명령 인수·추적 파일에
기록하지 않습니다. 사용자가 지정한 로컬 토큰 파일을 읽는 경우 메모리에서만 파싱하고
호출 후 환경변수를 제거합니다. 파일 자체는 local Git exclude로 보호합니다.

`$sentryScript`를 설치된 Sentry 플러그인의 `skills/sentry/scripts/sentry_api.py` 경로로 설정한 뒤,
토큰 환경변수가 준비된 프로세스에서 다음 읽기 전용 명령을 실행합니다.

```powershell
python $sentryScript --base-url https://de.sentry.io --org the-voltex-club --project tsukuru-agent list-issues --time-range 24h --environment prod --limit 5 --query 'is:unresolved'
```

401/403이면 자격 증명·권한을 확인하고, 404이면 조직/프로젝트 slug와 지역을 확인합니다.
조회가 성공한 뒤에도 원시 이벤트·개인정보·게임 데이터는 이슈에 복사하지 않습니다.
이 작업은 유지보수 중 오류를 읽는 연결이며 앱에 Sentry SDK나 자동 전송을 추가하지 않습니다.
참고: [토큰 생성](https://docs.sentry.io/api/guides/create-auth-token/),
[API 권한](https://docs.sentry.io/api/permissions/).

## 최종 검증

애플리케이션 폴더에서 [CONTRIBUTING](../CONTRIBUTING.md)의 순서를 따릅니다.

```powershell
cd tsukuru-agent
npm run verify
npm run test:order
npm run benchmark:check
```

GUI/IPC·패키징 변경 시 해당 Electron·패키지 검증도 추가합니다. 로그는 무시되는
`tmp/`에 보관하고 검토 가능한 결과 요약은 feature 문서에 남깁니다.
