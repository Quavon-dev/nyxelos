---
tags: [adr, backend]
created: 2026-07-01
status: accepted
---

# ADR-0001: Backend Runtime and HTTP/RPC Layer

## Context

NyxelOS needed a backend technology that is "the fastest and best, without much effort." Candidates were a unified TypeScript stack (Node.js or Bun), a Python backend (stronger classic ML ecosystem, but two languages in the project), and Go (very performant, but a small AI ecosystem).

## Decision

Bun as the runtime, Hono as the HTTP layer, tRPC for typed requests between the server and TanStack Query, dedicated SSE routes for chat streaming.

## Rationale

Bun offers, per current benchmarks (mid-2026), 3–4x higher HTTP throughput than Node.js, native TypeScript execution with no build step, and very short cold starts. Anthropic now uses Bun itself to power Claude Code, confirming production readiness. Since the frontend (TanStack Router/Query) is already TypeScript, a Bun backend keeps the entire project in one language and one package manager — the lowest possible effort combined with the highest speed. tRPC avoids a separate API schema and the extra boilerplate that comes with it.

## Alternatives

Python/FastAPI was rejected because it brings two languages and two toolchains into the project without NyxelOS depending on classic ML training libraries (actual model execution happens externally via Ollama/LM Studio/cloud APIs). Go was rejected because the AI/agent SDK ecosystem (Vercel AI SDK, MCP TypeScript SDK) is significantly more mature in the TypeScript world.
