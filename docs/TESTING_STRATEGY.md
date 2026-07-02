# Testing Strategy

## Current state (verified by actually running the suite in this audit)

```
bun test
```
from the repo root: **77 pass, 7 fail, 5 errors, across 84 tests in 23 files** (23 of the 28 `*.test.ts` files in the repo — 5 never even load).

This command is not wired into `package.json` at any level (no root `test` script, no `apps/server/package.json` `test` script, no turbo `test` task) and **is not run in CI** (`.github/workflows/ci.yml` only runs lint/typecheck/build — see [`CI_QUALITY_GATES.md`](CI_QUALITY_GATES.md)). That means the 7 failures and 5 errors below have been sitting un-noticed; nobody would see them on a PR today.

### The 5 errors: dead test files from before the current monorepo layout

```
tests/db_migration.test.ts       → Cannot find module '../services/db'
tests/skill_registry.test.ts     → Cannot find module '../server/src/skills-registry'
tests/skill_file_read.test.ts    → Cannot find module './skills/FileReadSkill'
tests/skill_http_fetch.test.ts   → Cannot find module './skills/HttpFetchSkill'
tests/kb_context_injector.test.ts → Cannot find module '../services/knowledge-base'
```

All five live in `/tests/` (not `apps/server/src/` or `packages/*/src/`, which is where every other test file in the repo lives) and import from paths like `../services/db` and `../server/src/skills-registry` that don't exist under the current `apps/`/`packages/` structure — they predate the monorepo reorganization and were never updated or deleted. None of them use `bun:test`'s `describe`/`it`/`expect` imports either (they rely on ambient globals that aren't configured here), so even with corrected import paths they wouldn't run as-is.

**These were left in place during this audit** — deleting pre-existing files wasn't authorized as part of this audit's scope, and an attempted `git rm` was correctly blocked by the harness's safety check. **Recommendation for whoever owns this next: delete these 5 files.** They test nothing real today, and leaving them in place is the single blocker to turning on `bun test` in CI as a hard gate — any CI test job added today would immediately fail on these 5 import errors before a single real assertion runs. See backlog `BL-12`.

### The 2 real failures: `pickBestModelIdForSeo` fallback logic

`apps/server/src/seo-analyzer.test.ts`:
```
(fail) pickBestModelIdForSeo > falls back to the workspace default when no installed model ranks
  Expected: "some-default-model"
  Received: "lmstudio/realvisxl-v5.0"

(fail) pickBestModelIdForSeo > throws when there is truly nothing to fall back to
  Expected promise that rejects
  Received promise that resolved
```

The second failure is unambiguous: the function is supposed to throw when there's genuinely no model to fall back to, and it doesn't. The first failure is suspicious in a different way — the test expects a caller-supplied default (`"some-default-model"`) to be used when no installed model ranks, but got back `"lmstudio/realvisxl-v5.0"`, a real-looking model id. **This strongly suggests the test isn't hermetic**: `pickBestModelIdForSeo` likely calls into the same local-model-detection path (`packages/model-providers/src/detect.ts`, which probes `localhost:11434`/`localhost:1234` for Ollama/LM Studio) rather than a mocked/seeded set of "installed" models, so the test's actual result depends on whatever's running on the machine `bun test` executes on. That's a real correctness bug in the fallback logic (it's picking up a live-detected model instead of respecting "no installed model ranks"), *and* a test-hygiene bug (a test whose outcome depends on host machine state will pass or fail differently in CI vs. any given developer's laptop). Not fixed in this audit — `seo-analyzer.ts` is a large (40KB) file outside this audit's low-risk-fix criteria; recorded as backlog `BL-13`.

## Fastest path to a trustworthy `bun test` in CI

1. Delete the 5 dead files in `/tests/` (`BL-12`).
2. Fix or skip (`.skip`, with a linked issue) the 2 `pickBestModelIdForSeo` failures — at minimum, mock/stub the local-model-detection call so the test doesn't depend on what's running on `localhost:11434`/`:1234` at CI time (`BL-13`).
3. Add a `test` job to `ci.yml` running `bun test` at the root — see `CI_QUALITY_GATES.md` for the exact job.
4. Add a root `test` script to `package.json` (`"test": "bun test"`) so `bun test` and `bun run test` are both the documented entry point, matching the `dev`/`build`/`typecheck`/`lint` pattern already there.

None of steps 1, 2, or 4 were done in this audit (file deletion was blocked; `seo-analyzer.ts` and `package.json` script additions were judged not clearly conflict-free enough to make unilaterally alongside the parallel work — `package.json` in particular is a file the other agent may also be touching). Step 3 (a CI workflow addition) is safe and is proposed concretely in `CI_QUALITY_GATES.md`, but should land *after* 1–2 so it doesn't turn red on day one.

## Coverage gaps, by the focus areas this audit was asked to check

| Area | Existing coverage | Gap |
|---|---|---|
| Auth configuration | None found | No test exercises the `BETTER_AUTH_SECRET` production guard (`auth.ts:26-31`) or the `DEV_FALLBACK_SECRET` fallback path. A test that sets `NODE_ENV=production` and unsets the env var, asserting the module throws on import, would catch a future regression of SEC-07-adjacent behavior. |
| Env validation | None found — there is no centralized env schema/validation module in the repo at all (each file reads `process.env.X` ad hoc with its own fallback) | Worth a small `env.ts` (or similar) that validates required-vs-optional vars once at boot with clear error messages, plus tests for it. This is a design gap as much as a testing one — noted for the backlog, not attempted here (touches `index.ts`/startup sequencing). |
| Tool permission checks | **Now covered** — this audit added `packages/skills-sdk/src/runtime.test.ts` (8 tests: path traversal, absolute-path escape, sibling-prefix trick, host-allowlist substring trick, in-bounds access). | Not covered: the `SkillDefinition.sensitive` → approval-workflow wiring itself (does a `sensitive: true` skill/tool *always* reach `approvals.ts` before running, for every call path — chat, autonomous agent, scheduled automation?). This needs `apps/server/src/tools.ts`/`agent-runtime.ts` integration-level tests, which are Agent Runtime / Tool Execution — explicitly out of this audit's scope. |
| Plugin manifest parsing | Good — `apps/server/src/plugins.test.ts` covers `parseGithubRepoUrl`, install/reinstall/uninstall, and `ensureExtensionPlugin`, including a fake-fetch-based test of the full install flow. | Not covered: `parseManifest`'s handling of malformed/hostile `.claude-plugin/plugin.json` (e.g. `author` as an unexpected type, extremely long strings, prototype-pollution-shaped keys). Low priority — `parseManifest` already narrows types defensively (see `plugins.ts:157-181`), but a few adversarial-input test cases would formalize that. |
| Path normalization / file access boundaries | **Now covered** (see "tool permission checks" above — same test file). | `apps/server/src/library.ts`'s `sanitizeFileName`/`libraryFileDiskPath` has no dedicated test file despite being the other path-safety-critical spot in the codebase (server-generates the storage key, so risk is lower, but untested). Candidate for a follow-up isolated test file — not added in this session because `library.ts`'s public surface (`saveLibraryUpload` et al.) requires a DB layer to exercise meaningfully, and this audit didn't want to introduce a DB-mocking pattern that might diverge from whatever convention the core team is already using in `plugins.test.ts`/`skills-registry.test.ts`. |
| API input validation | Implicit via Zod schemas on every tRPC procedure (good — this is a real, if indirect, form of coverage: a malformed request fails `.parse()` before reaching a resolver) | No explicit tests assert this behavior for the security-relevant procedures specifically (e.g. that `approvals.approve` — see `SECURITY_AUDIT.md` SEC-00 — actually requires a session once fixed). Once `BL-00` lands, it should ship with a regression test asserting an unauthenticated call is rejected. |
| Model provider routing | Some — `packages/model-providers/src/video.test.ts`, `cli.test.ts` | `detect.ts` (Ollama/LM Studio auto-probing) has no tests; combined with the `seo-analyzer.test.ts` finding above, this is the same root cause (detection isn't mockable/injectable in current call sites) surfacing twice. Worth a `detectLocalModels(fetchImpl)`-style injectable-fetch refactor so tests can stub it — a `packages/model-providers` change, smaller blast radius than touching `apps/server`, reasonable candidate for a focused follow-up PR. |
| Agent run state | None found in this audit's search | `agent-runtime.ts`, `workflow-runner.ts` are large, stateful, and untested. Explicitly Agent Runtime — out of scope for direct changes here; flagged for the core team. |
| Approval flow | None found | Given SEC-00, this is now the single highest-priority testing gap in the repo: once the auth fix lands, a test asserting `approvals.approve`/`reject` reject an unauthenticated caller and a cross-workspace caller is essentially the acceptance criterion for that fix. |
| Audit logging | None found | `apps/server/src/audit.ts`'s `logAudit` swallows its own errors by design (correct behavior — a broken audit write shouldn't break the action it's logging) but that design choice itself has no regression test confirming a DB failure during `logAudit` doesn't propagate. Small, isolated, safe to add — candidate for a quick follow-up. |
| Knowledge source handling | None found | `knowledge-base.ts` (15.9KB) has no test file. Given it's part of the automatic prompt-injection path (`ARCHITECTURE.md` section 9), a test confirming the per-workspace `inject_into_prompts` toggle is actually respected (on *and* off) would be high-value and reasonably isolated. |

## What "isolated test" means for this repo, going forward

The pattern already established and worth continuing (`plugins.test.ts`, `skills-resolve.test.ts`, `workspace-file-tools.test.ts`, and this audit's `runtime.test.ts`): pure-function and permission-boundary tests that use real temp directories (`mkdtemp`) rather than mocking the filesystem, and fake/injected dependencies (see `plugins.test.ts`'s fetch stubbing) rather than hitting real network/DB where avoidable. Tests that must touch a real DB appear to use an in-memory/temp SQLite instance per test (worth confirming and documenting explicitly here once the core team's convention is settled — this audit didn't want to presume one).
