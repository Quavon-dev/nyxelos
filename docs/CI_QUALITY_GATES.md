# CI & Quality Gates

Audit of `.github/workflows/*.yml` as they exist today, plus concrete recommendations. See [`TESTING_STRATEGY.md`](TESTING_STRATEGY.md) for why the test-job recommendation below is sequenced *after* two small fixes, not immediate.

## What exists today

| Workflow | Trigger | What it does | Blocking? |
|---|---|---|---|
| `ci.yml` | PR + push to `main` | `lint` (Biome, scoped to changed files via `--changed --since=origin/main`), `typecheck` (`bun run typecheck`), `build` (`bun run build`) — three parallel jobs | Yes (no `continue-on-error`) |
| `codeql.yml` | PR + push to `main` + weekly cron | CodeQL static analysis, `javascript-typescript` | Not required-check by default (no branch protection config visible in-repo — GitHub branch protection is configured outside the repo, this audit can't confirm from source alone) |
| `dependency-review.yml` | PR only | `actions/dependency-review-action`, comments on PR on failure | **No** — `continue-on-error: true`, explicitly because it needs the repo's "Dependency graph" setting enabled first (good inline comment explaining why) |
| `docker.yml` | PR (build-only) + push to `main`/tags (build+push to GHCR) | Multi-arch (`amd64`/`arm64`) build of `apps/server`/`apps/web` images | PR: validates build succeeds. Push: publishes. |
| `package.yml` | Changes under `packages/create-nyxel/**` | Build, typecheck, smoke-test the `create-nyxel` CLI (`--mode pc`/`--mode server`, verifies compose files land); publish to npm on `create-nyxel@*` tags | Yes for build/smoke-test |
| `pr-title.yml` | PR opened/edited/synced | Enforces Conventional Commits format on the PR title (`amannn/action-semantic-pull-request`) | Yes |

**What's missing: no `test` job anywhere.** `bun test` is never invoked in CI. See `TESTING_STRATEGY.md` for the current state of the suite (77 pass / 7 fail / 5 errors when run manually in this audit) and why that needs two small fixes before a CI gate would be useful rather than immediately red.

**Also missing: no dedicated secret-scanning workflow** (e.g. `gitleaks`, `trufflehog`) — CodeQL doesn't cover secret detection. Given `SECURITY_AUDIT.md` SEC-01/SEC-06 (plaintext secrets in the DB, a live `nyxel.sqlite*` sitting at repo root during dev), a lightweight gitleaks-on-PR workflow would catch an accidental `git add nyxel.sqlite` or a pasted API key before merge, cheaply.

## Recommendation: what should block a PR vs. warn

**Should be blocking (required check):**
- `lint`, `typecheck`, `build` — already blocking, keep as-is.
- `pr-title.yml` — already blocking, keep.
- `test` (new, see below) — once `TESTING_STRATEGY.md`'s two prerequisite fixes land, this should block. Don't add it as blocking before then, or every PR turns red on pre-existing, unrelated failures.
- A new lightweight **secret-scan** job — should block; a caught secret is exactly the kind of thing you want to stop before merge, not just flag.

**Should warn only (non-blocking), and why:**
- `dependency-review.yml` — already `continue-on-error: true`; keep until the repo's Dependency graph setting is confirmed enabled (that's a GitHub repo-settings change, not a workflow-file change, out of this audit's reach).
- `codeql.yml` — CodeQL is genuinely useful but has a real false-positive rate on TypeScript; recommend it stays as a visible check that reviewers glance at rather than a hard merge-blocker, at least until the team has a few months of signal on its noise level in this specific codebase. If it's already required via branch protection outside the workflow file, that's a reasonable choice too — this is a judgment call the core team should make with actual false-positive data, not something this audit can determine from source alone.

**Currently missing, worth adding:**
- **`test`** (blocking, once prerequisites land) — see exact job below.
- **Secret scanning** (blocking) — see exact job below.
- **`docker.yml` doesn't run on `packages/**` changes that affect only `create-nyxel`** — already correctly scoped via `paths:`, no change needed, noted here only to confirm it was checked.

## Proposed `test` job for `ci.yml`

Once `TESTING_STRATEGY.md`'s `BL-12`/`BL-13` land (dead test files removed, `seo-analyzer` fallback test fixed or explicitly skipped), add:

```yaml
  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14
      - run: bun install --frozen-lockfile
      - run: bun test
```

Matches the existing `lint`/`typecheck`/`build` job shape exactly (same checkout/setup-bun/install pattern) — no new conventions introduced. Add it to `ci.yml` as a fourth parallel job alongside the existing three.

## Proposed secret-scan job (new workflow, `secret-scan.yml`)

```yaml
name: Secret scan

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  gitleaks:
    name: Gitleaks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Not added directly in this session — new workflow files are exactly the kind of change worth a real trial run (gitleaks against this repo's actual history could surface findings, e.g. around the `nyxel.sqlite*` files noted in `SECURITY_AUDIT.md` SEC-06, that need triage before the job can be made blocking) rather than merging blind. Recorded as backlog `BL-14` with the exact YAML above ready to use.

## Commands to run locally before every PR

Matches what CI actually runs, so a clean local pass means a clean CI pass (once `test` is added):

```bash
bun install --frozen-lockfile
bunx biome check .                    # full repo — CI only checks the diff via --changed, but full is safer locally
bun run typecheck
bun run build
bun test                              # not yet in CI — see above; run it anyway, it already catches real bugs (TESTING_STRATEGY.md)
```

## Fail-fast behavior

`ci.yml`'s three jobs run in parallel (no `needs:` between them) — a lint failure doesn't block typecheck/build from also running and reporting, which is correct for a PR check (you want all the feedback in one round, not one-error-at-a-time). `codeql.yml`'s matrix has `fail-fast: false` for the same reason (multi-language, though only one language is configured today). This is already the right shape; no change recommended.

`docker.yml` and `package.yml` both use `concurrency: { group: ..., cancel-in-progress: true }` scoped per-ref — correctly avoids wasting runner time on superseded pushes to the same PR/branch. `ci.yml` has the same. Good pattern, consistently applied; nothing to fix here.
