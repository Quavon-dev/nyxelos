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

const ACTIVITY_BLOCK = /```nyxel-activity\s*\n([\s\S]*?)```/;

function isAgentActivityStep(value: unknown): value is AgentActivityStep {
	if (!value || typeof value !== "object") return false;
	const step = value as Record<string, unknown>;
	return typeof step.id === "string" && typeof step.name === "string";
}

function isAgentActivity(value: unknown): value is AgentActivity {
	if (!value || typeof value !== "object") return false;
	const activity = value as Record<string, unknown>;
	if (activity.reasoning !== undefined && typeof activity.reasoning !== "string") {
		return false;
	}
	return Array.isArray(activity.steps) && activity.steps.every(isAgentActivityStep);
}

/**
 * Assistant messages carry their reasoning/tool-call trail as a trailing
 * ```nyxel-activity fenced block (see serializeAgentActivity in
 * apps/server/src/chat-agent-activity.ts) so a reloaded chat history replays
 * the same "thinking" + tool-step UI the live stream showed, not just the
 * final text.
 */
export function parseAgentActivity(content: string): {
	activity: AgentActivity | null;
	body: string;
} {
	const match = content.match(ACTIVITY_BLOCK);
	if (!match) return { activity: null, body: content };

	try {
		const parsed = JSON.parse(match[1] ?? "");
		if (!isAgentActivity(parsed) || (!parsed.reasoning && parsed.steps.length === 0)) {
			return { activity: null, body: content };
		}
		return { activity: parsed, body: content.replace(match[0], "").trim() };
	} catch {
		return { activity: null, body: content };
	}
}
