# Deployment Hardening Guide

Companion to [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) and [`docs/INSTALL.md`](INSTALL.md) — INSTALL.md covers *how* to stand up PC mode or server mode; this document covers what to check before either one is reachable by anyone other than you. It's written against what's actually in `docker-compose.pc.yml`, `docker-compose.server.yml`, `Caddyfile`, and the three `.env.example` files today, not generic advice.

## Before you run either compose file

- [ ] **Generate a real `BETTER_AUTH_SECRET` and `NYXEL_ENCRYPTION_KEY`.** `openssl rand -base64 32` for each (two *different* values — never reuse one for the other, different rotation lifecycles), put them in your root `.env`. Both compose files now refuse to start without them — see "PC mode's fixed default" below.
- [ ] **Generate `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`** if you want push notifications to survive a server restart. Without them, `apps/server/src/push.ts` generates a fresh throwaway pair every boot and logs it to stdout — every existing push subscription silently breaks on restart. `openssl` doesn't generate VAPID keys directly; the simplest path is running `bunx web-push generate-vapid-keys` once and saving the output.
- [ ] **Server mode only:** set a real `POSTGRES_PASSWORD` and `NYXEL_DOMAIN`. `docker-compose.server.yml` already fails loudly (`${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}`) if you forget — good, keep relying on that pattern.
- [ ] **Confirm `nyxel.sqlite*` isn't tracked in git** if you're deploying from a fork/clone that's had local dev runs against it: `git check-ignore -v nyxel.sqlite`. See `SECURITY_AUDIT.md` SEC-06 (verified clean as of this session).
- [ ] **If you need remote plugin installation or custom-code skills in production**, read `docs/PLUGIN_SECURITY.md` first, then explicitly set `ENABLE_REMOTE_PLUGIN_INSTALL=true` / `ENABLE_CUSTOM_CODE_SKILLS=true` — both default to disabled in production (`NODE_ENV=production`) because they run unsandboxed code in the main server process.

## PC mode's fixed default — read this even if you "just want to try it locally"

`docker-compose.pc.yml` used to set `BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:-dev-secret-change-me}` — a silent fallback to a known-public value. **Fixed in this session**: both `BETTER_AUTH_SECRET` and `NYXEL_ENCRYPTION_KEY` now use the fail-loud `${VAR:?message}` pattern (matching `docker-compose.server.yml`'s existing, correct pattern for its own secrets) — `docker compose -f docker-compose.pc.yml up` now refuses to start at all without a real `.env`, in *either* mode, rather than silently booting with a public value.

This closes the gap even if PC mode is later exposed beyond `localhost` (LAN, Tailscale, port-forward — the README documents this as a supported use case, `ARCHITECTURE.md` section 11): there is no longer a "silent" path to a forgeable session secret. The one-time cost is that the previously-zero-config `docker compose -f docker-compose.pc.yml up --build` one-liner now requires `cp .env.example .env` plus setting two real values first — the README's quickstart was updated to say so explicitly.

Also fixed this session: `apps/server/src/auth.ts`'s production guard (previously: throws only when the variable is **completely unset**) now also rejects known-weak placeholder values (`dev-secret`, `change-me`, `example`, `test`, `password`, case-insensitive substring match) and enforces a minimum length — see `packages/db/src/secret-guard.ts`'s `assertProductionSecret`, shared by `auth.ts` and the new `NYXEL_ENCRYPTION_KEY` guard in `packages/db/src/crypto.ts`.

## Network exposure by mode

| | PC mode | Server mode |
|---|---|---|
| Reverse proxy | None — `server:3001` and `web:3000` are both published directly (`ports:` in `docker-compose.pc.yml`) | Caddy, TLS-terminated, only `80`/`443` published |
| Security headers (nosniff, frame-options, referrer-policy) | **None** — these are set in `Caddyfile`, which PC mode doesn't run | Present, see below for what's still missing |
| Intended reachability | `localhost`, or LAN via `WEB_ORIGIN`/manual port exposure | Public domain over TLS |

If you expose PC mode beyond `localhost` (LAN, Tailscale, port-forward), you're intentionally taking on everything Caddy would otherwise give you for free in server mode. At minimum, set `WEB_ORIGIN` to the exact origin(s) you'll access it from (comma-separated — see `apps/server/src/auth.ts:7-14`) so CORS stays an allowlist rather than something you're tempted to loosen, and put your own reverse proxy (even a bare Caddy/nginx in front) in the path if the audience is anyone other than you.

## Caddy headers: present vs. still missing

`Caddyfile` now sets:
```
X-Content-Type-Options nosniff
Referrer-Policy strict-origin-when-cross-origin
X-Frame-Options SAMEORIGIN
Strict-Transport-Security "max-age=31536000; includeSubDomains"
Permissions-Policy "microphone=(self), camera=()"
```

**Done**: HSTS (server mode is TLS-only by design, so this is unconditionally safe) and `Permissions-Policy` (restricts microphone to same-origin, given the in-browser Whisper dictation feature; camera is denied entirely since nothing in the app requests it).

Still not set, intentionally:
- **`Content-Security-Policy`** — no CSP is set today. This remains the highest-effort item on this list (needs auditing every inline script/style, font, and third-party asset the Next.js app actually loads — `apps/web` uses `@xyflow/react`, `recharts`, `katex`, syntax highlighting, and a WASM-based Whisper model via `@huggingface/transformers`, several of which may need specific `script-src`/`worker-src`/`connect-src` allowances). Don't ship a copy-pasted generic CSP without testing against the real app; a wrong CSP silently breaks the Whisper WASM path or chart rendering. Recommend scoping this as its own backlog item with a real testing pass against a running instance, not a drive-by header add — see backlog `BL-21`.

These are Caddyfile-only changes (not application code); PC mode still has no Caddy layer to add them to (see the network-exposure table above).

## Docker image hardening (both `Dockerfile`s)

**Done**: both `apps/server/Dockerfile` and `apps/web/Dockerfile` now switch to the `oven/bun:1` base image's built-in `bun` user (uid/gid 1000, created by the upstream image but not activated by default) via a `USER bun` directive before the final `CMD`. Files copied into the image use `COPY --chown=bun:bun` so they stay readable by that user, and `apps/server/Dockerfile` additionally pre-creates `/data` (the SQLite volume mount point used by `docker-compose.pc.yml`'s `nyxel-data` volume) and `chown`s it to `bun:bun` before the user switch — Docker seeds a fresh named volume from whatever is already at its mount path in the image on first use, so this keeps `/data` writable once the container is running as a non-root user. `apps/web/Dockerfile`'s runtime stage has no volumes, so no equivalent step was needed there.

Not changed: `apps/server/Dockerfile` still does a single-stage `bun install` (no `--frozen-lockfile`) and copies the full monorepo context in — out of scope for this pass, tracked separately if it becomes worth doing.

## `.env.example` changes

Original audit session: added `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_CONTACT_EMAIL` with an explanatory comment; strengthened the `BETTER_AUTH_SECRET` comment.

This session: added `NYXEL_ENCRYPTION_KEY` to both `apps/server/.env.example` and the root `.env.example` (required in production — see `packages/db/src/crypto.ts`), and added `ENABLE_REMOTE_PLUGIN_INSTALL`/`ENABLE_CUSTOM_CODE_SKILLS` (commented out, opt-in) to `apps/server/.env.example`.

## Quick pre-deploy checklist

```
[ ] BETTER_AUTH_SECRET is a real generated value (not "dev-secret-change-me" / "change-me...")
[ ] NYXEL_ENCRYPTION_KEY is a real generated value, different from BETTER_AUTH_SECRET
[ ] POSTGRES_PASSWORD is a real generated value (server mode)
[ ] VAPID keys are set if push notifications matter to you
[ ] WEB_ORIGIN matches exactly the origin(s) you'll access the app from
[ ] NYXEL_DOMAIN's DNS already points at this host before first Caddy start (ACME needs it)
[ ] nyxel.sqlite* is not committed to your fork's git history
[ ] ENABLE_REMOTE_PLUGIN_INSTALL / ENABLE_CUSTOM_CODE_SKILLS are left unset (disabled) unless you specifically need them and have read docs/PLUGIN_SECURITY.md
```
