# Feature Specification: Local translation review preparation

**Feature Branch**: `main` (feature context is independent of the branch)

**Created**: 2026-09-29

**Status**: Implemented and accepted locally; not committed or released

**Input**: Review the user's Pro comparison and independently adopt useful ideas from other tools, preserving Tsukuru's existing safety guarantees.

## User Scenarios & Testing

### User Story 1 - Read source context before translating (Priority: P1)

A translator selects entries from an extracted RPG Maker MV/MZ workspace and
receives a local review document containing the original, current text and
source location. Dialogue is grouped using the original event structure. Names,
descriptions, system terms and plugin/script/note text remain distinguishable.

**Why this priority**: Adjacent translated lines can belong to different events;
reliable context prevents reviewing an unrelated passage as one conversation.

**Independent Test**: A synthetic workspace with two pages and a changed
translation yields separate source groups and leaves every input byte intact.

**Acceptance Scenarios**:

1. **Given** dialogue on separate pages or indentation levels, **When** reviewed,
   **Then** groups never cross these boundaries and retain each original entry ID.
2. **Given** an explicit speaker or no speaker, **When** reviewed, **Then** the
   speaker's source and certainty are stated; a face graphic is not a named speaker.
3. **Given** a stale hash, missing source, conflicting mapping or unknown selected
   ID, **When** reviewed, **Then** no misleading report replaces an earlier report.

### User Story 2 - Inspect the translation request and relevant terms (Priority: P2)

A translator supplies a versioned glossary and explicit source/target languages
to prepare an offline request preview for selected entries. Only relevant terms
and source context appear; no translation service is contacted.

**Why this priority**: The user can inspect context and terminology before deciding
whether or where to send private game text.

**Independent Test**: Overlapping long/short terms, an independent short occurrence
and competing glossary priorities produce a deterministic bounded selection.

**Acceptance Scenarios**:

1. **Given** user, manual and derived definitions for a term, **When** selected,
   **Then** user takes precedence over manual, then derived definitions.
2. **Given** a short term contained within a longer one and appearing independently,
   **When** selected, **Then** the independent short occurrence remains represented.
3. **Given** repeated requests with identical inputs, **When** prepared,
   **Then** content fingerprints match; changing source, translation, context or
   glossary changes the relevant fingerprint.

### Edge Cases

- Orphan dialogue commands, dynamic speaker names and unsupported plugin context.
- Empty selections, duplicate/unknown IDs, oversized requests and ambiguous glossary definitions.
- Report targets inside the workspace, through links or colliding with other outputs.
- Cancellation before publication and failures while replacing an existing report.
- Preserved original text is not evidence of a successful translation.

## Requirements

### Functional Requirements

- **FR-001**: Review must bind each entry to validated original source, current
  text and its existing stable ID; it must never regroup by edited text adjacency.
- **FR-002**: Review must expose source file/path, category, message group and
  available event/page/command location, with explicit unavailable context.
- **FR-003**: Explicit, inferred and unknown speaker evidence must not be confused.
  This first increment uses explicit evidence only and labels the rest unknown.
- **FR-004**: Selection and context must have documented limits and disclose omissions.
- **FR-005**: Optional request preparation must require explicit languages and
  deterministically select relevant glossary terms with user > manual > derived
  precedence, longer non-overlapping occurrences first and a documented term cap.
- **FR-006**: Reports must contain revision fingerprints for source/current text,
  context and glossary. They are review aids, not authorization to apply changes.
- **FR-007**: Preparation must not contact networks, execute game/plugin code or
  change input files. Private text belongs only in the explicitly requested local
  report, never ordinary stdout diagnostics or diagnostic reports.
- **FR-008**: Invalid mappings/selections/targets and cancellation must preserve
  inputs and any previous report; publication must be transactional.
- **FR-009**: Existing requests and patch/apply workflows must remain compatible;
  this increment adds no alternate mutation or automatic translation route.

### Key Entities

- **Review entry**: stable ID, source location, original/current text, category,
  source/current fingerprints and source-derived context.
- **Message group**: source event boundary, original lines and explicit speaker evidence.
- **Glossary**: revision and prioritized term definitions, separate from an ID-to-translation dictionary.
- **Request preview**: selected entries, explicit languages, selected terminology
  and revision fingerprints, identified as offline and unapproved.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Every selected valid fixture entry retains its original ID and
  location; all cross-page/event/indent isolation cases pass.
- **SC-002**: All stale/malformed/unknown-ID fixtures fail without input or prior
  report changes; successful preparation also preserves every input byte.
- **SC-003**: Glossary fixtures cover every precedence level and overlapping
  occurrence case with deterministic results and no limit overflow.
- **SC-004**: A user can generate and inspect a bounded local request preview
  using one documented command without provider credentials or network traffic.

## Assumptions

- The first adopted bundle is the Pro report's recommended context + glossary
  preparation. Existing extraction, lint, hashing and patch safety are reused.
- RPG MV/MZ extracted workspaces with intact Backup/mapping/manifest are the
  supported input. Other engines retain their existing verification behavior.
- Automatic translation, proposal import/retry, full map rendering, runtime
  preview and legacy engine translation are separate future work. Runtime
  preview additionally depends on the already recorded D22 profile isolation gate.
- External implementation source will not be copied or inspected for this
  implementation. Requirements come from the user report and public READMEs;
  this is independent implementation, not a legal clean-room certification.
