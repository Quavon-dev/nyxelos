---
tags: [meta, overview]
created: 2026-07-01
---

# Project Overview: NyxelOS

NyxelOS is a fully open source, self-hosted agentic OS with a web UI. It runs either locally on your own PC or on your own server with its own URL and login. Core idea: unite local and cloud AI models, skills, MCP servers, plugins, different agent categories (normal chats, autonomous agents, super-agents), and an Obsidian-based knowledge base in a single UI held consistently to the shadcn/ui default design.

Full architecture plan: see `../../docs/ARCHITECTURE.md` in the project repository.

## Core Principles

Local-first: usable without internet once a local model is running. Modularity: models, skills, MCP servers, and the database are all swappable. Security by default: every autonomy level must be explicitly enabled. Consistent design: exclusively the shadcn/ui default theme, no deviations.

## Technology at a Glance

Bun runtime with Hono and tRPC on the backend, React with TanStack Start, TanStack Router, and TanStack Query on the frontend, shadcn/ui as the design system, Drizzle ORM over PostgreSQL (Docker, server mode) or SQLite (PC mode), Better-Auth for login, Vercel AI SDK together with the official MCP TypeScript SDK for model connectivity and tool calls.

## Status

As of July 1, 2026: planning phase complete, implementation of Phase 0 (Foundation) not yet started. See the architecture plan, section 15, for the full phased roadmap.
