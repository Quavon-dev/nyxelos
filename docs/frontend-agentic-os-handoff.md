# Frontend Handoff: Agentic OS Backend Integration

## Summary

The backend now exposes durable tasks, agent runs, chat-callable management tools, richer file editing tools, and multimodal attachment preparation. The frontend should treat tasks and runs as first-class entities rather than inferring orchestration state from chat text or the audit log.

Primary backend additions:

- `tasks.list`
- `tasks.get`
- `tasks.create`
- `tasks.assign`
- `tasks.complete`
- `tasks.cancel`
- `tasks.events`
- `agentRuns.listByTask`
- `agents.create` now accepts `role` and `goalTemplate`
- `automations.runNow` now returns `{ automation, taskId, runId, output }`
- approval records now include `taskId` and `agentRunId` when applicable

## Required UI Additions

### 1. Task Board

Add a workspace-level task view with:

- columns or grouped lists by task status
- assignee filter
- priority badge
- parent/child indicator
- quick actions for assign, complete, cancel

Suggested route:

- `/workspace/[workspaceId]/tasks`

Suggested query keys:

- `["tasks", workspaceId, filters]`

### 2. Task Detail View

Add a task detail page or sheet with:

- task header: title, status, priority, assignee
- original instruction
- stored execution plan
- child tasks
- task timeline from `tasks.events`
- linked agent runs from `agentRuns.listByTask`
- final result summary and error state

Suggested route:

- `/workspace/[workspaceId]/tasks/[taskId]`

Suggested query keys:

- `["task", taskId]`
- `["taskEvents", taskId]`
- `["agentRuns", taskId]`

### 3. Agent Editor Upgrades

Extend the agents UI so it can edit:

- `role`
- `goalTemplate`
- delegate whitelist
- autonomy default hints for specialist vs orchestrator creation
- MCP tool filter if the UI is expanded later

The current create-only page should become create + edit.

### 4. Chat Affordances

When assistant replies imply backend objects were created or updated, show inline cards for:

- created agents
- created tasks
- created automations
- blocked approvals linked to a task

Minimum viable approach:

- detect object ids in structured assistant text/tool output and render lightweight cards in the message list
- link cards to the relevant agent/task/automation pages

## Attachment UX Requirements

The backend now chooses between native multimodal input and fallback extraction.

The composer and message UI should surface:

- when an image/PDF is being sent to a native multimodal model
- when fallback extraction is being used instead
- that image fallback is metadata-only on non-vision models

Recommended UI copy:

- native: `Processed natively by the selected model`
- fallback PDF: `Converted to extracted text before sending`
- fallback image: `Native vision unavailable; sent as metadata fallback`

## Approval + Resume UX

Tasks can enter `waiting_approval` or `blocked`.

Required behavior:

- show approval cards on task detail and chat timelines
- after approve/reject, invalidate:
  - `["approvals", workspaceId]`
  - `["tasks", workspaceId]`
  - `["task", taskId]`
  - `["agentRuns", taskId]`
- if approval is rejected, task should visibly move to `blocked`
- if approval is approved, task should visibly return to a resumable state

## Mutations To Wire

- create task: `trpcClient.tasks.create.mutate`
- assign task: `trpcClient.tasks.assign.mutate`
- complete task: `trpcClient.tasks.complete.mutate`
- cancel task: `trpcClient.tasks.cancel.mutate`
- list task events: `trpcClient.tasks.events.query`
- list agent runs for a task: `trpcClient.agentRuns.listByTask.query`

## MVP Delivery Order

1. Add typed client support in `apps/web/src/lib/trpc.ts` for tasks and agent runs.
2. Ship a workspace task list page with read-only status and assignee display.
3. Ship task detail with events and run trace.
4. Upgrade agents page to edit `role`, `goalTemplate`, and delegates.
5. Add inline chat cards for created tasks and automations.
6. Add attachment capability state in the composer.

## Notes

- Do not infer durable orchestration state from chat messages anymore when task/run APIs are available.
- Prefer optimistic UI only for task assignment/completion; keep task planning/execution state server-driven.
- The backend currently provides the orchestration primitives only. Rich visualizations like Gantt/timeline graphs are optional follow-up work.
