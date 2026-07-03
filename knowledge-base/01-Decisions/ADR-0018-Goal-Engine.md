---
tags: [adr, decision, agents]
created: 2026-07-03
status: accepted
---

# ADR-0018: The Goal Engine (Goal Orchestrator)

Date: 2026-07-03
Status: accepted

## Context

Goal Manager v1 (shipped earlier, `goals`/`goalMilestone`/`goalProgressEvent` tables and their tRPC router) is explicitly documented as "purely a record — no agent acts on a goal automatically." It's a checklist: a user creates a goal, adds milestones by hand, and ticks them off. Nothing connects a goal to the execution graph that already exists elsewhere in the Agentic OS — `task`/`taskEvent`, `agentRun`, `approvalRequest`, `auditLog`, `workflow`/`workflowRun`, `artifact`, `memoryEntry`. That connective layer is the difference between "a todo list" and "a truly autonomous agentic OS," and it was the single biggest structural gap in the goal system.

Two existing subsystems already look similar to what a Goal Engine needs, and it's worth being precise about how this differs from both:

- **Automations** (ADR-0010/0016) are trigger-driven: a cron schedule or file-watch event fires a fixed prompt at a fixed agent (or workflow) and records one run's outcome. There's no notion of a multi-step plan, no tree of sub-work, no "are we done yet" evaluation — an automation doesn't know what success looks like, it just runs and reports.
- **Tasks** (`agent-runtime.ts`) already have per-run planning (`planTask`'s JSON execution plan) and delegation (super-agent → child tasks), but that planning is scoped to one task's own execution, regenerated fresh every run, and discarded once the task completes. Nothing above a single task tracks whether a *goal* — potentially spanning many tasks over hours or days, resumed across many scheduler ticks — is actually progressing.

The Goal Engine sits above both: it turns one goal into a durable, monitored task tree, using the same execution primitives (tasks, agent runs, approvals, budgets) rather than inventing new ones, and it persists its own progress/blocked state across review cycles instead of re-deciding from scratch every time.

## Decision

**Additive schema only — the same tables, extended.** `task` gains nullable `goalId`/`goalMilestoneId` (`onDelete: "set null"`) — the only new foreign keys added anywhere. `goal` gains seven nullable/defaulted columns: `defaultAgentId`, `successCriteria` (JSON string array), `orchestrationEnabled` (boolean, default `false`), `nextReviewAt`, `lastReviewedAt`, `blockedReason`, `planGeneratedAt`. `GoalEventKind` gains four values (`plan_created`, `task_created`, `task_status_changed`, `review`) and `AuditActor` gains one (`goal_orchestrator`) — both additive enum extensions in Postgres (`ALTER TYPE ... ADD VALUE`, same pattern as ADR-0017's `extension` actor) and plain union extensions in SQLite. No existing column, table, or migration was touched. A Goal Manager v1 row — `orchestrationEnabled: false` by construction — behaves exactly as before; nothing about this ADR changes what already shipped.

**Opt-in, not automatic.** `orchestrationEnabled` defaults to `false` and is never flipped by `goals.create`. A goal stays a pure record until a human explicitly calls `goals.startOrchestration` (or `goals.setOrchestrationEnabled`) on it — matching this task's "safe, incremental architecture" mandate and Goal Manager v1's own documented intent ("no agent acts on a goal automatically") until the user says otherwise.

**`apps/server/src/goal-orchestrator.ts` — new code, no runtime rewrite.** Same placement decision ADR-0017 made for the permission taxonomy: new code alongside `agent-runtime.ts`/`scheduler.ts`/`approvals.ts`, not a risky move or rewrite of any of them. `runGoalOrchestration(goalId, { trigger })` is the whole engine, and it does exactly four things on every call, all idempotent:

1. **Plan once.** If `planGeneratedAt` is unset, calls a `GoalPlanner` (default: a one-shot JSON-only `streamChat` call against the workspace's default model, same `extractJsonObject` pattern `agent-runtime.ts`'s `planTask` already uses for per-task plans — falls back to a single-milestone/single-task plan if no model is configured or the call fails, so a goal is always plannable) and materializes the result as real `goalMilestone` + `task` rows linked via the new `goalId`/`goalMilestoneId` columns. `planGeneratedAt` being set is the only guard — a goal is never re-planned by a later review.
2. **Assign a suitable agent.** `goal.defaultAgentId` wins if the user set one (and belongs to the same workspace — a cross-workspace id is never honored, see Safety below). Otherwise: agents have no structured capability taxonomy today, so "suitable" is a documented, honest approximation — exclude `autonomyLevel: "chat"` agents (not built to run unattended) and keyword-match the goal's title/description against each remaining candidate's `role`/`goalTemplate` text. No agent found is treated as a real blocker, never as a reason to run a task unassigned.
3. **Drive progress.** Every task with `status: "ready"` that hasn't started gets `startTaskExecutionIfIdle` — the *exact same* entry point `tasks.create`, `delegation.ts`, and `workflow-runner.ts`'s agent node already use. The orchestrator has no execution path of its own. A milestone flips to `completed` the moment every task under it is. The goal flips to `completed` the moment every generated task is.
4. **Reflect blockers, never resolve them.** If any task is `waiting_approval`, `blocked` (question-pause or budget-pause), `failed`, or `pending` with no agent assigned, the goal becomes `blocked` with a human-readable `blockedReason` (a light heuristic on `task.errorMessage` distinguishes "budget exceeded" / "looks like missing credentials" / generic — documented as a best-effort classification, not a guarantee, since no structured error-taxonomy exists yet). When every blocker clears, the goal returns to `active` on the next review. The orchestrator never creates, approves, or rejects an approval; never edits an `AutonomyBudget`; never marks a task complete itself.

Every branch of this — plan created, task created, goal blocked, goal unblocked, goal completed, and every no-op review — writes both a `goalProgressEvent` (the goal's own timeline, shown on the goal detail page) and an `auditLog` row with `actor: "goal_orchestrator"` (the workspace-wide audit log). Two independent, cross-checkable trails for every automatic decision, satisfying this task's traceability requirement without inventing a third logging mechanism.

**Scheduler hook, same pattern as everything else in `scheduler.ts`.** `checkGoalsForReview()` mirrors `checkDueSeoProjects()` exactly: query `listGoalsDueForReview(now)` (opted-in, `active`/`blocked` status, `nextReviewAt` due), review each with per-goal error isolation via `reviewDueGoals`, called from inside the existing 30s poll loop. No new timer, no new job-registration system — the poll loop already exists and already runs three independent due-checks per tick; this is a fourth.

**tRPC surface — additive procedures on the existing `goals` router.** `overview` (the goal-detail read model: goal + milestones + tasks + latest agent run + blockers + a computed "next action" string + the progress-event timeline), `startOrchestration`, `setOrchestrationEnabled`, and `update` (title/description/priority/defaultAgentId/successCriteria — the fields `updateGoalStatus` deliberately doesn't cover). Every new procedure follows the router's existing `protectedProcedure` + `requireEntityWorkspaceOwner(ctx.user.id, () => db.getGoal(...))` pattern byte-for-byte — no new auth primitive was introduced.

**UI — one new page, no design rewrite.** `/workspace/[id]/goals/[goalId]` shows status, an orchestration on/off switch, next action, blockers (linking to the blocking task), milestones with their tasks, the latest agent run, and the progress timeline — reusing the existing `Card`/`Badge`/`Switch` components and the exact status-badge-color conventions the goals list and task detail pages already use. The goals list page gained a title link into the new detail page and an "Orchestration on" badge; nothing else on it changed.

## Safety

- **No destructive execution path of its own.** The orchestrator's only way to make anything happen is `startTaskExecutionIfIdle` — the same choke point every other trigger (chat, automation, delegation, workflow) already goes through, which already enforces `ALWAYS_REQUIRES_APPROVAL_KINDS` (ADR-0017) and per-tool approval gating (`tools.ts`) regardless of who called it.
- **AutonomyBudget is untouched.** The orchestrator reads nothing from and writes nothing to `agent.autonomyBudget`; a goal-generated task is bound by its assigned agent's existing budget exactly as if a human had created that task by hand.
- **Cross-workspace isolation.** `selectAgentForGoal` checks `agent.workspaceId === goal.workspaceId` before ever honoring a `defaultAgentId`; every generated task inherits `goal.workspaceId` directly (never a client-supplied value); every new tRPC procedure enforces workspace ownership the same way the rest of the router does. Verified by a dedicated test (see below).
- **Pauses are real pauses.** `waiting_approval`, budget-exceeded, and missing-agent states all surface as a blocked goal with a specific reason — never silently retried, never bypassed.

## Testing

`apps/server/src/goal-orchestrator.test.ts`, backed by a new hermetic DB-test harness (`packages/db/src/test-utils.ts` — a temp-file SQLite database with real migrations applied, installed as the process-wide `getDb()` singleton via a new test-only `__setDbForTesting` escape hatch in `client.ts`, since most of this codebase reaches the DB through that module-level singleton rather than dependency injection). Covers: goal creation → milestone/task tree with agent assignment and dual traceability trails; a goal blocked on a `waiting_approval` task and on "no suitable agent"; a goal auto-completed once every task finishes (with automatic milestone completion); cross-workspace agent assignment being refused; and `reviewDueGoals` picking up only goals that are actually due. The default planner is injectable (`GoalPlanner`) specifically so these tests never make a real model call.

## Consequences

- A goal is now a real orchestration unit, not just a checklist — but only for goals a human explicitly turns orchestration on for. Every Goal Manager v1 goal that existed before this ADR keeps behaving exactly as documented.
- Agent selection is a documented, honest v1 approximation (chat-exclusion + keyword match), not a real capability-matching system. If/when agents gain a structured capability taxonomy, `selectAgentForGoal` is the one place to upgrade — nothing else in the Goal Engine depends on the current heuristic's specifics.
- "Missing credentials" detection is a string-heuristic over `task.errorMessage`, not a structured signal — same honest limitation. A future ADR introducing typed task failure reasons would let this become exact.
- Success criteria today just means "every generated task completed" — the model-authored `successCriteria` list is stored and surfaced on the goal detail page, but nothing yet re-checks it against actual task output (e.g., an LLM-judged "does this artifact satisfy criterion X"). That's a natural next increment, deliberately not bundled into this first pass.
- Workflow runs and artifacts are surfaced for visibility (the goal overview includes the latest agent run; artifacts remain independently browsable per-task as before) but aren't yet a first-class input to the orchestrator's own completion/blocking logic — v1 tasks generated by the orchestrator are always agent tasks, never workflow-node tasks. Wiring `run_workflow`-style generated tasks into a goal's plan is future work, same "explicit non-goal, deserves its own ADR" posture ADR-0016 took for multi-level delegation.
- `packages/db/src/test-utils.ts` and the `__setDbForTesting` escape hatch are new, reusable infrastructure — this is the first DB-backed test in the codebase (everything before this tested pure functions or auth-rejection short-circuits only); future work that needs real DB behavior under test now has a pattern to follow instead of inventing its own.
