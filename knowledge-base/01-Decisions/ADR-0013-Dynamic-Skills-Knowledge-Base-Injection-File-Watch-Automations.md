---
tags: [adr, decision]
created: 2026-07-01
---

# ADR-0013: DB-Backed Dynamic Skills, Automatic Knowledge-Base Injection, and File-Watch Automations

Date: 2026-07-01
Status: accepted

## Context

Three gaps stood between NyxelOS and the "agentic OS" pitch in the product diagram (four levels: Skill + Loop Engineering, Memory + State, Interface/UI, Distribution):

1. The knowledge base (Phase 3) indexed the vault and ran a docs-agent sync loop, but its content was never actually handed to the model — a chat's system prompt only ever concatenated workspace custom instructions and the agent's own system prompt. "Memory" existed on disk but wasn't "state" the model could see by default.
2. Skills (Phase 1) were three hardcoded TypeScript files registered once at process startup. There was no UI to create a new skill, and no skill kind covered generic file access (read/write/list) — a core "agentic OS" capability implied by the diagram's "Loop Engineering" level.
3. Automations (Phase 2) only supported cron schedules. Event-driven automation (the kind implied by "good automations") — e.g. "run this agent whenever a file changes" — didn't exist.

## Decision

**Knowledge-base auto-injection.** `getKnowledgeBaseContextForPrompt(workspaceId)` in `apps/server/src/knowledge-base.ts` builds a bounded context block — a full note index (path + title) plus the full text of `00-Meta/*` notes and the most recently modified notes, capped at ~6000 characters — and appends it to the system prompt built in `chat-stream.ts` and `scheduler.ts` (both the live chat path and the headless automation path). A new per-workspace `knowledge_base_config.inject_into_prompts` flag (default on) lets a workspace opt out; the Knowledge Base page exposes it as a toggle.

**Dynamic, DB-backed skills.** A new `skill` table stores workspace-scoped skills defined by a declarative `kind` (`http_fetch`, `file_read`, `file_write`, `file_list`, `kb_search`, `custom_code`) plus a JSON `config` (allowed hosts/directories, or a code body for `custom_code`), instead of hand-written TypeScript. `apps/server/src/skills-dynamic.ts` turns a DB row into the same `SkillDefinition` shape the hardcoded skills already use (`packages/skills-sdk`), reusing the SDK's permission-checked fetch/file context (`createSkillContext`, now exported) rather than re-implementing host/path allow-listing. `apps/server/src/skills-resolve.ts` merges the process-wide hardcoded registry ("builtin") with a workspace's dynamic skills ("custom") for both tool-building (`tools.ts`) and the catalog shown in the UI. `file_write` and `custom_code` default to `sensitive: true` (approval required) for the same reason `write_note` did in ADR-0009 — an unmarked skill is treated as if it could do something irreversible.

A new "Skills" tab (`apps/web/.../skills/page.tsx`) covers both halves of the ask: selection (enable/disable/delete custom skills; builtins are always on) and creation (pick a kind, fill in its config, write custom code if needed).

**File-watch automations.** `automation` gained `triggerType` (`cron` | `file_watch`), `watchPath`, `watchGlob`, and `lastWatchCheckAt`. The existing 30-second scheduler poll (ADR-0010) now also calls `checkFileWatchAutomations()`, which lists changed files under `watchPath` since the last check (optionally filtered by a filename suffix) and runs the automation with the changed-file list appended to its prompt — skipping the very first check after creation so pre-existing files don't look "changed". The Automations page gained a trigger-type selector with conditional fields.

## Consequences

- Every chat, automation, and scheduled agent run in a workspace now sees the same living project memory by default, without the user having to paste it in or the agent having to go fetch it — matching the original requirement to "always work with a knowledge base that gets automatically passed to the model".
- Skills are no longer a fixed, code-only list — a user can grant an agent file access (read/write/list) or knowledge-base search from the UI in under a minute, and the DB row is the source of truth (no server restart needed).
- `custom_code` skills run in-process with the same trust model as every other skill (ADR-0007): the permission context stops *accidental* out-of-scope access, not a *deliberately* malicious skill, which could still reach other Node/Bun APIs directly. This is an explicit, documented trade-off, not an oversight — real sandboxing (separate worker/container per skill) remains a follow-up.
- Automations can now react to the filesystem, not just the clock, which is the more common "automation" mental model for non-cron users.
- `skillRegistry.run()` is no longer called from `apps/server` — `tools.ts` and `approvals.ts` now resolve skills through `skills-resolve.ts` and call `skill.run()` directly against a scoped context, so both builtin and dynamic skills share one execution path.
