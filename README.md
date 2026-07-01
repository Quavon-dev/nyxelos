# NyxelOS

A fully open source, self-hosted agentic OS with a web UI — on your own PC or on your own server with a URL and login. Local and cloud AI models, skills, MCP servers, plugins, normal chats, autonomous agents, and super-agents in a single UI consistently built in the shadcn/ui default design.

Status: Phase 0 (foundation) scaffolded — monorepo, database layer, model provider layer, backend, and a minimal streaming chat UI. Not yet ready to run in production.

Full architecture plan: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

Living project documentation (Obsidian vault): [`knowledge-base/`](knowledge-base/)

## Project layout

```
apps/
  web/      # Next.js (App Router) + shadcn/ui frontend
  server/   # Bun + Hono + tRPC backend, agent engine
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

## PC mode (Docker, SQLite)

```
cp .env.example .env   # set BETTER_AUTH_SECRET at minimum
docker compose -f docker-compose.pc.yml up --build
```

## Server mode (Docker, PostgreSQL + your own domain)

```
cp .env.example .env   # set NYXEL_DOMAIN, POSTGRES_PASSWORD, BETTER_AUTH_SECRET
docker compose -f docker-compose.server.yml up --build -d
```

Caddy requests a TLS certificate for `NYXEL_DOMAIN` automatically and reverse-proxies `/trpc/*` and `/api/*` to the server, everything else to the web app.

## Database migrations

```
bun run db:generate   # generates SQL for both dialects from the Drizzle schema
bun run db:migrate    # applies migrations for whichever DB_DRIVER is active
```
