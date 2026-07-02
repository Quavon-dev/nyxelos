---
tags: [adr, decision]
created: 2026-07-02
---

# ADR-0016: Interlinking Agents, Workflows, and Automations

Date: 2026-07-02
Status: accepted

## Context

Two "agentic OS" subsystems had grown independently and never talked to each other:

- **Agents/tasks/automations** (Phase 2, ADR-0010/0011/0013): agents run as durable tasks, can delegate to other agents (one level, explicit whitelist), and can be scheduled by cron/file-watch automations.
- **Workflows** (later phase): a React Flow graph builder for media-generation pipelines (`text_prompt`, `image_upload`/`video_upload`, `generate_image`, `generate_video`, `edit_video`, `output`), executed breadth-first by `workflow-runner.ts`.

Neither system could reach the other: no workflow node could invoke an agent, no agent tool could run a workflow, and `automation` rows were hardcoded to a single `agentId` — a scheduled run could only ever mean "run this agent's prompt," never "run this workflow." For an "everything autonomous, everything interlinked" product pitch, this was the biggest structural gap.

## Decision

**Workflow → Agent: a new `agent` node kind.** `WorkflowNodeKind` (packages/db, both schema dialects, apps/web's `trpc.ts` mirror, and the router's `workflowNodeKindSchema`) gained `"agent"`. `workflow-runner.ts`'s `runAgentNode` creates a real `task`/`agentRun` for the selected agent (same managed-task path a delegated sub-agent uses — respects that agent's own autonomy-level tool policy) and feeds its text output downstream, same shape as every other node's `NodeOutput`. The builder UI (`node-meta.ts`, `node-inspector.tsx`, `workflow-node.tsx`) picks up the new kind automatically through the existing per-kind switch/record pattern.

**Agent → Workflow: a new `run_workflow` tool.** `workflow-tool.ts`'s `buildRunWorkflowTool` mirrors `delegation.ts`'s `buildDelegateToAgentTool` shape (a Zod enum over the workspace's workflow ids — no open-ended cross-workspace id, same boundary as the agent delegate whitelist) and is unconditionally available to every agent once the workspace has ≥1 workflow, wired into `tools.ts` next to `delegate_to_agent`. It calls a new synchronous counterpart to the existing fire-and-forget `startWorkflowRun`: `runWorkflowAndWait` runs `executeWorkflowRun` inline and returns the final run + per-node result, since a tool call needs the outcome to keep reasoning instead of polling.

**Automation → either target.** `automation` gained `targetKind` (`"agent"` | `"workflow"`, default `"agent"`) and a nullable `workflowId` alongside the now-nullable `agentId` — exactly one is set per row, matching `targetKind`. `prompt` defaults to `""` (meaningless for a workflow target). `scheduler.ts`'s `runAutomation` dispatches to `runAgentAutomation` (existing behavior, unchanged) or the new `runWorkflowAutomation`, which calls `runWorkflowAndWait` and shares the same audit-log + `lastRunAt`/`nextRunAt` bookkeeping through a `finishAutomationRun` helper. The `AUTOMATABLE_LEVELS` autonomy-level gate (ADR-0011) only applies to the agent branch — a workflow has no autonomy level to gate. The Automations page gained a "what to run" selector (agent vs workflow) that swaps the agent picker for a workflow picker and hides the prompt field for workflow targets.

Both dialects' migrations were generated with `drizzle-kit generate`. The sqlite migration's auto-generated table-rebuild had a real bug — its `INSERT INTO __new_automation(...) SELECT workflow_id, target_kind, ... FROM automation` referenced columns that don't exist on the pre-migration table; sqlite's quoted-identifier fallback silently inserted the literal strings `"workflow_id"`/`"target_kind"` into existing rows instead of erroring. Fixed by hand: the `SELECT` list only includes columns present in the old table, letting the new columns take their `DEFAULT`s. Verified against a scratch sqlite db built from the pre-migration schema.

## Consequences

- A media pipeline can now hand off mid-graph to an LLM step (caption an image, review a generated video's transcript) instead of the two systems staying siloed, and an agent can trigger a pre-built pipeline instead of trying to replicate its steps itself with individual generation tools.
- Scheduled/event-driven autonomy (cron, file-watch) now covers workflows, not just agent prompts — "regenerate this pipeline's output every morning" is a first-class automation, not a workaround.
- `run_workflow` deliberately has no approval gate of its own (matching `delegate_to_agent`): the workflow was pre-authored by the user, and each of its own steps (an `agent` node's tool calls, a `generate_image` node, etc.) already goes through its own gating internally.
- Multi-level agent delegation (A → B → C) and event-driven chaining (task/workflow completion triggering another automation) remain explicit non-goals of this change — both are real architectural decisions with cycle-safety implications (see ADR-0011's one-level restriction) that deserve their own ADR rather than being bundled in here.
