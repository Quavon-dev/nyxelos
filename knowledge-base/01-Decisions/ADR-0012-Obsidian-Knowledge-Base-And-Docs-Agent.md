# ADR-0012: Obsidian Knowledge Base and Automatic Docs Agent

Date: 2026-07-01
Status: accepted

## Context

Phase 3 of the roadmap introduces Obsidian as the living knowledge base and requires an automatic docs agent that keeps the vault current as development continues.

## Decision

NyxelOS keeps the canonical project knowledge base in the repository's `knowledge-base/` vault and treats Obsidian as a file-first system. The server indexes markdown files directly from disk for browsing and graph rendering, optionally checks the local Obsidian REST API for reachability, and runs a background docs-agent sync loop that appends development notes based on recent audit-log activity and recently modified code files.

## Consequences

- The vault remains readable and editable even without Obsidian running.
- The UI can render a graph view without depending on the Obsidian app.
- The docs agent has a durable cursor (`lastDocsSyncAt`) and can resume after restarts.
