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

const ACTIVITY_OPEN = `\`\`\`${ACTIVITY_BLOCK_TAG}\n`;
const ACTIVITY_CLOSE = "```";

/**
 * Strips the trailing ```nyxel-activity block before assistant history is
 * replayed back to the model. Anchors on the block being the last thing
 * serializeAgentActivity ever appends (via lastIndexOf + endsWith) rather
 * than matching up to the first ``` — tool outputs frequently embed their
 * own triple-backtick fences, which would otherwise misidentify the block
 * boundary. Without this, a model would see its own raw reasoning/tool-call
 * JSON (including full prior tool outputs) as conversation history and can
 * start imitating that format instead of answering.
 */
export function stripAgentActivity(content: string): string {
	const startIdx = content.lastIndexOf(ACTIVITY_OPEN);
	if (startIdx === -1 || !content.endsWith(ACTIVITY_CLOSE)) return content;
	return content.slice(0, startIdx).trim();
}
