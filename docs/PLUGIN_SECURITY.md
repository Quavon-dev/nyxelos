# Plugin & Skill Security Model

Companion to [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) (see SEC-03, SEC-08, SEC-09) — this document is the fuller threat model for NyxelOS's three extensibility surfaces: **skills**, **plugins**, and **MCP servers** (`docs/ARCHITECTURE.md` section 8). It describes what's actually enforced today (not what's aspirational — see the doc/code mismatches flagged below), and a staged plan to close the gap, without requiring the Plugin/Skill Runtime rewrite this audit is explicitly not doing.

## What runs, and where

| Source | Defined by | Runs as | Permission enforcement |
|---|---|---|---|
| Builtin skills | `packages/skills-sdk/src/skills/*.ts`, hand-written, shipped with the app | In-process, same as server code | N/A — trusted first-party code |
| Custom skills | Workspace `skill` table row (kind + JSON config), created via the Skills tab, no restart needed | In-process, dynamically built by `apps/server/src/skills-resolve.ts` (config-driven: HTTP fetch, file read/write/list, KB search, or short custom-code function) | `SkillPermissions` checked via `packages/skills-sdk/src/runtime.ts` |
| Plugin skills | Downloaded from an arbitrary GitHub repo (`apps/server/src/plugins.ts`), `SKILL.md`/`skills/*/SKILL.md` files parsed and loaded as `SkillDefinition`s | In-process, same runtime as above | Same `SkillPermissions` check, IF the skill only uses `ctx.*` |
| MCP tools | A connected MCP server (catalog entry in `apps/server/src/mcp-connectors.ts`, a custom server, or a local `stdio` process) | **Out-of-process** — either a remote HTTP endpoint or a locally spawned subprocess (`command`/`args` on the `mcpServer` record) | tRPC/approval-layer gating only; the MCP server itself is a black box once connected |

## The core gap: permission profile is advisory, not enforced, for skill/plugin code

`packages/skills-sdk/src/runtime.ts` builds a `SkillContext` whose `readFile`/`writeFile`/`fetch`/etc. are checked against the skill's declared `SkillPermissions` (`assertPathAllowed`, `hostAllowed`). This works correctly — verified in this audit with 8 new tests in `packages/skills-sdk/src/runtime.test.ts` (path traversal, absolute-path escape, sibling-directory-prefix trick, and host-allowlist substring trick all correctly rejected).

**But it only constrains code that calls through `ctx.*`.** A skill's `run(input, ctx)` function is plain TypeScript executing in the same process, with the same access to `process.env`, `require("node:fs")`, `require("node:child_process")`, global `fetch`, etc. as the server itself. Nothing stops a skill from ignoring `ctx` entirely. The runtime's own source comment says this directly: *"it is not a security boundary against a deliberately malicious skill... Process- or container-level isolation is tracked as a follow-up; see ADR-0007."*

`docs/ARCHITECTURE.md` section 12 currently says skills "run in isolated worker processes" — that line describes the ADR-0007 target, not the current implementation, and should be corrected or clearly marked "planned" (see `SECURITY_AUDIT.md` SEC-03 / backlog `BL-03`).

## Plugin install pipeline — what is and isn't checked

`installPluginFromGithub()` in `apps/server/src/plugins.ts`:

1. Parses an `owner/repo[/tree/ref]` string from user input (`parseGithubRepoUrl` — well-tested, `plugins.test.ts`).
2. Resolves the default branch if no ref given, fetches the full repo tree via the GitHub REST API (unauthenticated — subject to GitHub's public rate limit, ~60 req/hr per IP, shared across all workspaces on that server).
3. Downloads every blob under `MAX_FILE_BYTES` (25MB), preserving folder structure, into `PLUGINS_ROOT/<workspaceId>/<slug>/`.
4. Registers every `skills/<name>/SKILL.md` (or root `SKILL.md`) as a loadable skill, parses `agents/*.md` as display-only sub-agent definitions.

**Checked:** repo tree size (GitHub truncation error surfaced), per-file size, that the URL parses as a GitHub repo.
**Not checked:** author/maintainer identity or reputation, commit signature, file contents against any allowlist/denylist, whether `SKILL.md` bodies contain code that reaches outside `ctx.*` (see above), whether the same slug was previously installed by a different, unrelated repo (slug collision is handled — `slugify()` + reinstall-replaces-existing — but that's a UX safeguard, not a security one).

This matches the project's own roadmap (`ARCHITECTURE.md` Phase 6: *"Remaining: ... signed plugin manifests"*) — it is a known, tracked gap, not a surprise. This document exists so the gap is visible in the security-specific docs too, not just the phased roadmap.

## Threat scenarios

1. **Malicious plugin author.** A user pastes a GitHub URL for a plugin that looks legitimate (README, screenshots, a real `SKILL.md`) but whose `run()` function reads `process.env` and `fetch()`s it to an attacker-controlled URL, or shells out via `Bun.spawn`/`child_process`. Nothing in the install or load pipeline would catch this. Mitigated only by the approval workflow if the skill is marked `sensitive: true` — but the plugin author controls that flag too (it's part of the skill definition they ship).
2. **Compromised upstream repo.** A previously-trustworthy plugin repo is compromised (maintainer account takeover, malicious PR merged) and a user reinstalls/updates — `installPluginFromGithub` always re-downloads and replaces on reinstall, so there's no version pinning protecting an existing install from picking up a newly-malicious update on next reinstall. (A *first* install pins to a ref only if the user explicitly used `/tree/<ref>` in the URL; the default is "current default branch," which moves.)
3. **MCP server as a black box.** A custom or catalog MCP connector, once connected, can offer any tool with any name/description at call time — the client (`packages/mcp-client`) trusts what the server advertises. This is inherent to the MCP protocol as currently specified and not specific to NyxelOS, but worth noting: the "same permission dialog before activation" (`ARCHITECTURE.md` section 8) is a one-time approval of *connecting*, not a per-tool-call permission profile the way skills have.

## Staged mitigation plan (does not require Plugin/Skill Runtime rewrite)

These are ordered cheapest-and-safest first; none require the isolation work in ADR-0007 to land first.

1. **Correct the docs** (`ARCHITECTURE.md` section 12, this file) to state plainly that the permission profile is enforced for `ctx.*`-based access only, not a sandbox. Zero code risk, immediate. → backlog `BL-03`. **Done** — section 12 rewritten.
1.5. **Kill switch (done, this session).** Rather than wait for stages 2–5, both entry points for unsandboxed code execution are now disabled by default in production: `installPluginFromGithub` (`apps/server/src/plugins.ts`) refuses to run unless `ENABLE_REMOTE_PLUGIN_INSTALL=true`, and the `custom_code` tool kind (`apps/server/src/tools-dynamic.ts`) refuses to run unless `ENABLE_CUSTOM_CODE_SKILLS=true`. Both default to enabled outside production (`NODE_ENV !== "production"`) so local dev is unaffected. See `apps/server/src/feature-flags.ts` + `feature-flags.test.ts`. This is coarser than stages 2–4 below (all-or-nothing per server, not per-plugin) but closes the "silently on in prod" gap immediately without touching the plugin/skill runtime.
2. **Warn at install time.** The Plugins page install dialog could surface a static, non-blocking warning: "Plugins run with the same access as the server itself; only install plugins from sources you trust." This is a UI copy change, low risk, high value given #1. **Not done** — still open.
3. **Ref-pin by default.** When no `/tree/<ref>` is given, resolve and store the *commit SHA* (not just branch name) at install time, and only move forward on an explicit "check for updates" action rather than silently re-resolving the default branch on every reinstall. Reduces threat scenario #2 to an explicit, auditable user action. **Not done** — still open.
4. **Static scan on install.** Before registering a downloaded `SKILL.md`'s code as runnable, grep the file for high-risk identifiers (`child_process`, `process.env`, `require(`, `eval(`, raw `fs.` outside the `ctx` pattern) and surface a warning listing what was found, without blocking install. Cheap, no runtime cost, no false-negative-free but raises the bar for casual/careless plugins. **Not done** — still open.
5. **Process isolation (ADR-0007's real fix).** Longer-term: run skill/plugin `run()` calls in a Bun `Worker` or a short-lived subprocess with its own restricted environment (only the env vars the skill's declared permissions justify) and IPC-based `ctx.*` calls back to the main process. This is the only item on this list that actually closes the gap rather than raising the bar — it's also the only one that's a genuine Skill Runtime change, correctly out of scope for anything short of a dedicated design effort.

Full backlog entries with acceptance criteria: see `AGENTIC_OS_BACKLOG.md` items `BL-03`, `BL-08`.
