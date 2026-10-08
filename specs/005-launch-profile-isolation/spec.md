# Feature Specification: Launch profile isolation

**Feature Branch**: `main` (feature directory is independent of branch)
**Created**: 2026-09-30
**Status**: Implemented and locally verified; private-game validation remains D22-06
**Input**: D22-04 — 실행 프로브의 앱데이터 프로필 격리를 진행한다.

## User Scenarios & Testing

### User Story 1 - Preserve the user's existing profile (Priority: P1)

Users can opt into a launch probe of a rebuilt game without altering their installed game, saves, settings, or caches in the existing user profile.

**Why this priority**: Copying game files alone does not protect saves stored outside the game directory.
**Independent Test**: A synthetic game with the same profile name as a canary profile writes saves during a probe; the canary inventory and hashes remain unchanged.

**Acceptance Scenarios**:

1. **Given** a supported game and an existing profile, **When** a launch probe writes a save, **Then** it writes only to a unique temporary profile and preserves the existing profile.
2. **Given** a game whose profile behavior cannot be safely isolated, **When** a launch probe is requested, **Then** execution is refused before starting the game with an actionable structured error.
3. **Given** two probes, **When** each creates profile data, **Then** neither sees the other's data.

### User Story 2 - Finish and clean up a probe (Priority: P1)

Users receive an honest outcome and can trust that a completed probe does not leave a running game or temporary profile behind.

**Why this priority**: A live child process can continue writing after the operation reports completion.
**Independent Test**: Exercise normal exit, launch failure, observation timeout and termination failure; check owned processes and temporary directories.

**Acceptance Scenarios**:

1. **Given** a running supported game, **When** observation completes, **Then** its owned process tree terminates before temporary profile removal.
2. **Given** a launch failure, **When** the operation returns, **Then** unused temporary files are removed and existing game/output data is preserved.
3. **Given** termination or cleanup cannot be confirmed, **When** the operation reports its result, **Then** it reports the incomplete state instead of success.

### Edge Cases

- A wrapper uses a platform profile directory rather than an environment variable.
- A wrapper resets its save location or uses an unsupported runtime.
- Existing environment variables attempt to inject runtime options or redirect the probe.
- A temporary path contains spaces or non-ASCII characters.
- A child keeps running after the main process exits, or a profile file remains locked.
- An archive enforces executable/archive integrity; isolation must not bypass that protection.

## Requirements

### Functional Requirements

- **FR-001**: The opt-in Electron launch probe MUST use a unique empty temporary profile in addition to the existing temporary game copy.
- **FR-002**: Supported profile paths and runtime caches MUST be redirected before game code executes; a same-name existing profile MUST remain unchanged.
- **FR-003**: Unsupported or unverified wrapper behavior MUST prevent game execution and return a structured failure with a reason.
- **FR-004**: Original games, staged output, user saves and parent-process profile settings MUST remain unchanged by isolation setup and cleanup.
- **FR-005**: Owned processes MUST terminate before their temporary profile is removed; unconfirmed termination or cleanup MUST be visible in the result.
- **FR-006**: Existing request compatibility and opt-in behavior MUST be preserved. Results MUST distinguish launch observation from proof of gameplay correctness.
- **FR-007**: Regressions MUST use synthetic content and cover real supported-runtime profile resolution, same-name canaries, failure, timeout, and cleanup. Private game content MUST stay out of tracked fixtures.

### Key Entities

- **Probe profile**: A unique temporary location owned by one launch attempt, with a bounded lifecycle.
- **Supported wrapper**: A runtime/save-path behavior for which isolation is established before launch.
- **Probe outcome**: Launch status plus evidence of isolation and lifecycle completion, or an explicit refusal/failure.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Every supported synthetic profile-write scenario leaves all existing canary files and their metadata unchanged.
- **SC-002**: Every unsupported scenario starts zero game processes.
- **SC-003**: Successful and normally failed probes leave zero owned processes and zero temporary probe directories; incomplete cleanup is reported explicitly.
- **SC-004**: Existing mandatory regression gates pass, and no original/private game needs execution to establish isolation support.

## Assumptions

- Scope is D22-04; full private-game gameplay/save-load validation remains D22-06.
- This is isolation of supported save/profile behavior, not an operating-system sandbox for arbitrary malicious executables.
- Unsupported wrappers are blocked rather than relying on an unverified environment-only redirect.
- Existing integrity gates and transaction/rollback mechanisms remain authoritative.
