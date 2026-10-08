# Feature Specification: Compact RPG translation packs

**Feature Branch**: `main` (existing uncommitted work preserved)

**Created**: 2026-10-02

**Status**: Implemented and locally accepted; see [verification.md](verification.md)

**Input**: Improve script extraction for mixed RPG Maker/plugin games, including Live2D, and verify all three user-provided laboratory copies.

## User Scenarios & Testing

### User Story 1 - Extract a clean translation pack (Priority: P1)

A translator selects a mixed RPG Maker game and a separate output folder. The
result contains editable text and the original data needed to put it back,
without an extra copy of the game's graphics, audio, models or runtime.

**Why this priority**: Current archive extraction expands the entire game payload
before text extraction, making a small translation task unnecessarily large.

**Independent Test**: Extract the two archived games and the loose game. Inventory
every output file and compare original inputs before and after.

**Acceptance Scenarios**:

1. **Given** an archived or loose RPG Maker MV/MZ game, **When** clean extraction
   is requested, **Then** one separate portable translation pack is published.
2. **Given** a game containing Live2D or other plugins, **When** text is extracted,
   **Then** model, motion, image, audio and runtime files are not copied to the pack
   or expanded in its temporary extraction workspace.
3. **Given** extraction fails or the destination conflicts, **When** the operation
   ends, **Then** the source and any prior output remain unchanged.

### User Story 2 - Edit, verify and safely reapply (Priority: P1)

A translator can move the pack, edit mapped text, validate it and reconnect it
to the original game to create a separate patched copy. Plugin and Live2D
resources keep their original bytes when only dialogue or a title changes.

**Why this priority**: Small text files without reliable mappings and a supported
return path would strand translation work.

**Independent Test**: Run extraction, deep verification, a small patch, reapply
and output comparison. Use the three private copies plus publishable fixtures.

**Acceptance Scenarios**:

1. **Given** a moved pack, **When** verification or patch is requested, **Then**
   its engine, source mapping and original text remain identifiable.
2. **Given** its matching source, **When** an approved mapped edit is applied,
   **Then** a separate output contains that edit and preserves unrelated files.
3. **Given** stale input, invalid mapping, links or unsafe paths, **When** apply
   is requested, **Then** it fails before publishing an incomplete output.

### User Story 3 - Understand plugin coverage (Priority: P2)

A translator can see which extraction profile includes plugin parameters and
event scripts, which resource references must remain unchanged, and any limits
of static extraction. Existing workflows continue to behave as before.

**Why this priority**: A plugin's internal identifiers and model filenames are
not interchangeable with dialogue, and must not be silently presented as safe
automatic translation targets.

**Independent Test**: A synthetic plugin fixture and static evidence from all
three games demonstrate documented coverage and preserved resource links.

**Acceptance Scenarios**:

1. **Given** a plugin-enabled game, **When** a pack is created, **Then** selected
   text scope and plugin/script limitations are clearly reported.
2. **Given** an existing extraction request without the new option, **When** it
   executes, **Then** its existing output layout and versioned contract remain valid.

### Edge Cases

- Existing source-side extraction artifacts are not mistaken for original inputs.
- Unsupported archive metadata retains the existing diagnostic/repack opt-in boundary.
- Missing source, changed archive, changed loose inputs, linked paths, malicious
  metadata, cancellation and insufficient resources cannot publish partial output.
- Resource-decryption requests conflict with a text-only pack and are rejected.
- Non-RPG engines cannot silently accept the RPG-only clean extraction option.
- Plugin code is inspected statically; scripts are never executed to extract text.

## Requirements

### Functional Requirements

- **FR-001**: Provide an explicit clean extraction mode for RPG Maker MV/MZ
  Electron ASAR and loose games, preserving existing default behavior. Packaged
  NW archives retain their existing workflow and explicitly reject the new mode.
- **FR-002**: Publish only mapped editable text, original translation inputs,
  mapping and source-identification metadata to a separate destination.
- **FR-003**: Do not expand or copy unrelated runtime, media, save or Live2D
  assets during clean extraction, including its temporary work.
- **FR-004**: Preserve existing text profiles and disclose plugin parameter,
  event-script and resource-reference coverage without executing plugin code.
- **FR-005**: Support moved-pack verification and patching, with accurate engine identity.
- **FR-006**: Support safe reapplication against the matching original source,
  preserving unrelated plugin scripts, assets and archive integrity policies.
- **FR-007**: Reject malformed metadata, stale inputs, unsafe paths and conflicting
  options; failed operations leave original and existing output bytes unchanged.
- **FR-008**: Verify all three provided copies and record pack size, extracted
  entry count, source preservation and round-trip differences using private local
  evidence. Publish only anonymized results and synthetic fixtures.
- **FR-009**: Add focused failing regression coverage before implementation and
  finish repository-required validation. Preserve feature 004/005 local work.

### Key Entities

- **Translation pack**: Editable text, immutable source inputs, stable mappings
  and compact metadata that can travel separately from the game.
- **Source identity**: Engine, layout and content fingerprints used to reconnect
  a pack to its matching source without trusting a remembered absolute path.
- **Extraction coverage**: Selected profile and known plugin/script limits.

## Success Criteria

### Measurable Outcomes

- **SC-001**: All three copied games produce independently verifiable packs
  containing zero unrelated media/model/runtime files.
- **SC-002**: Each pack occupies less than 10% of its source game's bytes, and
  extraction creates no temporary full-game expansion.
- **SC-003**: A small mapped edit round-trips on all three games; every unrelated
  source file and protected output asset retains its original content.
- **SC-004**: Old requests pass compatibility tests, and adverse-path tests prove
  source preservation and no partial publication.

## Assumptions

- The user-provided copies are authorized private verification material; source
  games and private dialogue will not be committed or uploaded.
- “Scripts” means the text and mapped script/parameter fields supported by the
  selected extraction profile, not an unbounded decompiler for arbitrary plugins.
- The source game is required only for recreating a playable output. The compact
  pack supports verification and translation without the runtime.
- Gameplay, complete Korean translation and automatic translation of executable
  plugin bodies are separate work; structural round-trip evidence is recorded honestly.
