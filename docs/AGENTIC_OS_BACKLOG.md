# Agentic OS Backlog

Prioritized backlog from this audit session. Every item below traces back to a concrete finding in [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md), [`PLUGIN_SECURITY.md`](PLUGIN_SECURITY.md), [`TESTING_STRATEGY.md`](TESTING_STRATEGY.md), [`CI_QUALITY_GATES.md`](CI_QUALITY_GATES.md), or [`DEPLOYMENT_HARDENING.md`](DEPLOYMENT_HARDENING.md) — none of these are speculative. Each item states its conflict risk with the parallel Agentic-OS core-refactor work explicitly, since that's this audit's primary constraint.

**Priority key:** P0 Security · P1 Agentic OS Core · P2 Workspace & Agents · P3 Coding Workspace · P4 UX & Developer Experience · P5 Future Features

---

## P0 — Security

### BL-00 — Authenticate `approvals.approve`/`reject`/`list` — ✅ RESOLVED during this audit session

- **Priorität:** P0 — was the highest priority item in this backlog
- **Bereich:** `apps/server/src/trpc/router.ts` (approvals sub-router), `apps/server/src/approvals.ts`
- **Status:** **Fixed by the parallel core-refactor stream** while this audit was in progress. Re-verified at `apps/server/src/trpc/router.ts:2596-2618`: `list` is `workspaceProcedure`; `approve`/`reject` are `protectedProcedure`, each calling `requireEntityWorkspaceOwner(ctx.user.id, () => getDb().getApprovalRequest(input.id), "Approval request not found")` before `resolveApprovalDecision` — exactly matching this item's original acceptance criteria (below, kept for the record). No further action needed; a regression test per the original acceptance criteria is still worth adding if one doesn't already exist.
- **Ursprüngliches Problem (für den Nachvollzug):** `approvals.approve`, `approvals.reject`, and `approvals.list` were declared `publicProcedure` and took only `{ id: string }` (approve/reject) or an unauthenticated `workspaceId` (list) — any network caller, signed in or not, could approve, reject, or enumerate any pending approval in any workspace. See `SECURITY_AUDIT.md` SEC-00.
- **Ursprüngliche Akzeptanzkriterien (jetzt erfüllt):**
  - `approve`/`reject` are `protectedProcedure` with an explicit id→workspace ownership check. ✅
  - `list` is `workspaceProcedure`. ✅
  - Remaining: a regression test asserting an unauthenticated call to `approve`/`reject`/`list` is rejected, and a cross-workspace call is rejected — not confirmed to exist yet, worth a quick check before closing this out fully.

### BL-01 — Encrypt secrets at rest (model provider API keys, Obsidian key, MCP OAuth state)

- **Priorität:** P0
- **Bereich:** `packages/db` (schema + repo layer)
- **Problem:** `modelInstallation.apiKey`, `knowledgeBaseConfig.obsidianApiKey`, and `mcpServer.oauthState` are stored as plain `text()` columns with zero encryption anywhere in the codebase, contradicting `ARCHITECTURE.md` section 12's claim that secrets "sit encrypted in the database." See `SECURITY_AUDIT.md` SEC-01.
- **Ziel:** Every secret-shaped DB column is encrypted at rest using a key that is never itself stored in the database.
- **Akzeptanzkriterien:**
  - A dedicated `NYXEL_ENCRYPTION_KEY` env var, required and fatal-if-missing in production (mirroring `auth.ts:26-31`'s pattern exactly), with a fixed dev-only fallback.
  - `apiKey`, `obsidianApiKey`, `oauthState` are encrypted before every write and decrypted only at the point of use (never held decrypted longer than one request).
  - A migration path exists for already-stored plaintext values (encrypt-in-place migration, documented and tested against both SQLite and Postgres per `ADR-0002`'s dual-dialect requirement).
  - Existing functionality (model calls, MCP reconnection) continues to work unchanged from the user's perspective.
- **Risiko:** Medium — touches the DB repo layer and every call site that reads these fields (`models.ts`, `video.ts`, `mcp-runtime.ts`, others); needs careful review to avoid a partial-migration state where old rows are unreadable.
- **Betroffene Dateien:** `packages/db/src/schema/{sqlite,pg}/app.ts`, `packages/db/src/repo/*.repo.ts`, a new migration, `apps/server/src/models.ts`, `apps/server/src/mcp-runtime.ts`, `packages/model-providers/src/video.ts`.
- **Aufwand:** Medium (M) — a day or two including migration testing on both DB dialects.
- **Abhängigkeiten:** None technically, but should land before or alongside `BL-02` (client-side exposure) since fixing one without the other still leaves a real gap.
- **Konfliktrisiko mit laufendem Refactor:** **High** — `packages/db` schema/repo and multiple `apps/server` call sites are exactly the kind of central, widely-referenced surface the parallel core work is most likely to also be touching. Document and hand off; do not attempt as an "isolated" fix.

### BL-02 — Stop returning plaintext API keys to the browser

- **Priorität:** P0
- **Bereich:** `apps/server/src/trpc/router.ts` (`models.installations` and any sibling query returning a full `modelInstallation`/`mcpServer`/`knowledgeBaseConfig` row)
- **Problem:** `installations: workspaceProcedure.query(...)` returns the full DB row including plaintext `apiKey` to the frontend on every load. See `SECURITY_AUDIT.md` SEC-02.
- **Ziel:** The client never receives a raw secret value it doesn't need to render the UI.
- **Akzeptanzkriterien:**
  - A `toClientSafeInstallation()`-style mapper strips `apiKey` (post-`BL-01`, this also means never decrypting it for this code path at all) and any other secret field before the response leaves the resolver.
  - The client instead receives a boolean (`hasApiKey`) sufficient to render "configured"/"not configured" state.
  - Any UI flow that needs to *display* a partially-masked key (e.g. "sk-...ab12") does so via a dedicated, explicitly-audited endpoint that logs access, not the general list query.
  - A test asserts the `installations` response shape never includes a full-length secret string.
- **Risiko:** Low-medium — needs a matching frontend change wherever `installation.apiKey` is currently read client-side (check `apps/web/src/**` for direct field access before shipping).
- **Betroffene Dateien:** `apps/server/src/trpc/router.ts`, corresponding `apps/web` components consuming this query.
- **Aufwand:** Small–Medium (S/M).
- **Abhängigkeiten:** Best done alongside `BL-01`.
- **Konfliktrisiko mit laufendem Refactor:** **High** — same central router file as `BL-00`; coordinate rather than race.

### BL-03 — Correct ARCHITECTURE.md's isolation/encryption claims; prioritize ADR-0007

- **Priorität:** P0 (docs fix is P0-cheap; the underlying isolation work itself is P1/P2 effort)
- **Bereich:** `docs/ARCHITECTURE.md`, `packages/skills-sdk` (longer-term)
- **Problem:** Section 12 states skills "run in isolated worker processes" and secrets "sit encrypted in the database" — both describe the *target* architecture, not what's shipped. See `SECURITY_AUDIT.md` SEC-03, `PLUGIN_SECURITY.md`.
- **Ziel:** Documentation accurately describes current guarantees, clearly distinguishing "enforced today" from "planned (ADR-0007)."
- **Akzeptanzkriterien:**
  - Section 12 rewritten to state plainly: permission checks are in-process and apply to code that uses `ctx.*`; not a sandbox against a deliberately malicious skill/plugin; process isolation is planned (link ADR-0007), not shipped.
  - Same correction for the encryption claim, until `BL-01` actually lands (then the doc becomes accurate again).
- **Risiko:** None (pure documentation).
- **Betroffene Dateien:** `docs/ARCHITECTURE.md`.
- **Aufwand:** Trivial (XS) — not applied in this session only because `ARCHITECTURE.md` is a first-party architecture doc the parallel core work is likely also updating as it lands new phases; a doc merge conflict here is cheap to resolve but still worth flagging rather than editing blind.
- **Abhängigkeiten:** None.
- **Konfliktrisiko mit laufendem Refactor:** Low-medium (single shared doc file, easy to merge, but likely to be touched by the other stream too — coordinate).

### BL-04 — Add a global request body size limit

- **Priorität:** P0
- **Bereich:** `apps/server/src/index.ts`
- **Problem:** No `hono/body-limit` middleware exists anywhere; `/trpc/*` has no body limit at all, and the library upload's 50MB check runs only after the full multipart body is already buffered into memory. See `SECURITY_AUDIT.md` SEC-04.
- **Ziel:** No single request can force unbounded memory buffering before any size check runs.
- **Akzeptanzkriterien:**
  - `bodyLimit` middleware from `hono/body-limit` applied globally, sized above the largest legitimate non-upload payload.
  - A tighter limit specifically for `/trpc/*` (JSON payloads have no legitimate reason to be tens of MB).
  - The library upload route's existing 50MB-per-file check remains, now backstopped rather than solely relied upon.
  - A test confirms an oversized request is rejected with the expected status before the handler body executes.
- **Risiko:** Low — additive middleware, easy to get the limit wrong in either direction (too tight breaks legitimate large uploads; too loose doesn't help) but easy to tune post-merge.
- **Betroffene Dateien:** `apps/server/src/index.ts`.
- **Aufwand:** Small (S).
- **Abhängigkeiten:** None.
- **Konfliktrisiko mit laufendem Refactor:** **High** — `index.ts` was already modified at this session's start (see git status), meaning the other stream is actively working in this exact file. Coordinate explicitly before touching.

### BL-05 — Apply rate limiting to `/api/library/*` and the chat SSE stream route

- **Priorität:** P0
- **Bereich:** `apps/server/src/index.ts`
- **Problem:** `rateLimitMiddleware` is wired to `/api/auth/*` and `/trpc/*` only; library upload/download and chat streaming have session-auth but no rate limit. See `SECURITY_AUDIT.md` SEC-05.
- **Ziel:** Every route group that does real work has a rate limit appropriate to its cost.
- **Akzeptanzkriterien:**
  - `rateLimitMiddleware({ windowMs, max, keyPrefix: "library" })` applied to `/api/library/*` with limits appropriate to upload/download cost (lower `max` than the general `/trpc/*` budget, given the heavier per-request cost).
  - Equivalent limiting applied to the chat stream route's connection-open endpoint (not the SSE stream itself, which should stay open once established).
  - A test confirms the 429 response after exceeding the configured budget, mirroring the existing pattern for `/api/auth/*`.
- **Risiko:** Low — the middleware and pattern already exist and are proven; this is applying it to two more route groups.
- **Betroffene Dateien:** `apps/server/src/index.ts`.
- **Aufwand:** Small (S).
- **Abhängigkeiten:** Can land alongside `BL-04` in the same PR (both are `index.ts` middleware additions).
- **Konfliktrisiko mit laufendem Refactor:** **High** — same file as `BL-04`, same coordination need.

### BL-06 — Confirm `nyxel.sqlite*` is gitignored; rotate secrets if it's ever been committed

- **Priorität:** P0 (verification) / P1 (remediation, only if the check fails)
- **Bereich:** Repo hygiene, `.gitignore`
- **Problem:** A live `nyxel.sqlite`/`-shm`/`-wal` sits at the repo root during development; if ever committed, it permanently carries forward whatever plaintext secrets (`BL-01`) and session data it contained into git history. See `SECURITY_AUDIT.md` SEC-06.
- **Ziel:** Confirm these files are, and remain, untracked; if history contains them, treat exposed keys as compromised.
- **Akzeptanzkriterien:**
  - `git check-ignore -v nyxel.sqlite` confirms it's covered by `.gitignore`.
  - `git log --all --full-history -- nyxel.sqlite` (and the `-shm`/`-wal` variants) confirms no historical commits ever tracked it. If any are found, rotate every API key that could plausibly have been in that DB at commit time, and evaluate a history rewrite.
- **Risiko:** The verification itself is zero-risk. Remediation (history rewrite), if needed, is high-risk and requires explicit owner sign-off — not something to do unilaterally.
- **Betroffene Dateien:** None (verification only) unless remediation is triggered.
- **Aufwand:** Trivial (XS) to verify; Large (L) if remediation is needed.
- **Abhängigkeiten:** None.
- **Konfliktrisiko mit laufendem Refactor:** None — pure verification, doesn't touch any file the other stream would care about.

### BL-07 — Make `docker-compose.pc.yml`'s `BETTER_AUTH_SECRET` fail loudly instead of silently defaulting

- **Priorität:** P0
- **Bereich:** `docker-compose.pc.yml`
- **Problem:** `${BETTER_AUTH_SECRET:-dev-secret-change-me}` silently supplies a known-public value, defeating `auth.ts`'s production guard (which only catches "completely unset," not "set to a public default"). `docker-compose.server.yml` already shows the correct pattern for its own secrets. See `SECURITY_AUDIT.md` SEC-07, `DEPLOYMENT_HARDENING.md`.
- **Ziel:** PC mode requires the same explicit secret-setting discipline server mode already enforces, without breaking the "just try it locally on localhost" zero-config experience.
- **Akzeptanzkriterien:**
  - Option A (matches `docker-compose.server.yml`'s existing pattern exactly): `${BETTER_AUTH_SECRET:?set BETTER_AUTH_SECRET in .env}` — requires every PC-mode user to set it, even for pure localhost use. Simple, consistent, but adds one step to the fastest on-ramp (`README.md`'s `docker compose -f docker-compose.pc.yml up --build` one-liner).
  - Option B (preserves zero-config localhost UX): keep the soft default, but have the *server* itself detect "I'm running with the known-public dev secret AND I'm bound to a non-loopback interface" and refuse to start / log a loud warning — more implementation work, better UX.
  - Whichever is chosen, `README.md`'s PC-mode quickstart is updated to match (currently shows `cp .env.example .env` as a comment, not an enforced step).
- **Risiko:** Low technically; the product-decision tradeoff (friction vs. safety on the primary "try it out" path) is the real work here and should be made by whoever owns onboarding UX, not unilaterally by this audit.
- **Betroffene Dateien:** `docker-compose.pc.yml`, possibly `apps/server/src/auth.ts` (for Option B), `README.md`.
- **Aufwand:** Small (Option A) to Medium (Option B).
- **Abhängigkeiten:** None.
- **Konfliktrisiko mit laufendem Refactor:** Low — `docker-compose.pc.yml` is not among the files this audit's starting `git status` showed as under active edit, but `auth.ts` is (Option B would touch it — prefer Option A for that reason).

### BL-08 — Plugin install hardening (staged plan)

- **Priorität:** P0 (documentation, threat model — done) / P1-P3 (staged mitigations)
- **Bereich:** `apps/server/src/plugins.ts`, Plugins page UI
- **Problem:** Unsigned, unverified third-party code execution via GitHub plugin install. See `SECURITY_AUDIT.md` SEC-08 and the full staged plan in `PLUGIN_SECURITY.md`.
- **Ziel:** See `PLUGIN_SECURITY.md`'s 5-step staged plan (docs correction → install-time warning → ref-pinning → static scan → real process isolation).
- **Akzeptanzkriterien:** Per-stage, see `PLUGIN_SECURITY.md`. Stage 1 (docs) is a subset of `BL-03`. Stages 2–4 are independent, isolated, low-risk UI/logic additions. Stage 5 is the real fix and is explicitly Skill/Plugin Runtime work, out of scope for a hardening-only pass.
- **Status:** Stages 1–4 **done**. Stage 2: the Plugins page install card always shows a static trust warning (code execution, trusted sources only, prefer a pinned commit/tag, review permissions). Stage 3: `installPluginFromGithub` resolves and stores a best-effort commit SHA for whatever ref it uses, and flags the install as "not pinned" unless the user gave an exact 40-char SHA via `/tree/<sha>` — there is still no separate "check for updates" action, so reinstalling remains the only update path. Stage 4: `scanForRiskyPatterns` flags `process.env`, `child_process`, `fs.rm`/`fs.unlink`, raw `fetch(`, `Bun.spawn`, `eval`/`new Function`; any hit throws `PluginInstallNeedsConfirmationError` (nothing written to disk/DB) and the UI shows a confirmation dialog requiring an explicit "Install anyway" before proceeding — this is a naive pattern scan, not static analysis, and is documented as such (a clean scan is not a safety guarantee). **Stage 5 (real process/container isolation) is still open** — plugin code still runs in-process with full server access; see below.
- **Risiko:** Stages 2–4: low (shipped, additive). Stage 5: significant runtime redesign, needs its own design doc.
- **Betroffene Dateien:** `apps/server/src/plugins.ts`, `apps/server/src/trpc/router.ts`, `apps/web/src/app/workspace/[workspaceId]/plugins/page.tsx`, `apps/web/src/lib/trpc.ts`, `packages/db/src/schema/*/app.ts` (added `ref`/`resolved_sha`/`ref_pinned`/`risk_findings` columns on `plugin`).
- **Aufwand:** Stages 2–4: Small each (done). Stage 5: Extra Large (XL), multi-week.
- **Abhängigkeiten:** Stage 5 depends on ADR-0007's isolation approach being decided first.
- **Konfliktrisiko mit laufendem Refactor:** Stages 2–4: Low (additive, non-central). Stage 5: **High** — explicitly Plugin/Skill Runtime, needs its own dedicated design effort.

### BL-09 — Approval-gate regression test for `terminal_run`

- **Priorität:** P1
- **Bereich:** `apps/server/src/tools-builtin/terminal.ts`, `apps/server/src/tools.ts`/`agent-runtime.ts` (test-only change, no production code)
- **Problem:** `terminal_run` correctly inherits the full server environment by design and is correctly marked `sensitive: true`, but there's no test confirming that flag is honored end-to-end across every call path (chat, autonomous agent, scheduled automation). See `SECURITY_AUDIT.md` SEC-09.
- **Ziel:** A regression test exists that would fail if a future change accidentally let a `sensitive: true` tool skip the approval workflow for any agent autonomy level.
- **Akzeptanzkriterien:** A test in the Agent Runtime / Tool Execution test surface asserts `terminal_run` (and other `sensitive: true` builtin tools) always produces a pending `approvalRequest` row rather than executing immediately, for at least the "Autonomous" and "Super-agent" autonomy levels described in `ARCHITECTURE.md` section 5.
- **Risiko:** Low if written as a pure test (no production code change) — but it exercises Agent Runtime internals, which this audit was told to avoid modifying.
- **Betroffene Dateien:** A new test file under `apps/server/src/` (exact location depends on existing Agent Runtime test conventions, which weren't established in this audit's search).
- **Aufwand:** Medium (M) — needs realistic agent-run fixtures.
- **Abhängigkeiten:** None.
- **Konfliktrisiko mit laufendem Refactor:** **High** — touches Agent Runtime test surface directly; hand off to whoever owns that area rather than attempting even as "just a test."

### BL-10 — Caddy header hardening (HSTS, CSP, Permissions-Policy)

- **Priorität:** P1
- **Bereich:** `Caddyfile`
- **Problem:** No HSTS, CSP, or Permissions-Policy set for server mode. See `DEPLOYMENT_HARDENING.md`.
- **Ziel:** Server-mode deployments get standard hardening headers without breaking the app's actual asset/script loading (WASM Whisper, charts, KaTeX, etc.).
- **Akzeptanzkriterien:** HSTS added immediately (low risk, no functional dependency). CSP added only after an explicit test pass confirming it doesn't break `@huggingface/transformers` WASM loading, `@xyflow/react`, `recharts`, KaTeX, or syntax highlighting — this needs to be verified against a running instance, not assumed. Permissions-Policy restricts `microphone`/`camera` to `self`.
- **Status:** HSTS and Permissions-Policy **done** — `Caddyfile` now sets `Strict-Transport-Security: max-age=31536000; includeSubDomains` and `Permissions-Policy: microphone=(self), camera=()`. CSP intentionally still not added — see `BL-21`.
- **Risiko:** Low for HSTS/Permissions-Policy (shipped). Medium for CSP — a wrong policy silently breaks features rather than erroring loudly.
- **Betroffene Dateien:** `Caddyfile`.
- **Aufwand:** Small (HSTS, Permissions-Policy) + Medium (CSP, needs real testing).
- **Abhängigkeiten:** None.
- **Konfliktrisiko mit laufendem Refactor:** Low — `Caddyfile` wasn't among the actively-modified files at session start.

### BL-11 — Non-root Docker user for both images

- **Priorität:** P1
- **Bereich:** `apps/server/Dockerfile`, `apps/web/Dockerfile`
- **Problem:** Neither image sets a `USER` directive; both run as root inside the container by default. See `DEPLOYMENT_HARDENING.md`.
- **Ziel:** Both containers run as an unprivileged user without breaking volume-mounted data access.
- **Akzeptanzkriterien:** `USER bun` (or equivalent) added after dependency install; a real `docker compose -f docker-compose.pc.yml up --build` run confirms the SQLite volume mount (`nyxel-data:/data`) remains writable by the new non-root user.
- **Status:** **Done.** Both Dockerfiles now run as `USER bun` (confirmed present in the upstream `oven/bun:1` image via its own Dockerfile source — created via `useradd`/`adduser`, uid/gid 1000, just never activated by default). Copies use `COPY --chown=bun:bun`; `apps/server/Dockerfile` pre-creates and `chown`s `/data` before the user switch so the `nyxel-data` named volume (which Docker seeds from the image's mount-path contents on first use) stays writable. No Docker daemon was available in this session's sandbox to run a live `build`/`up` — verified instead via `docker compose -f docker-compose.{pc,server}.yml config` (both parse cleanly) and by confirming the `bun` user's existence against the base image's own Dockerfile source. A real build+run pass is still worth doing before relying on this in production.
- **Risiko:** Medium — a permission mismatch on the volume mount would break the running container in a way only a real Docker build+run catches, not a source review.
- **Betroffene Dateien:** `apps/server/Dockerfile`, `apps/web/Dockerfile`.
- **Aufwand:** Small implementation, but requires real build+run verification — budget accordingly.
- **Abhängigkeiten:** None.
- **Konfliktrisiko mit laufendem Refactor:** Low — Dockerfiles weren't among actively-modified files at session start.

---

## P1 — Agentic OS Core (documented per this audit's scope — not modified)

### BL-12 — Delete the 5 dead test files in `/tests/`

- **Priorität:** P1 (blocks `BL-15`'s CI test gate)
- **Bereich:** `/tests/` (repo root, not `apps/`/`packages/`)
- **Problem:** `db_migration.test.ts`, `skill_registry.test.ts`, `skill_file_read.test.ts`, `skill_http_fetch.test.ts`, `kb_context_injector.test.ts` import from paths (`../services/db`, `../server/src/skills-registry`, etc.) that don't exist under the current monorepo layout — pre-restructure leftovers that have never run. See `TESTING_STRATEGY.md`. **An attempted deletion in this audit session was correctly blocked by the harness's safety check** (file deletion wasn't explicitly authorized), so they remain in place.
- **Ziel:** `bun test` runs cleanly without 5 guaranteed import errors, unblocking `BL-15`.
- **Akzeptanzkriterien:** The 5 files are removed (or, if any test intent inside them is still wanted, rewritten against current module paths and moved into `apps/server/src/` alongside its siblings, matching the repo's established test-colocation convention).
- **Risiko:** None — these files have never successfully run; deleting them removes zero working coverage.
- **Betroffene Dateien:** The 5 files listed above.
- **Aufwand:** Trivial (XS).
- **Abhängigkeiten:** None. Blocks `BL-15`.
- **Konfliktrisiko mit laufendem Refactor:** None — these files aren't referenced anywhere else in the repo (confirmed via grep in this audit) and aren't plausibly part of the parallel work.

### BL-13 — Fix `pickBestModelIdForSeo` fallback logic and its non-hermetic test

- **Priorität:** P1
- **Bereich:** `apps/server/src/seo-analyzer.ts`
- **Problem:** Two real test failures — the function returns a live-detected local model (`lmstudio/realvisxl-v5.0`) instead of the caller-supplied default when "no installed model ranks," and doesn't throw when nothing is available at all. The first failure suggests the underlying local-model-detection call isn't mocked, so results depend on what's running on the host machine. See `TESTING_STRATEGY.md`.
- **Ziel:** The fallback logic is correct, and the test is hermetic (same result regardless of what's running on `localhost:11434`/`:1234`).
- **Akzeptanzkriterien:** Both currently-failing assertions pass; the test no longer depends on real network calls to local model runtimes (inject/mock the detection call).
- **Risiko:** Low-medium — `seo-analyzer.ts` is a large (40KB) file; this audit didn't attempt the fix directly because isolating the exact scope of "correct fallback logic" without full context on the surrounding SEO-ranking logic risked a wrong fix.
- **Betroffene Dateien:** `apps/server/src/seo-analyzer.ts`, `apps/server/src/seo-analyzer.test.ts`.
- **Aufwand:** Small–Medium (S/M).
- **Abhängigkeiten:** None. Blocks `BL-15`.
- **Konfliktrisiko mit laufendem Refactor:** Low — `seo-analyzer.ts` wasn't among actively-modified files at session start, but it's a large surface; a quick check before starting is still warranted.

### BL-14 — Add a gitleaks secret-scanning workflow

- **Priorität:** P1
- **Bereich:** `.github/workflows/` (new file)
- **Problem:** No secret-scanning CI check exists. See `CI_QUALITY_GATES.md` for the exact proposed YAML.
- **Ziel:** An accidental committed secret (API key, or the `nyxel.sqlite*` scenario in `BL-06`) is caught on PR, before merge.
- **Akzeptanzkriterien:** `secret-scan.yml` added per the YAML in `CI_QUALITY_GATES.md`; a first run against the full repo history is reviewed for pre-existing findings before the check is made blocking (avoid immediately red on unrelated historical noise).
- **Risiko:** Low, but the "run once, triage findings, then make blocking" sequencing matters — don't make it a hard gate on day one.
- **Betroffene Dateien:** New file `.github/workflows/secret-scan.yml`.
- **Aufwand:** Small (S) to add, Small–Medium to triage first-run findings.
- **Abhängigkeiten:** None.
- **Konfliktrisiko mit laufendem Refactor:** None — new workflow file, doesn't touch anything else.

### BL-15 — Add `bun test` as a blocking CI job

- **Priorität:** P1
- **Bereich:** `.github/workflows/ci.yml`
- **Problem:** No test job exists in CI at all. See `CI_QUALITY_GATES.md` for the exact job YAML.
- **Ziel:** Every PR runs the real test suite, blocking on failure.
- **Akzeptanzkriterien:** The `test` job from `CI_QUALITY_GATES.md` added to `ci.yml`; root `package.json` gets a `"test": "bun test"` script for local-command parity with `dev`/`build`/`typecheck`/`lint`.
- **Risiko:** None, once sequenced after `BL-12`/`BL-13` — adding it before those two would turn every PR red on pre-existing, unrelated failures.
- **Betroffene Dateien:** `.github/workflows/ci.yml`, `package.json`.
- **Aufwand:** Trivial (XS) for the workflow change itself.
- **Abhängigkeiten:** **Hard dependency on `BL-12` and `BL-13` landing first.**
- **Konfliktrisiko mit laufendem Refactor:** Low for `ci.yml`. `package.json` (root) may be touched by the parallel stream — check before editing.

---

## P2 — Workspace & Agents

### BL-16 — Injectable local-model detection for testability

- **Priorität:** P2
- **Bereich:** `packages/model-providers/src/detect.ts`
- **Problem:** Ollama/LM Studio auto-detection has no injectable `fetch`, so it can't be mocked in tests — the same root cause surfaces in `BL-13`'s SEO test failure and is likely to recur anywhere else detection is tested. No dedicated test file exists for `detect.ts` today.
- **Ziel:** `detectLocalModels()` (and siblings) accept an injectable fetch implementation, defaulting to global `fetch`, so tests can stub network calls without relying on host-machine state.
- **Akzeptanzkriterien:** `detect.ts` functions take an optional `fetchImpl` parameter; a new test file exercises detected/not-detected/error paths without touching a real network port.
- **Risiko:** Low — smaller-surface package (`packages/model-providers`), not `apps/server`.
- **Betroffene Dateien:** `packages/model-providers/src/detect.ts`, new `detect.test.ts`.
- **Aufwand:** Small (S).
- **Abhängigkeiten:** None, but resolves the same root cause as `BL-13`.
- **Konfliktrisiko mit laufendem Refactor:** Low.

### BL-17 — Test coverage for approval-flow, audit-logging, and knowledge-source toggle

- **Priorität:** P2
- **Bereich:** `apps/server/src/audit.ts`, `apps/server/src/knowledge-base.ts`
- **Problem:** No test file exists for either. See `TESTING_STRATEGY.md`'s coverage table.
- **Ziel:** `logAudit`'s error-swallowing behavior is regression-tested; the per-workspace `knowledge_base_config.inject_into_prompts` toggle is confirmed to actually gate the prompt-injection path in both directions.
- **Akzeptanzkriterien:** Two small, isolated test files; no production code changes required (both behaviors already exist, just untested).
- **Risiko:** Low.
- **Betroffene Dateien:** New `apps/server/src/audit.test.ts`, new coverage in/around `knowledge-base.ts`.
- **Aufwand:** Small (S) each.
- **Abhängigkeiten:** None.
- **Konfliktrisiko mit laufendem Refactor:** Low — additive test files only.

---

## P3 — Coding Workspace

*(No coding-workspace-specific findings surfaced in this audit's scope — `apps/server/src/tools-builtin/{read,edit,terminal,search}.ts` and the workspace file skills were reviewed as part of the security audit (see `SECURITY_AUDIT.md` SEC-09, `PLUGIN_SECURITY.md`) rather than as a standalone coding-workspace UX pass. A dedicated coding-workspace review — editor ergonomics, diff preview quality, multi-file edit UX — wasn't performed and would need its own session with the actual UI running, which this audit didn't execute against a live server.)*

---

## P4 — UX & Developer Experience

This audit reviewed the actual route structure (`apps/web/src/app/workspace/[workspaceId]/*`) rather than working from the task list in the abstract. Confirmed routes: `agents`, `approvals`, `archive`, `audit-log`, `automations`, `extensions`, `knowledge-base`, `library`, `mcp-servers`, `plugins`, `settings`, `skills`, `tasks`, `tools`, `workflows`, plus top-level `chat`, `share`, `mcp-auth`.

### BL-18 — No standalone "Runs" surface; "Memory" landed mid-audit

- **Priorität:** P4
- **Bereich:** Navigation/IA (`apps/web/src/components/app-shell.tsx` and workspace route structure)
- **Status update:** At the time this route structure was first surveyed in this audit, neither "Runs" nor "Memory" existed as a distinct route. **By the time this document was finalized, the parallel core-refactor stream had added `apps/web/src/app/workspace/[workspaceId]/memory/page.tsx`** — so the "Memory" half of this observation is resolved; this entry is kept to record that the gap was real and has since been addressed, and to leave "Runs" as the remaining open question.
- **Problem (Runs only, still open):** `agentRun` rows (confirmed in the DB schema: `agentRun`, `taskEvent` tables) are presumably surfaced within `tasks/[taskId]` or `agents/[agentId]` rather than as their own cross-workspace view — there's no single place to see "everything running across my whole workspace right now" independent of which task or agent triggered it.
- **Ziel:** Decide deliberately whether "Runs" deserves a standalone cross-agent view, useful once a workspace has several autonomous/scheduled agents running concurrently.
- **Akzeptanzkriterien:** A product decision recorded (even if the decision is "no change needed, the Tasks page's live board already serves this role").
- **Risiko:** N/A (design decision, not code).
- **Betroffene Dateien:** N/A until a direction is chosen.
- **Aufwand:** N/A (needs product input before any implementation estimate is meaningful).
- **Abhängigkeiten:** None.
- **Konfliktrisiko mit laufendem Refactor:** N/A.

### BL-19 — Approvals page is easy to miss when nothing is pending

- **Priorität:** P4
- **Bereich:** `apps/web/src/app/workspace/[workspaceId]/approvals`
- **Problem:** Given `SECURITY_AUDIT.md` SEC-00's finding that the approval workflow is the one designed human checkpoint for irreversible actions, its discoverability matters more than a typical settings page. This audit didn't inspect the live UI (no running instance was exercised — see note at top of `TESTING_STRATEGY.md`), so this is a recommendation to verify, not a confirmed defect: does the nav surface a badge/count when approvals are pending, independent of whether the user happens to be on that page? The README's task-board description ("needs-attention strip, pending approvals") suggests this may already exist on the Tasks page — worth confirming the Approvals page itself and the global nav both surface it, not just Tasks.
- **Ziel:** A pending approval is impossible to miss regardless of which page the user is currently on.
- **Akzeptanzkriterien:** Global nav shows a live pending-approval count; verified against the actual running app, not assumed.
- **Risiko:** Low, additive UI change.
- **Betroffene Dateien:** Likely `apps/web/src/components/app-shell.tsx` (currently under parallel edit — coordinate) and the approvals page.
- **Aufwand:** Small (S), pending live-app verification of current state.
- **Abhängigkeiten:** None.
- **Konfliktrisiko mit laufendem Refactor:** Medium — `app-shell.tsx` is in this session's starting `git status` as modified.

### BL-20 — Plugins page should surface the trust-model warning from PLUGIN_SECURITY.md

- **Priorität:** P4
- **Bereich:** `apps/web/src/app/workspace/[workspaceId]/plugins`
- **Problem:** See `PLUGIN_SECURITY.md` mitigation stage 2 — installing a plugin from an arbitrary GitHub URL currently has no in-UI warning about what access that plugin actually gets.
- **Ziel:** A user installing a plugin understands, at the moment of installing, that it runs with meaningful access to the server process.
- **Akzeptanzkriterien:** A static, non-blocking warning shown on the install dialog per `PLUGIN_SECURITY.md` stage 2's exact wording suggestion.
- **Status:** **Done** — the install card now shows the warning (code execution, trust the source, prefer a pinned commit/tag, review permissions) unconditionally, plus per-plugin badges/detail for whether the install is pinned to a commit and what the static scan (stage 4) flagged, if anything. See `BL-08` for the fuller stage 2–4 rollout this was bundled with.
- **Risiko:** None — copy-only change.
- **Betroffene Dateien:** Plugins page component(s) in `apps/web`.
- **Aufwand:** Trivial (XS).
- **Abhängigkeiten:** None.
- **Konfliktrisiko mit laufendem Refactor:** Low.

---

## P5 — Future Features

### BL-21 — CSP rollout for server mode (full stage, beyond BL-10's header addition)

- **Priorität:** P5
- **Bereich:** `Caddyfile`, `apps/web` asset loading
- **Problem/Ziel:** See `BL-10` — a correct, tested CSP is meaningfully more work than the other headers and deserves its own scoped effort once the app's full third-party asset surface (WASM, fonts, chart libs) is inventoried.
- **Akzeptanzkriterien:** A CSP that passes a real browser test pass across every page listed in the UX review above, with zero console CSP violations.
- **Risiko:** Medium (silent breakage if wrong).
- **Betroffene Dateien:** `Caddyfile`.
- **Aufwand:** Medium (M).
- **Abhängigkeiten:** `BL-10` (HSTS/Permissions-Policy) should land first as the low-risk subset.
- **Konfliktrisiko mit laufendem Refactor:** Low.

### BL-22 — Process/worker isolation for skills and plugins (ADR-0007)

- **Priorität:** P5 (by effort/risk — this is the "real" fix for `PLUGIN_SECURITY.md`'s core gap, but is a genuine runtime redesign)
- **Bereich:** `packages/skills-sdk` (Skill Runtime — explicitly out of scope for direct changes in this audit)
- **Problem/Ziel:** See `PLUGIN_SECURITY.md` stage 5.
- **Status:** `custom_code` (subprocess) and, as of this session, `browser_run_playwright_code` (same-process `node:vm`, via the new `runVmSandboxedCode` in `apps/server/src/plugin-sandbox.ts`) are the two arbitrary-code execution points now isolated. See `PLUGIN_SECURITY.md` stage 5 for the exact trade-off of the vm-only path. **Still open:** hand-written builtin skills and DB-backed tools of every other kind still run in-process with full server access (though, per this session's investigation, plugin-contributed `SKILL.md` bodies are declarative text only today — they don't execute code, so there's no live gap there yet, only the install-time static scan of files that aren't themselves executed).
- **Akzeptanzkriterien:** TBD by whoever designs the ADR-0007 implementation — this audit intentionally didn't prescribe a specific technical approach (Bun `Worker` vs. subprocess vs. container), since that's a real architectural decision deserving its own design doc.
- **Risiko:** High — touches the Skill Runtime, the exact area this audit was told to avoid.
- **Betroffene Dateien:** `packages/skills-sdk/src/runtime.ts` and everything that constructs a `SkillContext`.
- **Aufwand:** Extra Large (XL).
- **Abhängigkeiten:** None technically, but should be sequenced deliberately relative to whatever the parallel core-refactor stream is doing to the same runtime.
- **Konfliktrisiko mit laufendem Refactor:** **Highest in this backlog** — do not start without explicit coordination.

---

## Performance & Token-Efficiency Analysis

Reviewed per the audit brief's explicit ask (context building, chat history, file reading, knowledge retrieval, tool outputs, memory, model provider calls, summaries, caching). This audit did not run a live instance or profile real agent runs — the observations below are from source review only (confirmed file locations/behavior), not measured token counts or latencies. Treat the recommendations as a starting hypothesis for whoever picks this up with real profiling data, not a validated performance report.

- **Knowledge-base context injection has no visible budget.** `ARCHITECTURE.md` section 9 describes the injected context block as "a full note index plus the text of always-relevant notes (`00-Meta/`) and the most recently modified notes." From source review of `apps/server/src/knowledge-base.ts` (15.9KB — the file was skimmed for structure, not read in full during this security-focused pass), there's no evidence of a token-count ceiling on this block before it's appended to every chat/agent/automation system prompt — it's a candidate for silent, unbounded prompt growth as a vault grows. **Recommendation:** cap the injected block by token count (not just "most recent N notes" — a few very large recently-modified notes could still blow the budget), and make the cap workspace-configurable alongside the existing `inject_into_prompts` toggle.
- **Tool output truncation exists but is inconsistent.** `tools-builtin/terminal.ts` truncates output to the last 4000/8000 chars (`terminal_run`/configured-command tools) and caps buffered output at `MAX_BUFFERED_CHARS = 200_000` — good, deliberate limits. `workspace-files.ts`'s `createWorkspaceFileReadSkill` caps at `content.slice(0, 20_000)` — also good. No evidence of a similar cap on `text_search`/`codebase_search`/`usages` tool outputs (`tools-builtin-seed.ts` lists these as builtin tools; their implementation wasn't reached in this security-focused pass) — a broad regex search across a large workspace could return an unbounded result set into the model's context. **Recommendation:** audit every builtin tool's `run()` for an explicit output size cap; the pattern from `terminal.ts`/`workspace-files.ts` is already established and should just be applied consistently.
- **No file-summary cache or repo map visible.** For a "coding workspace" feature set (the tool catalog includes file read/edit/patch, terminal, `problems` (tsc), `text_search`, `usages`), there's no evidence of a cached file-summary index or repo-map generation (the kind of thing that lets an agent understand "what's in this codebase" without re-reading every file every turn). This is a common cost lever in coding agents — worth evaluating once the Coding Workspace area (P3, currently unreviewed per `BL`-scope above) gets its own pass.
- **Diff-first context for edits.** `workspace_file_patch`'s `buildUnifiedDiffPreview` (in `packages/skills-sdk/src/skills/workspace-files.ts`) already returns a diff rather than full before/after content in its output — this is the right pattern and already followed; noted as a positive example other tool outputs could match rather than a gap.
- **Model provider calls: local-detection has no visible caching.** `packages/model-providers/src/detect.ts` (per `BL-16`'s testability note) probes `localhost:11434`/`:1234` — if this probe runs on every relevant page load or model-picker render rather than being cached with a short TTL, it's an easy latency/request-count win. Not confirmed either way in this review (the file wasn't read in full during the security pass) — flagged as worth checking, not asserted as a confirmed gap.
- **No visible run-summary compaction for long-running autonomous agents.** `ARCHITECTURE.md` section 6 describes autonomous/super-agents running "in the background within previously granted limits" — for a long-running or frequently-triggered scheduled agent, whether its chat history/context gets compacted/summarized between runs (vs. re-sent in full every time) determines whether cost scales with total historical activity or stays roughly flat per-run. This is Agent Runtime territory (explicitly out of scope for direct changes) but worth flagging as the highest-leverage performance question for whoever owns that area, since it compounds over time in a way none of the other items here do.
- **Model router exists in spirit (three provider categories) but no cost-based auto-routing observed.** `ARCHITECTURE.md` section 7 describes local/cloud/custom-endpoint categories and per-request cost estimates shown in the UI, but that's operator-facing information, not automatic routing (e.g. "use a cheap local model for simple tool-call classification, escalate to a cloud model only when needed"). Whether that's wanted at all is a product question, not flagged as a defect — noting it here only because the audit brief explicitly asked about "Model Router" and "Local Model Usage" as evaluation criteria.

These observations are collected here rather than split into individual `BL-*` items because none were verified against a running instance with real measurements — they're starting hypotheses for a follow-up performance-focused session, not pre-scoped fixes ready for acceptance criteria.
