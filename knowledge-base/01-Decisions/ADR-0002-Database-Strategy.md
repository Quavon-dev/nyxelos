---
tags: [adr, database]
created: 2026-07-01
status: accepted
---

# ADR-0002: Database and Deployment Strategy

## Context

NyxelOS must run both on a single PC with minimal setup effort and on a self-hosted server with multiple users. The requirement was PostgreSQL as a Docker container as the default, while still letting the actual choice be made during the installation process.

## Decision

Drizzle ORM as the abstraction layer, supporting both PostgreSQL and SQLite with nearly identical schema code. The web-based setup wizard asks on first launch which mode is desired: PostgreSQL in a Docker container (preset recommendation, suited for server mode and multi-user operation) or SQLite as a single file (for a minimal PC mode without Docker).

## Rationale

This satisfies both requirements: PostgreSQL as a Docker container is the default path, but installation doesn't force it — anyone who just wants to get started quickly on a PC can choose SQLite without installing Docker. Drizzle makes this dual support possible with one codebase instead of maintaining two separate data access layers.

## Consequences

Background jobs for autonomous agents cannot depend on a Redis queue, since SQLite installations typically don't ship with Redis. Instead: a custom, DB-backed job table with `cron-parser` for schedules that works on both dialects. Redis/BullMQ remains an optional add-on for server installations with heavy automation load.
