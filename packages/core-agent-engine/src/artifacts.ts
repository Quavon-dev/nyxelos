/**
 * Artifact types shared between the DB layer (packages/db's artifact
 * table) and producers (agent runs, tasks, workflow nodes).
 */
export type ArtifactType =
	| "text"
	| "markdown"
	| "code_patch"
	| "diff"
	| "file"
	| "report"
	| "json"
	| "image_reference"
	| "task_result"
	| "command_output";

export interface ArtifactInput {
	workspaceId: string;
	type: ArtifactType;
	title: string;
	content: string;
	taskId?: string | null;
	agentRunId?: string | null;
	agentId?: string | null;
}
