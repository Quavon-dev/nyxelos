export interface AgentActivityStep {
	id: string;
	name: string;
	input?: unknown;
	output?: unknown;
	error?: string;
}

export interface AgentActivity {
	reasoning?: string;
	steps: AgentActivityStep[];
}

const ACTIVITY_BLOCK_TAG = "nyxel-activity";

/**
 * Embeds the model's reasoning + tool-call trail as a trailing fenced code
 * block in the persisted assistant message content, the same convention
 * chat-prompts.ts uses for ```nyxel-multiselect``` — the client's
 * chat-agent-activity.ts strips it back out to render the "thinking"/tool
 * activity UI on history reload, matching what the live stream showed.
 */
export function serializeAgentActivity(activity: AgentActivity): string {
	return `\`\`\`${ACTIVITY_BLOCK_TAG}\n${JSON.stringify(activity)}\n\`\`\``;
}

export function hasAgentActivity(activity: AgentActivity): boolean {
	return Boolean(activity.reasoning?.trim()) || activity.steps.length > 0;
}
