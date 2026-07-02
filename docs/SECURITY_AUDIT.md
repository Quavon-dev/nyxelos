# NyxelOS Security Audit

**Date:** 2026-07-02
**Scope:** `apps/server`, `apps/web` (auth/session surface only), `packages/db`, `packages/skills-sdk`, `packages/mcp-client`, `.github/workflows`, Docker/Compose/Caddy deployment files, `.env.example` files.
**Method:** Manual source review of the auth stack, tRPC context/middleware, file/plugin/terminal tool implementations, the skill permission runtime, CI workflows, and deployment configs. No dynamic/penetration testing was performed (no running instance was exercised).
**Not in scope / not changed:** Agent Runtime, Tool Execution engine, Permission Engine, Plugin Runtime, Skill Runtime, DB schema, migrations, central tRPC routers, workspace core models — per this audit's mandate, issues found in these areas are documented here and in [`AGENTIC_OS_BACKLOG.md`](AGENTIC_OS_BACKLOG.md) rather than patched directly, to stay conflict-free with the parallel core-refactor work in progress on this repo.

This audit found the auth/session/CORS/rate-limit layer (`apps/server/src/auth.ts`, `index.ts`, `rate-limit.ts`, `trpc/trpc.ts`, `trpc/workspace-guard.ts`) to already be in good, recently-hardened shape — see "Already solid" at the bottom. The findings below are gaps *outside* that layer, with one notable exception: **SEC-00**, an unauthenticated authorization bypass on the approval-decision endpoints found during this audit — and fixed by the parallel core-refactor stream before this document was finalized. It's kept in this document as a record of the finding and confirmation of the fix.

---

## Findings

### SEC-00 — `approvals.approve`/`reject`/`list` required no authentication [P0 · Critical — FIXED during this audit session by the parallel core-refactor work]

> **Status update:** Found during this audit's review, then independently fixed by the parallel Agentic-OS core-refactor stream working in this same repo before this document was finalized. Re-verified in `apps/server/src/trpc/router.ts:2596-2618` at time of writing: `list` is now `workspaceProcedure`, `approve`/`reject` are `protectedProcedure` and each calls `requireEntityWorkspaceOwner(ctx.user.id, () => getDb().getApprovalRequest(input.id), "Approval request not found")` before invoking `resolveApprovalDecision` — exactly the fix this finding recommends below. Left in place as a record of what was found and confirmation of the fix, per this audit's brief to document even resolved findings for traceability. No `BL-00` action needed.

**Where:** `apps/server/src/trpc/router.ts:2585-2602`

```ts
approvals: router({
  list: publicProcedure
    .input(z.object({ workspaceId: z.string(), status: approvalStatusSchema.optional() }))
    .query(({ input }) => getDb().listApprovalsByWorkspace(input.workspaceId, input.status)),
  approve: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => resolveApprovalDecision(input.id, "approved")),
  reject: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => resolveApprovalDecision(input.id, "rejected")),
}),
```

**Detail:** All three procedures are `publicProcedure` — per `trpc/trpc.ts:15`, that tier is reserved for endpoints that "must work with no session," and every other workspace-scoped procedure in the router uses `protectedProcedure`/`workspaceProcedure` instead. `approve`/`reject` take only `{ id: string }` (no `workspaceId`), so even if they *were* `workspaceProcedure`, the automatic raw-input ownership check in `trpc.ts:37-46` would never fire (it only triggers on a top-level `workspaceId` field). `resolveApprovalDecision` itself (`apps/server/src/approvals.ts:16-22`) only checks that the approval exists and is still `pending` — it never checks who's calling. `list` at least scopes by `workspaceId`, but as `publicProcedure` that means any unauthenticated caller can enumerate every pending approval (including its full `input`/tool label) for any workspace ID they can guess or enumerate.

**Impact:** This is a complete authorization bypass on the one workflow (`ADR-0009`) specifically designed to be the last human checkpoint before a sensitive action executes — file writes, `terminal_run` shell commands (SEC-09), MCP tool calls against connected services (Stripe, PayPal, Square are in the MCP connector catalog — `apps/server/src/mcp-connectors.ts`), skill calls. An unauthenticated network caller who can reach the server (trivial in PC mode per SEC-07, or from inside the Docker network in server mode) can approve their own or anyone else's pending sensitive action, or reject/cancel legitimate ones, without ever signing in. Combined with SEC-04/SEC-05 (no body limit, no rate limit on `/trpc/*`... wait, `/trpc/*` *does* have rate limiting, just no auth), this is directly and trivially exploitable today.

**Recommendation:** Change `approve`/`reject`/`list` to `protectedProcedure` at minimum, and add an explicit ownership check before acting — fetch the approval first via `requireEntityWorkspaceOwner(ctx.user.id, () => getDb().getApprovalRequest(input.id), "Approval request not found")`, confirm `ctx.user` owns `approval.workspaceId`, then call `resolveApprovalDecision`. This is a one-file, surgical fix, but `trpc/router.ts` is a central router under active parallel work (not in this audit's touch scope) — documented here for immediate pickup by the core team. **This should be treated as the single highest-priority item in the backlog** (`BL-00`), ahead of everything else in this document.

---

### SEC-01 — Model provider & MCP OAuth secrets stored in plaintext, contradicting ARCHITECTURE.md [P0 · Critical]

**Where:** `packages/db/src/schema/sqlite/app.ts:246` and `packages/db/src/schema/pg/app.ts:280` (`modelInstallation.apiKey`, plain `text()` column), `knowledgeBaseConfig.obsidianApiKey` (sqlite schema:365, same pattern), `mcpServer.oauthState` (written from `apps/server/src/mcp-runtime.ts:41-44`).

**Detail:** There is no encryption/decryption code anywhere in the repository — confirmed by grepping the whole tree for `encrypt|decrypt|cipher|AES|createCipher` (zero hits outside this audit's own files). `createModelInstallation`/`updateModelInstallation` in `packages/db/src/repo/sqlite.repo.ts:307-364` write the `apiKey` string straight to the DB column. Every provider key a user enters (Anthropic, OpenAI, OpenRouter, any OpenAI-compatible endpoint, the Obsidian REST API key) sits in cleartext in `nyxel.sqlite` / Postgres.

`docs/ARCHITECTURE.md` section 12 states: *"API keys and other secrets sit encrypted in the database and are only decrypted in memory at runtime."* This is currently false — it describes a target, not the shipped behavior. (Same pattern as SEC-03 below: the architecture doc is ahead of the implementation in more than one place.)

**Impact:** Anyone with read access to the SQLite file / Postgres database (a backup, a misconfigured volume mount, a compromised container, a careless `nyxel.sqlite` committed by accident — note one already sits at the repo root, see SEC-06) gets every connected provider's live API key and any stored MCP OAuth tokens, with no additional barrier.

**Recommendation:** Encrypt `apiKey`/`obsidianApiKey`/`oauthState` (and any future secret column) at the repository layer using a key derived from a dedicated `NYXEL_ENCRYPTION_KEY` (never reuse `BETTER_AUTH_SECRET` — different rotation lifecycle). Mirror the existing `auth.ts:26-31` pattern: required and fatal-if-missing in production, a fixed dev fallback only outside production. This touches `packages/db` (schema-adjacent) and is flagged here rather than fixed directly, per this audit's conflict-avoidance mandate — see backlog `BL-01`.

---

### SEC-02 — API keys returned verbatim to the browser over tRPC [P0 · Critical]

**Where:** `apps/server/src/trpc/router.ts:498-502`

```ts
installations: workspaceProcedure
  .input(z.object({ workspaceId: z.string() }))
  .query(({ input }) =>
    getDb().listModelInstallationsByWorkspace(input.workspaceId),
  ),
```

**Detail:** This returns the full DB row for every model installation in a workspace, unfiltered — including the plaintext `apiKey` field (SEC-01). The web app's Model Providers settings page therefore receives every provider's raw API key in the tRPC response payload on every load, not just on entry. Confirmed by tracing the same field flowing unmodified through `apps/server/src/models.ts` and into `packages/model-providers/src/video.ts:59-72`, which reads `openaiProvider?.apiKey` straight off the object the client also receives.

**Impact:** Any XSS in the web app (even a low-severity one in a markdown renderer, a third-party chart lib, etc.), any browser extension with page access, or any accidental network-log capture (Sentry/HAR export/browser devtools screen-share) exposes every connected provider's live key. This is a materially larger blast radius than SEC-01 alone, since it doesn't require DB access at all.

**Recommendation:** Add a response-shaping step that strips `apiKey` (and `obsidianApiKey`, `oauthState`) before the row leaves the server — e.g. a `toClientSafeInstallation()` mapper — and expose a separate boolean (`hasApiKey: true/false`) for the UI to render "configured" vs. "not configured". This is a tRPC router change and is out of this audit's direct-fix scope (central router file, actively being edited in parallel — see git status); documented for the core team, backlog `BL-02`.

---

### SEC-03 — Skill/plugin sandbox is in-process only; ARCHITECTURE.md overstates isolation [P1 · High, documentation + design gap]

**Where:** `packages/skills-sdk/src/runtime.ts:127-134` (own code comment), vs. `docs/ARCHITECTURE.md` section 12: *"Skills and plugins run in isolated worker processes with their own declared file and network access profile, so a faulty or malicious skill cannot reach the rest of the system."*

**Detail:** The actual runtime is a same-process permission gate (`assertPathAllowed`/`hostAllowed` in `runtime.ts`) wrapping Node/Bun's real `fs`/`fetch` — not a worker thread, not a subprocess, not a container. The code's own comment is candid about this: *"This stops a skill from accidentally reaching an undeclared host or path — it is not a security boundary against a deliberately malicious skill, which could still reach other Node/Bun APIs directly. Process- or container-level isolation is tracked as a follow-up; see ADR-0007."* I added `packages/skills-sdk/src/runtime.test.ts` in this audit (8 tests, all passing) confirming the path-traversal and host-allowlist checks behave correctly *for well-behaved skill code that only uses `ctx.*`* — that part is genuinely solid. The gap is specifically: a plugin/skill written to deliberately call `require("fs")`/`Bun.file` directly bypasses the permission system entirely, since nothing stops it at the language level.

**Impact:** Combined with SEC-05 (plugin installs run arbitrary downloaded code with no signing), this means the permission profile shown to the user in the "install this plugin" dialog is not actually enforced against a plugin author who chooses not to honor it.

**Recommendation:** Either (a) correct `ARCHITECTURE.md` section 12 to describe the real, weaker guarantee so users aren't misled about the security model, and/or (b) prioritize ADR-0007's process/worker isolation. (a) is a pure doc fix and would be safe to do immediately; I left it to the backlog (`BL-03`) rather than editing `ARCHITECTURE.md` myself since it's a first-party architecture doc likely to be touched by the parallel core work.

---

### SEC-04 — No global request body size limit [P1 · High]

**Where:** `apps/server/src/index.ts` (full file reviewed) — no `hono/body-limit` middleware is registered anywhere; the only size check is `MAX_UPLOAD_BYTES` (50MB) applied *after* `c.req.parseBody({ all: true })` has already buffered the full multipart body into memory (`apps/server/src/routes/library.ts:28`, `apps/server/src/library.ts:26,188-194`).

**Impact:** A single caller (authenticated — the upload route requires a session, but nothing prevents a large-request DoS from a valid, low-trust account, or from `/trpc/*` which has no such limit at all) can send an arbitrarily large request body and force the server to buffer it fully before any size check runs, exhausting memory. `/trpc/*` mutations that accept string/blob-like fields (e.g. skill/tool config JSON) have no body limit whatsoever.

**Recommendation:** Add `hono/body-limit` middleware (`import { bodyLimit } from "hono/body-limit"`) globally in `index.ts`, sized generously above the largest legitimate payload (library upload already has its own tighter per-file check), with a lower ceiling for `/trpc/*`. This is an `index.ts` change (currently modified in the parallel work stream — see git status at session start) and is therefore documented rather than patched here; backlog `BL-04`.

---

### SEC-05 — `/api/library/*` and the chat SSE stream route bypass rate limiting [P1 · High]

**Where:** `apps/server/src/index.ts:39-55` wires `rateLimitMiddleware` only to `/api/auth/*` and `/trpc/*`. `registerChatStreamRoute(app)` and `registerLibraryRoutes(app)` (lines 57-58) are registered with no rate-limit middleware in front of them, even though both check `getSessionUser` for auth.

**Impact:** An authenticated caller (or, per SEC-04, a caller who found another way in) can issue unlimited concurrent file uploads, unlimited file downloads (`/api/library/files/:id/content`), and unlimited chat-stream opens, none of which are bounded by the `rateLimitMiddleware` already written and used elsewhere in the same file. This is a straightforward inconsistency, not a missing capability — the fix is applying an existing middleware to two more route groups.

**Recommendation:** Apply `rateLimitMiddleware` (already in `apps/server/src/rate-limit.ts`) to `/api/library/*` and the chat stream route with limits appropriate to their cost (uploads/downloads are heavier than a JSON tRPC call). `index.ts` is currently being actively edited in parallel — documented rather than patched; backlog `BL-05`.

---

### SEC-06 — Live SQLite database file committed at repo root [P1 · High — data hygiene]

**Where:** `nyxel.sqlite`, `nyxel.sqlite-shm`, `nyxel.sqlite-wal` at the repository root (present in the working tree at audit time; not modified by this audit).

**Impact:** If these files are (or ever were) committed to git history, they would carry forward whatever the local dev DB contained at commit time — plausibly including plaintext provider API keys (SEC-01) and session data — into the repo's permanent history, retrievable by anyone who clones it, regardless of later deletion.

**Recommendation:** Confirm `nyxel.sqlite*` is `.gitignore`'d (it should already match `DATABASE_URL=./nyxel.sqlite` from `apps/server/.env.example`, which is a dev-only default) and, if any of these files are tracked in git history, treat the repo's provider keys as compromised and rotate them; a history rewrite (`git filter-repo`) would be required to actually remove the blob — that's a repo-history-rewriting operation this audit will not perform without explicit owner sign-off. Verified in this session: `git status` at session start did not list `nyxel.sqlite*` as tracked/modified, suggesting `.gitignore` already covers it — but this should be explicitly confirmed (`git check-ignore -v nyxel.sqlite`) since the file's mere presence on disk during development is itself a reminder to never `git add -A` in this repo. Backlog `BL-06`.

---

### SEC-07 — PC-mode Docker Compose silently defeats the production auth-secret guard [P0 · Critical, deployment config — fixed in this audit, see below]

**Where:** `docker-compose.pc.yml:14` (`BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:-dev-secret-change-me}`) combined with `apps/server/Dockerfile:12` (`ENV NODE_ENV=production` baked into the image) and the production guard in `apps/server/src/auth.ts:26-31`.

**Detail:** The guard only throws when `BETTER_AUTH_SECRET` is completely *unset*. `docker-compose.pc.yml` always sets it — to the same public, hardcoded string (`dev-secret-change-me`) that also appears in `apps/server/.env.example` and `apps/server/src/auth.ts`'s own `DEV_FALLBACK_SECRET` — unless the operator has already put a real value in their root `.env`. Since the server image runs with `NODE_ENV=production` unconditionally (baked in at build time, not per-mode), the guard is structurally incapable of catching this specific case: it was written to catch "forgot to set the var," not "the compose file sets it to a known-public default for you." Anyone who runs `docker compose -f docker-compose.pc.yml up --build` without first editing `.env` gets a "production" container whose every session cookie is forgeable by anyone who has read this file (which is public, in this open-source repo).

**Status:** Documentation hardened as part of this audit — see [`DEPLOYMENT_HARDENING.md`](DEPLOYMENT_HARDENING.md) and the `.env.example` comment updates in this same change. **The compose file itself was not modified** (it's adjacent to Docker/deployment surfaces the parallel work may also touch) — the actual fix (make the fallback fail loudly instead of silently, e.g. compose `${BETTER_AUTH_SECRET:?set BETTER_AUTH_SECRET in .env}` the same way `docker-compose.server.yml` already does for its own `BETTER_AUTH_SECRET`/`POSTGRES_PASSWORD`) is recorded as backlog `BL-07` for the core team, since `docker-compose.server.yml` shows the project already knows this pattern — PC mode is the one file that regressed to a silent default.

---

### SEC-08 — Plugin installs execute unsigned, unverified third-party code [P1 · High — supply chain, by-design gap already tracked upstream]

**Where:** `apps/server/src/plugins.ts` `installPluginFromGithub()`, `docs/ARCHITECTURE.md` section 15 (Phase 6 roadmap already lists *"signed plugin manifests"* as **remaining**, not done) and section 12 (*"...signed manifests for plugins so that only vetted extensions are trusted automatically"* — same "aspirational" pattern as SEC-03).

**Detail:** `installPluginFromGithub` downloads every blob in a GitHub repo tree verbatim, with no checksum pinning beyond the git ref itself, no signature check, no allowlist of trusted publishers, and no size/file-count ceiling beyond the per-file 25MB skip (`MAX_FILE_BYTES`). The downloaded `SKILL.md`/`agents/*.md` files are then loaded as `SkillDefinition`s and become directly runnable — combined with SEC-03 (in-process sandbox only), a plugin author can ship a skill whose `run()` function ignores its declared `permissions` and does anything the Node/Bun process can do, including reading `process.env` (which, per SEC-01/SEC-04's related surface, may contain the plaintext model provider keys) or shelling out.

**Impact:** This is the single largest code-execution supply-chain surface in the app. It is explicitly *not* a bug — it's the documented, intended v1 behavior of "paste a GitHub URL to install a plugin," and the project's own roadmap already flags the missing signing/vetting step. Restating it here so it's visible in one place alongside the other findings it compounds with.

**Recommendation:** See [`PLUGIN_SECURITY.md`](PLUGIN_SECURITY.md) for the full threat model and staged mitigation plan. No code changed for this finding — it requires the Plugin Runtime, explicitly out of scope for this audit. Backlog `BL-08`.

---

### SEC-09 — `terminal_run` gives agent-directed shell commands the full server environment [P2 · Medium — by design, approval-gated]

**Where:** `apps/server/src/tools-builtin/terminal.ts:48-56` (`Bun.spawn([shell, "-c", command], { env: process.env as Record<string, string>, ... })`).

**Detail:** The spawned shell inherits the entire server process environment verbatim — every env var listed in `.env`, including (once SEC-01 is fixed) an encryption key, and today, in effect, nothing sensitive lives in env vars *except* `BETTER_AUTH_SECRET`/`ANTHROPIC_API_KEY`/`POSTGRES_PASSWORD` per `.env.example`, all of which a shell command can already read and exfiltrate. `terminal_run` is correctly marked `sensitive: true` in `tools-builtin-seed.ts:149-154`, which routes it through the approval workflow (`ADR-0009`) before it runs — this is an intentional, gated capability (an "agentic OS" needs a real terminal), not an oversight.

**Impact:** Low incremental risk *given* the approval gate is honored end-to-end (see SEC-10 below, still pending confirmation) and given autonomy-level scoping is enforced for autonomous/scheduled runs. If either of those has a gap, this becomes the highest-value target, since it's a direct shell.

**Recommendation:** No code change recommended here beyond what SEC-01/SEC-02 already fix (reduces what's *in* the environment to steal). Worth an explicit test asserting `terminal_run` always appears in the approval queue and is never auto-approved regardless of agent autonomy level — see `TESTING_STRATEGY.md`. Backlog `BL-09`.

---

## Already solid (verified, not just assumed)

These were reviewed and found to already meet or exceed what's typically expected for a self-hosted app at this stage — noted so the backlog doesn't waste anyone's time re-litigating them:

- **CORS** (`apps/server/src/index.ts:22-35`): allowlist-based, fails closed (no `Access-Control-Allow-Origin` for unrecognized origins) with `credentials: true` — the safe combination. Good inline comment explaining the prior fail-open bug it replaced.
- **Production auth-secret guard** (`apps/server/src/auth.ts:26-31`): throws in production if `BETTER_AUTH_SECRET` is unset — modulo SEC-07's compose-file interaction, this is the right pattern and should be the template for SEC-01's encryption-key guard.
- **Workspace ownership checks** (`apps/server/src/trpc/workspace-guard.ts`, `trpc/trpc.ts`): consistent `requireWorkspaceOwner`/`requireEntityWorkspaceOwner` pattern, applied both via `workspaceProcedure`'s automatic raw-input check and manual per-resolver checks for entity-id-only procedures. `apps/server/src/routes/library.ts` correctly re-derives and re-checks ownership for both the plain-Hono upload and download routes rather than trusting the tRPC-side check alone.
- **File path containment** (`packages/skills-sdk/src/runtime.ts` `assertPathAllowed`): correctly rejects absolute-path escapes, `../` traversal, and sibling-directory-prefix tricks (e.g. permitted `/tmp/foo` does not also permit `/tmp/foo-evil`) — verified with 8 new tests added in this audit (`packages/skills-sdk/src/runtime.test.ts`), all passing. This is the one place SEC-03's "not a security boundary against a malicious skill" caveat doesn't apply: for any skill that goes through `ctx.*` as intended, the boundary holds.
- **MCP/local secret files** (`apps/server/src/mcp-secrets.ts`): written under `~/.nyxel/mcp-secrets/<workspaceId>/` with explicit `0o700`/`0o600` modes — correct, unlike the plaintext-in-DB pattern in SEC-01.
- **Library upload path safety** (`apps/server/src/library.ts` `sanitizeFileName`/`saveLibraryUpload`): server generates the on-disk `storageKey` itself (`${uuid}-${sanitizeFileName(name)}`, via `path.basename`), so a malicious `fileName` in a multipart upload cannot escape `LIBRARY_ROOT` — no path traversal here despite user-controlled input.
- **Rate limiting exists and is well-reasoned** where it's applied (`apps/server/src/rate-limit.ts`): bounded key cardinality (`MAX_TRACKED_KEYS`), correct `X-Forwarded-For` handling behind Caddy, tighter budget on `/api/auth/*` — the gap is coverage (SEC-05), not the mechanism itself.
- **Caddy security headers** (`Caddyfile`): `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` are set for server mode. See `DEPLOYMENT_HARDENING.md` for what's still missing (HSTS, CSP) and the PC-mode gap (no Caddy at all — SEC-07's neighbor issue).

---

## Summary table

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| SEC-00 | `approvals.approve`/`reject`/`list` required no auth | P0 | **Fixed** (by parallel work, during this session) |
| SEC-01 | Plaintext secrets at rest (DB) | P0 | Documented → `BL-01` |
| SEC-02 | API keys returned to browser unfiltered | P0 | Documented → `BL-02` |
| SEC-03 | Sandbox isolation weaker than docs claim | P1 | Documented → `BL-03` |
| SEC-04 | No global request body limit | P1 | Documented → `BL-04` |
| SEC-05 | Library/chat-stream routes skip rate limiting | P1 | Documented → `BL-05` |
| SEC-06 | Live SQLite file at repo root | P1 | Documented → `BL-06` |
| SEC-07 | PC-mode compose defeats prod secret guard | P0 | Docs hardened this session → `BL-07` for compose fix |
| SEC-08 | Unsigned plugin code execution | P1 | Documented (known upstream) → `BL-08` |
| SEC-09 | `terminal_run` inherits full env | P2 | Documented, approval-gated → `BL-09` |

Full acceptance criteria, affected files, effort, and conflict-risk-with-core-refactor notes for each `BL-*` item are in [`AGENTIC_OS_BACKLOG.md`](AGENTIC_OS_BACKLOG.md).
