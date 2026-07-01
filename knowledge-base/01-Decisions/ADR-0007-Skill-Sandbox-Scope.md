---
tags: [adr, skills, security]
created: 2026-07-01
status: accepted
---

# ADR-0007: Skill Sandboxing Is Permission-Scoped, Not Process-Isolated

## Context

ARCHITECTURE.md section 8 calls for custom skills the user (or a bundled default set) can install, each declaring what it's allowed to touch. Real OS-level sandboxing — separate processes, containers, or a WASM runtime per skill — is the eventual goal for running untrusted, community-authored skills safely. Building that first would have blocked Phase 1 on infrastructure the project doesn't need yet: every skill shipped in this phase (`get_current_time`, `web_fetch`) is first-party code reviewed by the same person building the agent runtime.

## Decision

`packages/skills-sdk` enforces permissions in-process rather than out-of-process. A `SkillDefinition` declares `permissions: { network: string[], filesystem: string[] }` (allowed hosts, allowed directories). `SkillRegistry.run()` never gives a skill the ambient `fetch`/`fs` — it constructs a `SkillContext` whose `fetch` checks the target hostname against `permissions.network` and whose `readFile`/`writeFile` resolve and check the target path against `permissions.filesystem`, throwing `SkillPermissionError` otherwise (`src/runtime.ts`). This stops a skill from *accidentally* reaching an undeclared host or path, and gives agent configuration UI something concrete to display and let users audit before attaching a skill to an agent.

This is explicitly documented, in both `types.ts` and `runtime.ts`, as best-effort: a skill is still normal TypeScript running in the same Bun process as the server, so a deliberately malicious skill could import `node:fs` or global `fetch` directly and bypass the scoped context entirely. There is no seccomp, no separate OS user, no container boundary.

## Consequences

Safe today because skill authorship is fully trusted (first-party only) — the permission system's job right now is catching bugs and documenting intent, not defending against adversarial code. Before Nyxel supports installing skills from anyone other than the project itself, this needs to be revisited: candidates are running each skill in a separate worker/subprocess with OS-level restricted permissions, or compiling skills to WASM and running them in a runtime like `wasmtime` with capability-based imports (only the scoped `fetch`/`fs` shims wired in, no ambient Node APIs available at all). That upgrade should be transparent to `SkillDefinition` authors — the `run(input, ctx)` shape doesn't need to change, only what's underneath `ctx` and where `run` actually executes.
