import type { NyxelEventType } from "@nyxel/db";

/**
 * Stable event-bus v1 event names. Keep string literals in sync with
 * `nyxelEventType` (packages/db/src/schema/pg/app.ts) — the `satisfies`
 * below fails to compile if the two drift apart.
 */
export const NyxelEvent = {
	AgentRunStarted: "agent.run.started",
	AgentRunCompleted: "agent.run.completed",
	AgentRunFailed: "agent.run.failed",
	ApprovalCreated: "approval.created",
	ApprovalResolved: "approval.resolved",
	WorkflowCompleted: "workflow.completed",
	TaskFailed: "task.failed",
	LibraryFileCreated: "library.file.created",
	AutomationTriggered: "automation.triggered",
} as const satisfies Record<string, NyxelEventType>;

/** Entity kinds an event's `entityId` can point at. Free text in the DB
 * column (not an enum) — this union is documentation/call-site safety, not
 * a schema constraint. */
export type NyxelEventEntityType =
	| "agent_run"
	| "task"
	| "approval_request"
	| "workflow_run"
	| "library_file"
	| "automation";
