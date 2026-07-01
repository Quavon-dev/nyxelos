---
tags: [adr, frontend]
created: 2026-07-01
status: accepted
---

# ADR-0005: Frontend Framework — Next.js Instead of TanStack Start

## Context

The original plan (see ADR context in `docs/ARCHITECTURE.md` v1) paired TanStack Router with TanStack Start as the frontend meta-framework, driven by the initial requirement to use TanStack Router. Partway through Phase 0 scaffolding, the requirement changed: use Next.js for the frontend.

## Decision

Next.js (App Router) replaces TanStack Start/TanStack Router as the frontend framework. TanStack Query is kept unchanged for all client-side data fetching and caching — it composes fine with Next.js and was never tied to TanStack Router specifically. Routing now uses Next's file-based `app/` router (`useRouter`/`useParams` from `next/navigation`) instead of TanStack Router's route tree.

## Rationale

Next.js is shadcn/ui's primary, best-documented target, which matters given the hard requirement to stay on shadcn/ui's default design system. It also ships routing, streaming SSR, and React Server Components in one package, which is comparable in capability to TanStack Start but is what was explicitly asked for. Nothing about the rest of the architecture (Bun/Hono/tRPC backend, streaming via SSE, Drizzle over Postgres/SQLite, MCP layer) depends on the frontend framework choice, so this swap is isolated to `apps/web`.

## Consequences

`apps/web` was rebuilt from a Vite + TanStack Router SPA scaffold to a Next.js App Router app: `src/app/` replaces the code-based route tree, `src/app/globals.css` replaces `src/styles/globals.css` (same shadcn default tokens, unchanged), and pages became `"use client"` components using `next/navigation` instead of TanStack Router hooks. `docs/ARCHITECTURE.md` section 3 (Technology Stack) and the monorepo structure in section 4 were updated to match.
