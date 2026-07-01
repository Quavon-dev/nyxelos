# NyxelOS

A fully open source, self-hosted agentic OS with a web UI — on your own PC or on your own server with a URL and login. Local and cloud AI models, skills, MCP servers, plugins, normal chats, autonomous agents, and super-agents in a single UI consistently built in the shadcn/ui default design.

Status: Self-hosting polish (Phase 5) is implemented for first-run setup, Docker packaging, and Caddy-backed server installs. Phase 6 is partially implemented: DB-backed dynamic skills with a "Skills" tab (selection + creation), automatic knowledge-base injection into every chat/agent/automation, and file-watch automations — see `knowledge-base/01-Decisions/ADR-0013-*.md`. The product is still pre-1.0 software.

Full architecture plan: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
Installation guide: [`docs/INSTALL.md`](docs/INSTALL.md)

Living project documentation (Obsidian vault): [`knowledge-base/`](knowledge-base/)

## Project layout

```
apps/
  web/      # Next.js (App Router) + shadcn/ui frontend
  server/   # Bun + Hono + tRPC backend, agent engine
  companion-macos/ # MCP server for local Calendar/Contacts/Photos/Reminders access on macOS
packages/
  db/                 # Drizzle schema + repository layer (Postgres or SQLite)
  model-providers/    # local model detection + cloud/local model routing
```

## Local development (no Docker)

Requires [Bun](https://bun.sh) 1.3+.

```
bun install

cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env.local

bun dev
```

This starts the server on `http://localhost:3001` (SQLite database by default, a `nyxel.sqlite` file is created next to `apps/server`) and the web app on `http://localhost:3000`. Start [Ollama](https://ollama.com) or [LM Studio](https://lmstudio.ai) beforehand to have local models show up automatically, or set `ANTHROPIC_API_KEY` in `apps/server/.env` to enable Claude models.

## macOS companion (Phase 4)

The local-data companion lives in [`apps/companion-macos/`](apps/companion-macos). It is a standalone MCP server that exposes local calendar, contacts, photo search, and reminders tools for Nyxel. The preferred path is the native Swift bridge (`EventKit`, `Contacts`, `PhotoKit`); if that bridge is missing, the server falls back to an AppleScript/Spotlight implementation behind the same tool names.

Quick start:

```bash
npm install --prefix apps/companion-macos --package-lock=false
swift build --package-path apps/companion-macos/native -c release
node --experimental-strip-types apps/companion-macos/src/index.ts
```

Then register it in Nyxel as a `stdio` MCP server:

- Command: `node`
- Args: `--experimental-strip-types /ABSOLUTE/PATH/TO/apps/companion-macos/src/index.ts`

More detail: [`apps/companion-macos/README.md`](apps/companion-macos/README.md)

## PC mode (Docker, SQLite)

```
cp .env.example .env   # set BETTER_AUTH_SECRET at minimum
docker compose -f docker-compose.pc.yml up --build
```

Then open `http://localhost:3000` and complete the setup wizard:

- choose `PC mode`
- create the first owner account
- confirm the primary workspace name
- keep `http://localhost:3000` as the public app URL unless you changed the exposed port

## Server mode (Docker, PostgreSQL + your own domain)

```
cp .env.example .env   # set NYXEL_DOMAIN, POSTGRES_PASSWORD, BETTER_AUTH_SECRET, optionally ACME_EMAIL
docker compose -f docker-compose.server.yml up --build -d
```

Then browse to `https://NYXEL_DOMAIN` and complete the setup wizard:

- choose `Server mode`
- create the first owner account
- keep the default public app URL (`https://NYXEL_DOMAIN`) unless you front it differently

Caddy requests a TLS certificate for `NYXEL_DOMAIN` automatically, serves `/healthz`, reverse-proxies `/trpc/*` and `/api/*` to the server, and sends everything else to the web app.

## Docker images

The Compose files now assign stable local image names:

- `nyxel/server:pc`
- `nyxel/web:pc`
- `nyxel/server:server`
- `nyxel/web:server`

That makes it straightforward to prebuild, inspect, or retag images independently of a running stack.

## Database migrations

```
bun run db:generate   # generates SQL for both dialects from the Drizzle schema
bun run db:migrate    # applies migrations for whichever DB_DRIVER is active
```
