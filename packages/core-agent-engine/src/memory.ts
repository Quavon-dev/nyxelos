/**
 * Memory types shared between the DB layer (packages/db's memory_entry
 * table) and callers that write/read memory (apps/server). Kept here
 * rather than duplicated so the type an agent-run writer constructs and
 * the type a memory-management UI reads are provably the same shape.
 */
export type MemoryType =
	| "user_preference"
	| "workspace_fact"
	| "project_decision"
	| "agent_observation"
	| "task_summary"
	| "file_summary"
	| "repo_summary"
	| "long_term_note";

export type MemorySource = "user" | "agent" | "automation" | "system";

export interface MemoryEntryInput {
	workspaceId: string;
	type: MemoryType;
	content: string;
	source: MemorySource;
	confidence: number; // 0-1
	createdByAgentId?: string | null;
	expiresAt?: Date | null;
}
