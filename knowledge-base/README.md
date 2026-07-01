# NyxelOS Knowledge Base (Obsidian Vault)

This is the Obsidian vault for the NyxelOS project. It serves as a living memory: architecture decisions, development progress, and concepts land here instead of disappearing into chat history.

Open this folder as a vault in Obsidian: "Open folder as vault" → select `knowledge-base/`. Once the `obsidian-local-rest-api` plugin is installed, NyxelOS itself (or, during development, Claude) can write directly into this vault via its local REST API or built-in MCP server.

## Structure

`00-Meta/` holds the project overview and core references such as the full architecture plan.

`01-Decisions/` holds Architecture Decision Records (ADRs) — every significant technical decision as its own dated note with context, alternatives, and rationale.

`02-Dev-Log/` holds chronological entries, one per work session, recording what was done and why.

## Convention for Future Changes

Every relevant architecture or implementation decision gets a new ADR under `01-Decisions/` (numbered sequentially, e.g. `ADR-0005-...md`). Every work session gets a new entry under `02-Dev-Log/` named by date. Existing entries are never overwritten, only added to — the vault should reflect the full history, not just the current state.
