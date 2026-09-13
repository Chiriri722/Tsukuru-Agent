# Working in this repository

Read `CONTRIBUTING.md`, `.specify/memory/constitution.md`, and
`docs/development-workflow.md` before maintenance changes. Select the intended
feature explicitly; the current maintenance feature is
`specs/003-translation-validation` on `chore/hardening-integration`.

Prefer codebase-memory-mcp graph tools for code discovery: `search_graph`,
`trace_path`, `get_code_snippet`, `query_graph`, then `get_architecture`.
Use text search for literals, configuration and documentation, or when graph
tools are unavailable or insufficient. Graph indexes belong to a checkout;
verify the indexed root and revision before trusting a returned snippet.

Use official repository-local `speckit-*` skills for specifications and plans.
Use the Codex Security plugin for security findings, the existing Linear
project for issue tracking, and the Sentry plugin for authorized read-only
error diagnosis. Non-secret integration IDs and verified query scope are in
`docs/maintenance-integrations.json`. Keep tokens and private crash/game data
out of tracked files and external issue descriptions.

Record reproductions, fixes and verification in the feature's tasks and
verification document. Distinguish local verification from commit, merge and
deployment. Preserve unrelated worktree changes. Follow the applicable
verification commands in `CONTRIBUTING.md` before reporting a fix complete.
