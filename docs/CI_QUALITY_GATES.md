# CI & Quality Gates

Audit of `.github/workflows/*.yml` as they exist today, plus concrete recommendations.

## What exists today

| Workflow | Trigger | What it does | Blocking? |
|---|---|---|---|
| `ci.yml` | PR + push to `main` | `lint` (Biome, scoped to changed files via `--changed --since=origin/main`), `typecheck` (`bun run typecheck`), `build` (`bun run build`), `test` (`bun run test`, runs after `lint`/`typecheck` via `needs:`) — four jobs | Yes (no `continue-on-error`) |
| `codeql.yml` | PR + push to `main` + weekly cron | CodeQL static analysis, `javascript-typescript` | Not required-check by default (no branch protection config visible in-repo — GitHub branch protection is configured outside the repo, this audit can't confirm from source alone) |
| `dependency-review.yml` | PR only | `actions/dependency-review-action`, comments on PR on failure | **No** — `continue-on-error: true`, explicitly because it needs the repo's "Dependency graph" setting enabled first (good inline comment explaining why) |
| `docker.yml` | PR (build-only) + push to `main`/tags (build+push to GHCR) | Multi-arch (`amd64`/`arm64`) build of `apps/server`/`apps/web` images | PR: validates build succeeds. Push: publishes. |
| `package.yml` | Changes under `packages/create-nyxel/**` | Build, typecheck, smoke-test the `create-nyxel` CLI (`--mode pc`/`--mode server`, verifies compose files land); publish to npm on `create-nyxel@*` tags | Yes for build/smoke-test |
| `pr-title.yml` | PR opened/edited/synced | Enforces Conventional Commits format on the PR title (`amannn/action-semantic-pull-request`) | Yes |
| `secret-scan.yml` | PR + push to `main` | gitleaks | Not yet — `continue-on-error: true` until a first run's findings are triaged (see below) |

`test` is fully green today (`bun test` passes from a clean checkout — see `TESTING_STRATEGY.md`); the dead `/tests/` files and non-hermetic failures that used to block adding this job as a required check have all been fixed.

## Recommendation: what should block a PR vs. warn

**Blocking (required check) — matches today's `ci.yml`:**
- `lint`, `typecheck`, `build`, `test` — all blocking, no `continue-on-error`.
- `pr-title.yml` — blocking.

**Warn only (non-blocking), and why:**
- `dependency-review.yml` — `continue-on-error: true`; keep until the repo's Dependency graph setting is confirmed enabled (a GitHub repo-settings change, not a workflow-file change).
- `codeql.yml` — CodeQL is genuinely useful but has a real false-positive rate on TypeScript; recommend it stays as a visible check reviewers glance at rather than a hard merge-blocker until the team has a few months of signal on its noise level in this codebase specifically.
- `secret-scan.yml` — see below; remove `continue-on-error` once its first run's findings are triaged.

## Secret-scan job (`.github/workflows/secret-scan.yml`)

`BL-14` is implemented, with one deliberate difference from the originally-proposed YAML: `continue-on-error: true` is set on the job. `SECURITY_AUDIT.md` SEC-06 was verified clean (`nyxel.sqlite*` is gitignored and was never committed), so the specific risk that motivated this job isn't a known live finding — but gitleaks' full-history scan against this repo hasn't actually been run yet, so it may still surface something unrelated (an old API key pasted into a commit message, a test fixture that looks like a secret, etc.). Non-blocking on first rollout, matching the same pattern already used for `dependency-review.yml`. **Once the first run's findings (if any) have been triaged, remove `continue-on-error: true` to make it a required check** — that's the one remaining step for this item.

## Commands to run locally before every PR

Matches what CI actually runs, so a clean local pass means a clean CI pass:

```bash
bun install --frozen-lockfile
bunx biome check .                    # full repo — CI only checks the diff via --changed, but full is safer locally
bun run typecheck
bun run build
bun test
```

## Fail-fast behavior

`ci.yml`'s `lint`, `typecheck`, and `build` jobs run in parallel (no `needs:` between them) — a lint failure doesn't block typecheck/build from also running and reporting, which is correct for a PR check (you want all the feedback in one round, not one-error-at-a-time). `test` is the one exception: it declares `needs: [lint, typecheck]`, so it only starts once both pass — a deliberate ordering (there's little point spending CI minutes running the suite against code that doesn't even typecheck) rather than an oversight. `codeql.yml`'s matrix has `fail-fast: false` for the multi-language case (though only one language is configured today). This is already the right shape; no change recommended.

`docker.yml` and `package.yml` both use `concurrency: { group: ..., cancel-in-progress: true }` scoped per-ref — correctly avoids wasting runner time on superseded pushes to the same PR/branch. `ci.yml` has the same. Good pattern, consistently applied; nothing to fix here.
