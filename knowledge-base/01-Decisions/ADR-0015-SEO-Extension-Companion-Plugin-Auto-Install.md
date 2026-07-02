---
tags: [adr, decision, extensions, plugins, seo]
created: 2026-07-02
status: accepted
---

# ADR-0015: SEO Extension Auto-Installs Its Companion Plugin, Fixer Agent Is Category/Model-Aware

Date: July 2, 2026
Status: accepted

## Context

ADR-0014 added plugin installation (full folder-based GitHub bundles), but
installing a plugin and installing the SEO/GEO/AEO Analyzer extension
(ADR from Phase 6) were two disconnected actions — a user had to install the
extension in Settings, then separately go to the Plugins page and paste the
claude-seo repo URL, and even then nothing in `seo-analyzer.ts` actually
*used* the plugin's skills or sub-agent personas. The extension's fixer
agent always ran on the workspace's casual default chat model and never
drew on any installed plugin, no matter what was installed — a plugin
sitting unused in the skill catalog isn't "implemented," it's dead weight.

## Decision

**Auto-install.** `ExtensionCatalogEntry` gained an optional
`pluginRepoUrl` (`extensions.ts`); the SEO/GEO/AEO Analyzer entry points at
`https://github.com/AgricIDaniel/claude-seo`. `plugins.ts` gained
`ensureExtensionPlugin(workspaceId, repoUrl)` — installs the repo the first
time the extension activates in a workspace (`findPluginByRepoUrl` skips a
redundant reinstall on repeat activation) and *never throws*: a failed
install (no network, rate-limited, whatever) is reported back as a result
object, not an exception, so it can never block the extension itself from
activating. `extensions.install` in the tRPC router now returns
`{ extension, pluginInstall }`, and the Settings → Extensions marketplace
card surfaces the result (skill/agent counts on success, a retry pointer to
the Plugins page on failure).

**The fixer agent actually uses it.** `ensureSeoFixerAgent` became
`configureSeoFixerAgent(project, categories)`: on every dispatch (a fix
batch or a blog draft), it looks up the installed companion plugin, matches
its skills and parsed sub-agent personas (`agents/*.md`) against the
finding categories in play via keyword heuristics (deliberately generic
substring matching, not a hardcoded claude-seo skill list — any repo can be
installed here), and refreshes the *same* auto-provisioned agent's
`skillIds`/`systemPrompt`/`modelId` before the run — rather than freezing
whatever was configured the first time it ran. A user-pinned, non-auto
agent (via `setFixerAgent`) is left untouched, same as before. Skill
matching falls back to *every* plugin skill when nothing matches a category
(never silently unused); persona matching just skips augmentation when
nothing matches (unlike skills, an unmatched full persona block would only
bloat the prompt with guesswork).

**Model selection.** `pickBestModelIdForSeo` ranks the workspace's actually
installed models by known high-end family name fragments (opus, gpt-5,
o3, gemini-2.5-pro, sonnet), explicitly skipping cheap variants
(mini/haiku/flash/nano/lite), and falls back to the workspace default (then
to any installed model) if nothing ranks. This is a heuristic, not a real
capability lookup — Nyxel has no per-model benchmark data — but it means
SEO fixes and blog drafts run on a stronger model by default than whatever
casual default is set for everyday chat, without requiring the user to
manually override anything per-project.

**More visible stats.** A new `listSeoFindingsByProject` DB method (all
findings, resolved + open, vs. the existing open-only query) backs a new
`seoAnalyzer.listAllFindings` endpoint. The extension's Overview tab gained:
score delta vs. the previous run, total runs/findings-ever/resolved/
resolution-rate tiles, a lightweight score-trend strip (plain divs, no
charting library — matches the app's existing chart-free aesthetic),
open-findings-by-category/severity proportion bars, blog-post status
counts, and a "SEO plugin" card reporting exactly what's installed and
how many skills/personas the fixer draws on. `dispatchSeoFix`'s return
type gained `modelId`/`pluginSkillsUsed` so "Fix with AI" shows which
model and which specialist skills actually ran, instead of leaving that
invisible.

## Consequences

- Installing the extension is now a one-click "get a working SEO analyzer
  with real specialist skills," not "get a shell you then have to
  separately populate."
- The category-matching heuristic is honest about being a heuristic — a
  plugin whose skill/agent naming doesn't hit any keyword still gets used
  (fallback to everything for skills), it just doesn't get a tailored
  system-prompt persona callout.
- Reconfiguring the same agent row per dispatch (rather than creating a new
  agent per category or per plugin) keeps the Agents page from filling up
  with one-off agents, at the cost of the agent's config only reflecting
  the *most recent* dispatch's categories if inspected outside of an active
  run — acceptable since the agent is purpose-built for this extension's
  dispatch flow, not meant to be browsed as a standalone agent.
- This sandbox's GitHub network access is scoped to this repo only, so the
  auto-install path was verified end-to-end against a mocked GitHub
  API/raw-content server reproducing claude-seo's real manifest/skills/
  agents layout, *and* separately verified against the real (blocked)
  network to confirm the best-effort failure path — extension still
  activates, failure is surfaced with a retry pointer, exactly as designed.
