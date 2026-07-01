---
tags: [adr, agents, security]
created: 2026-07-01
status: accepted
---

# ADR-0009: Sensitive Tool Calls Are Deferred and Resolved Out-of-Band

## Context

ARCHITECTURE.md sections 1 and 6 require that "Assisted" agents "must have the user confirm any security-relevant action" and that "nothing should silently gain more permissions than the user allowed." Phase 2 needed a concrete mechanism for this. The Vercel AI SDK ships a native mechanism for exactly this shape of problem — `needsApproval` on `tool()`, which pauses the step loop mid-generation and emits a `tool-approval-request` part that a client resumes later by appending a signed `tool-approval-response` part to the message history. That native mechanism was evaluated and explicitly not used for Phase 2.

## Decision

Sensitive tool calls (a skill with `sensitive: true`, or any MCP tool — every MCP tool is treated as sensitive by default since its side effects aren't declared anywhere the runtime can check) do not execute when the model calls them. Instead, `buildToolsForAgent` (`apps/server/src/tools.ts`) writes a row to a new `approval_request` table (`packages/db`) capturing everything needed to run the action later — its kind (skill/mcp), the skill id or MCP server+tool name, and the exact input — and returns a small placeholder object to the model (`{ status: "pending_approval", approvalId, message }`) so the current chat turn or automation run can finish normally. A human later calls `approvals.approve` or `approvals.reject` (tRPC), which invokes `resolveApprovalDecision` (`apps/server/src/approvals.ts`): rejection just marks the row resolved; approval actually dispatches to `skillRegistry.run()` or `mcpManager.callTool()`, records the result (or error) on the row, and writes an audit log entry either way.

The AI SDK's native `needsApproval` flow was passed over for three reasons. First, it requires persisting full structured `ModelMessage` parts (including the tool-approval-request/response parts and their HMAC signatures) and resuming a specific paused generation — a materially bigger change than Phase 2's scope, since Nyxel currently stores messages as plain `{role, content}` rows (ADR from Phase 0). Second, it's built around a live client resuming one specific in-flight generation, which doesn't map onto unattended automation runs (ADR-0010) — there's no live generation to resume hours later when a human gets around to reviewing the queue. Third, the defer-and-resolve pattern here is simple enough to reason about end-to-end and test directly (see the Phase 2 dev-log entry), without needing to model the AI SDK's approval state machine.

## Consequences

The model never learns whether a sensitive action actually succeeded within the same turn — it's told the action is queued and moves on, which means agent responses need to be honest about that uncertainty (the placeholder message says so explicitly, and every skill/MCP tool description should assume the model might see this instead of a real result). This is a reasonable trade for Phase 2's scope, but a chat-based approval experience (e.g., "approve inline, then let the agent see the outcome and keep going in the same turn") would need either the native AI SDK mechanism after all, or a second round-trip where the client resubmits a follow-up message once an approval resolves. That's tracked as a Phase 3+ improvement, not solved here. Marking every MCP tool sensitive by default is deliberately conservative — a future refinement could let MCP servers declare a permission profile (mirroring `SkillPermissions`) so genuinely read-only MCP tools don't need approval either, but nothing in the MCP spec today gives a structured place to declare that.
