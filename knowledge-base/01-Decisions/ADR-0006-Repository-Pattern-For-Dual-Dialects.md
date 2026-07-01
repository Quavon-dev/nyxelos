---
tags: [adr, database]
created: 2026-07-01
status: accepted
---

# ADR-0006: Repository Interface Instead of a Shared Drizzle Instance

## Context

ADR-0002 established that Nyxel supports both PostgreSQL and SQLite via Drizzle ORM, picked once at install time. While implementing `packages/db`, a naive approach — one `schema` object and one `db` instance chosen by a runtime ternary — runs into a real TypeScript limitation: `drizzle(pgClient, { schema: pgSchema })` and `drizzle(sqliteClient, { schema: sqliteSchema })` produce structurally different generic types, so a variable typed as their union loses the ability to call `.select()`/`.insert()` against either schema coherently at the call site.

## Decision

`packages/db` defines a dialect-agnostic `DbRepository` interface (`src/repo/types.ts`) with plain-data methods (`createWorkspace`, `listMessages`, `addMessage`, etc.). Two concrete implementations — `pg.repo.ts` and `sqlite.repo.ts` — each hold their own fully-typed Drizzle instance and schema, with no cross-dialect generics involved. `client.ts` picks one implementation at startup based on `DB_DRIVER` and returns it as a `DbRepository`. The rest of the app (tRPC router, chat-stream route) only ever imports the `DbRepository` type and `getDb()` — never a Drizzle table or dialect-specific type.

Better-Auth is the one exception: its Drizzle adapter needs a raw `db` + `schema` pair, so `auth-db.ts` exports a small `createAuthDb()` used only by `apps/server/src/auth.ts`, isolated from the rest of the app.

## Consequences

Adding a new query means adding a method to `DbRepository` and implementing it twice (once per dialect) — slightly more typing than a single shared query, but every implementation stays fully type-checked against its own schema, and the application layer is completely insulated from which dialect is active. This mirrors the adapter pattern already used for local vs. cloud model providers (`packages/model-providers`) and for the planned macOS/Windows companion helpers (ADR-0003) — pick-one-implementation-at-runtime-behind-a-typed-interface is now the standard pattern across Nyxel's pluggable subsystems.
