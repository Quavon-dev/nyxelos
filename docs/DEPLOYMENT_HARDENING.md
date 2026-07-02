# Deployment Hardening Guide

Companion to [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) and [`docs/INSTALL.md`](INSTALL.md) — INSTALL.md covers *how* to stand up PC mode or server mode; this document covers what to check before either one is reachable by anyone other than you. It's written against what's actually in `docker-compose.pc.yml`, `docker-compose.server.yml`, `Caddyfile`, and the three `.env.example` files today, not generic advice.

## Before you run either compose file

- [ ] **Generate a real `BETTER_AUTH_SECRET`.** `openssl rand -base64 32`, put it in your root `.env`. Do not leave it unset. See "PC mode's silent default" below — this is more urgent for PC mode than the code's own guard suggests.
- [ ] **Generate `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`** if you want push notifications to survive a server restart. Without them, `apps/server/src/push.ts` generates a fresh throwaway pair every boot and logs it to stdout — every existing push subscription silently breaks on restart. `openssl` doesn't generate VAPID keys directly; the simplest path is running `bunx web-push generate-vapid-keys` once and saving the output. Both `.env.example` files were updated in this audit to mention this (see below).
- [ ] **Server mode only:** set a real `POSTGRES_PASSWORD` and `NYXEL_DOMAIN`. `docker-compose.server.yml` already fails loudly (`${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}`) if you forget — good, keep relying on that pattern.
- [ ] **Confirm `nyxel.sqlite*` isn't tracked in git** if you're deploying from a fork/clone that's had local dev runs against it: `git check-ignore -v nyxel.sqlite`. See `SECURITY_AUDIT.md` SEC-06.

## PC mode's silent default — read this even if you "just want to try it locally"

`docker-compose.pc.yml` sets `BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:-dev-secret-change-me}`. The server image bakes in `NODE_ENV=production` (`apps/server/Dockerfile:12`) regardless of which compose file starts it, and `apps/server/src/auth.ts`'s production guard only throws when the variable is **completely unset** — not when it's set to a known public default. Combining these three facts: **running `docker compose -f docker-compose.pc.yml up --build` without first creating a `.env` with a real `BETTER_AUTH_SECRET` gives you a "production" container whose session-signing secret is the literal string `dev-secret-change-me`, published in this open-source repo.** Anyone who knows this (now including anyone reading this doc, or the repo itself) can forge a valid session cookie for that instance.

This matters most if PC mode is ever reachable beyond `localhost` — the README explicitly documents this as a supported use case ("optional password protection in case the UI needs to be reachable on the home network," `ARCHITECTURE.md` section 11). **If your PC-mode instance is reachable from anywhere other than `127.0.0.1`, treat a real `BETTER_AUTH_SECRET` as mandatory, not optional**, regardless of what the compose file's fallback lets you skip.

The compose file itself was intentionally *not* changed in this audit (see `SECURITY_AUDIT.md` SEC-07) — `docker-compose.server.yml` already shows the right fix pattern (`${VAR:?message}` instead of `${VAR:-default}`), and applying the same pattern to `docker-compose.pc.yml`'s `BETTER_AUTH_SECRET` is tracked as backlog `BL-07` for whoever owns Docker/deployment files next.

## Network exposure by mode

| | PC mode | Server mode |
|---|---|---|
| Reverse proxy | None — `server:3001` and `web:3000` are both published directly (`ports:` in `docker-compose.pc.yml`) | Caddy, TLS-terminated, only `80`/`443` published |
| Security headers (nosniff, frame-options, referrer-policy) | **None** — these are set in `Caddyfile`, which PC mode doesn't run | Present, see below for what's still missing |
| Intended reachability | `localhost`, or LAN via `WEB_ORIGIN`/manual port exposure | Public domain over TLS |

If you expose PC mode beyond `localhost` (LAN, Tailscale, port-forward), you're intentionally taking on everything Caddy would otherwise give you for free in server mode. At minimum, set `WEB_ORIGIN` to the exact origin(s) you'll access it from (comma-separated — see `apps/server/src/auth.ts:7-14`) so CORS stays an allowlist rather than something you're tempted to loosen, and put your own reverse proxy (even a bare Caddy/nginx in front) in the path if the audience is anyone other than you.

## Caddy headers: present vs. still missing

`Caddyfile` currently sets:
```
X-Content-Type-Options nosniff
Referrer-Policy strict-origin-when-cross-origin
X-Frame-Options SAMEORIGIN
```

Not currently set, worth adding for server mode specifically (PC mode has no Caddy layer to add them to — see above):

- **`Strict-Transport-Security`** (HSTS) — Caddy auto-provisions TLS but doesn't add HSTS by default; since server mode is TLS-only by design, this is a low-risk, high-value addition: `header Strict-Transport-Security "max-age=31536000; includeSubDomains"`.
- **`Content-Security-Policy`** — no CSP is set today. This is the highest-effort item on this list (needs auditing every inline script/style, font, and third-party asset the Next.js app actually loads — `apps/web` uses `@xyflow/react`, `recharts`, `katex`, syntax highlighting, and a WASM-based Whisper model via `@huggingface/transformers`, several of which may need specific `script-src`/`worker-src`/`connect-src` allowances). Don't ship a copy-pasted generic CSP without testing against the real app; a wrong CSP silently breaks the Whisper WASM path or chart rendering. Recommend scoping this as its own backlog item with a real testing pass, not a drive-by header add.
- **`Permissions-Policy`** — worth restricting `microphone`/`camera` to `self` given the in-browser Whisper dictation feature explicitly requests mic access; an explicit policy documents intent even though the browser's own permission prompt is the real gate.

These are Caddyfile-only changes (not application code) and were left undone in this audit rather than applied blind, given the CSP caveat above — see backlog `BL-10`.

## Docker image hardening (both `Dockerfile`s)

Neither `apps/server/Dockerfile` nor `apps/web/Dockerfile` sets a `USER` directive — both run as root inside the container by default (the `oven/bun:1` base image's default user). Also, `apps/server/Dockerfile` does a single-stage `bun install` with no `--production`/`--frozen-lockfile` distinction from the dev install, and copies the full monorepo context in (`COPY packages ./packages`, `COPY apps/web/package.json ...`) rather than a pruned production subset — larger image and attack surface than strictly necessary, though not a direct vulnerability.

Recommended, not applied in this audit (Docker/deployment files are explicitly in scope for documentation-only per this audit's mandate when the change touches build output correctness, which a `USER` directive change does — needs a real build+run verification pass, not a blind edit):
- Add a non-root `USER bun` (the `oven/bun` base image ships a `bun` user) after `RUN bun install` in both Dockerfiles, provided file permissions on mounted volumes (`nyxel-data`, `nyxel-postgres`) are compatible — needs a real test against `docker-compose.pc.yml`'s volume mount, since a permission mismatch here would break the running container in a way this audit can't verify without executing Docker builds.
- Consider `bun install --frozen-lockfile` in the Dockerfile (already used in CI, `ci.yml`) for reproducible image builds, matching what CI already enforces.

Backlog `BL-11`.

## `.env.example` changes made in this audit

Small, isolated, non-functional doc-only edits (see repo diff for `apps/server/.env.example` and root `.env.example`):
- Added `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_CONTACT_EMAIL` with an explanatory comment (previously undocumented — see push notes above).
- Strengthened the `BETTER_AUTH_SECRET` comment in `apps/server/.env.example` to explicitly call out that the shipped default is publicly known and must not reach any deployment reachable beyond localhost.
- No functional/behavioral changes — these are comments and new optional variable placeholders only.

## Quick pre-deploy checklist

```
[ ] BETTER_AUTH_SECRET is a real generated value (not "dev-secret-change-me" / "change-me...")
[ ] POSTGRES_PASSWORD is a real generated value (server mode)
[ ] VAPID keys are set if push notifications matter to you
[ ] WEB_ORIGIN matches exactly the origin(s) you'll access the app from
[ ] NYXEL_DOMAIN's DNS already points at this host before first Caddy start (ACME needs it)
[ ] nyxel.sqlite* is not committed to your fork's git history
[ ] If PC mode is reachable beyond localhost, you've read the "PC mode's silent default" section above
```
