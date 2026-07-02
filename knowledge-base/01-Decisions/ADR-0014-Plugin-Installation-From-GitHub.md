---
tags: [adr, decision, skills, plugins]
created: 2026-07-02
status: accepted
---

# ADR-0014: Plugin Installation From GitHub (Folder-Based Bundles)

Date: July 2, 2026
Status: accepted

## Context

The file-based skills added in ADR-0013 are deliberately flat: one `.md`
file per skill, its body returned verbatim when invoked. That's the right
shape for a hand-written or hand-imported skill, but it can't represent a
real-world Claude Code plugin — a folder carrying `.claude-plugin/plugin.json`,
multiple `skills/<name>/SKILL.md` bundles each with their own supporting
scripts/references/assets, `agents/*.md` sub-agents, and arbitrary other
files (docs, install scripts, test fixtures). Importing one of these by URL
(`skills.importFromUrl`) only ever pulls a single `SKILL.md` and discards
everything else the plugin ships — exactly the gap ARCHITECTURE.md section 8
calls "Plugins are larger extensions that can bundle multiple skills."

## Decision

**Folder-bundle skills.** `packages/skills-sdk/src/file-skill.ts` gained
`loadFileSkillBundle`/`loadFileSkillBundlesFromDir`, which load a
`SKILL.md` + supporting-files directory as one `SkillDefinition` (id prefix
`file_skill_bundle__`). Its `run()` still only returns text, per the
existing file-skill design — the `SKILL.md` body plus a manifest of the
supporting files' absolute paths — so the model reads them on demand with
its own file tools instead of the whole bundle being inlined up front.

**A new `plugin` table** (`apps/server/src/plugins.ts`,
`packages/db/src/schema/*/app.ts`) records an installed plugin: slug, parsed
manifest fields, the full `.claude-plugin/plugin.json` blob, the ids of the
skills it contributes, parsed `agents/*.md` definitions (stored for display
only — NyxelOS agents are DB rows with their own model/tool config, not
files, so these aren't auto-instantiated as runnable agents), file count,
and where its files live on disk.

**Installation from a GitHub repo URL** (`installPluginFromGithub`) resolves
the repo's default branch, lists its full file tree via the git trees API,
downloads every blob (skipping only pathological >25MB files, reported back
rather than silently dropped), and writes them preserving folder structure
under `PLUGINS_ROOT/<workspaceId>/<slug>/`. `PLUGINS_ROOT` is deliberately
nested under the shared `workspaceRootDir` (not a separate location like
`NYXEL_SKILLS_DIR`) so the existing workspace file tools — already scoped to
`workspaceRootDir` — can read a plugin's supporting files without any new
permission wiring. Repos without a `.claude-plugin/plugin.json` still
install successfully (name/description fall back to the repo name), so this
covers "other Plugins" too, not just the Claude Code format specifically.
Re-installing an already-installed slug replaces its files and DB row,
acting as an update.

Plugin-contributed skills merge into the existing workspace skill catalog
(`skills-resolve.ts`, `source: "plugin"`) and resolve through the same
`resolveSkillDefinition` path chat/automation tool-building already uses.
The Skills page shows them read-only with a link back to Plugins; a new
Plugins page (`/workspace/[id]/plugins`) covers install-by-URL, per-plugin
enable/disable, expandable skill/sub-agent listings, and uninstall.

## Consequences

- A plugin repo's full folder context survives the import — scripts,
  references, docs, tests, everything — rather than being flattened to one
  skill's markdown body, closing the gap file-skill.ts's original comment
  flagged ("no folder-with-supporting-files bundles yet").
- No dedicated `plugin` audit-actor kind was added; plugin install/uninstall
  reuse `actor: "extension"` in the audit log rather than adding a Postgres
  enum migration for one more value that means almost the same thing.
- Sub-agents a plugin ships are surfaced for visibility but not wired into
  NyxelOS's own agent runtime — bridging Claude Code's file-based sub-agent
  format into NyxelOS's DB-backed agent configuration (model, autonomy,
  tool/skill assignment) is a real design decision on its own and stays a
  follow-up rather than being auto-decided here.
- Installing a plugin still runs first-party trust assumptions (ADR-0007):
  a plugin's `custom_code`-equivalent (arbitrary scripts) isn't sandboxed
  beyond the same permission-scoped context every skill gets — a plugin
  marketplace with untrusted authors needs the process/container isolation
  ADR-0007 already flags as a follow-up before it's safe to install
  community plugins by default.
