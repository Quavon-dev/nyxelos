---
tags: [adr, automation, scheduler]
created: 2026-07-01
status: accepted
---

# ADR-0010: Automations Are Scheduled by Polling the Database, Not a Job Queue

## Context

ARCHITECTURE.md's tech stack table already called this: "a custom DB-backed job table + `cron-parser`... lets autonomous agents run even in the simple SQLite PC mode without also running Redis." Phase 2 needed to implement time-driven autonomous agents (ARCHITECTURE.md section 6) — the "runs on a schedule... in the background" behavior for "autonomous" and "super_agent" agents. The PC-mode constraint (single process, no required external services, SQLite by default) rules out a real message queue as the only option.

## Decision

A new `automation` table (`packages/db`) stores one row per scheduled agent run: its cron expression, the prompt to send as that run's "user" turn, and `lastRunAt`/`nextRunAt` timestamps. `apps/server/src/scheduler.ts` runs a `setInterval` every 30 seconds, queries `listDueAutomations(now)` (enabled automations whose `nextRunAt <= now`), and runs each one sequentially — building its tool set (with `automationId` set instead of `chatId` in the run context, so tool calls it makes are attributable to the automation rather than a chat), calling `streamChat` headlessly (`await result.text`, no client to stream tokens to), logging one `agent_run` audit entry with the full output or error, and recomputing `nextRunAt` via `cron-parser`. A per-automation `try/catch` means one broken automation (bad agent reference, model failure, thrown error) can't take down the poll loop or block its siblings — see the Phase 2 dev-log entry, where this was exercised directly (an automation pointed at a nonexistent local model correctly logged an `error` status without crashing anything).

`computeNextRunAt` is also called from the `automations.create` and `automations.setEnabled(true)` tRPC mutations, both to validate the cron expression up front (a malformed expression is rejected at creation time, not silently ignored until the first poll) and to seed the initial `nextRunAt`.

## Consequences

Automations only ever run inside the one Nyxel server process that has this `setInterval` running — there's no distributed locking, so multi-instance server deployments would double-run every automation. That's fine for the project's stated deployment modes (a single PC process, or a single server-mode container) and matches the same "keep PC mode boring" reasoning as ADR-0002's SQLite default; if Nyxel ever needs horizontal scaling, this table becomes the natural backing store for a real queue (BullMQ, as ARCHITECTURE.md's tech-stack table already anticipates for server mode) rather than something to redesign. The 30-second poll granularity means a "every minute" automation can drift by up to 30 seconds — acceptable for the kinds of tasks this targets (calendar summaries, periodic checks), not acceptable for anything needing second-level precision, which isn't a stated requirement.
