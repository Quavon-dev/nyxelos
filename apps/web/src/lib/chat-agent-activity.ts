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

const ACTIVITY_OPEN = "```nyxel-activity\n";
const ACTIVITY_CLOSE = "```";

/**
 * Locates the trailing ```nyxel-activity block by anchoring on it being the
 * last thing serializeAgentActivity ever appends, rather than regex-matching
 * up to the first ``` — tool outputs/reasoning routinely embed their own
 * triple-backtick fences (e.g. a file read returning markdown with ```bash
 * blocks), which would otherwise truncate the JSON capture and make
 * JSON.parse throw, silently leaking the raw block to the user.
 */
function splitAgentActivityBlock(
	content: string,
): { json: string; body: string } | null {
	const startIdx = content.lastIndexOf(ACTIVITY_OPEN);
	if (startIdx === -1 || !content.endsWith(ACTIVITY_CLOSE)) return null;
	const jsonStart = startIdx + ACTIVITY_OPEN.length;
	const jsonEnd = content.length - ACTIVITY_CLOSE.length;
	if (jsonEnd <= jsonStart) return null;
	return {
		json: content.slice(jsonStart, jsonEnd).replace(/\n$/, ""),
		body: content.slice(0, startIdx).trim(),
	};
}

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
	const split = splitAgentActivityBlock(content);
	if (!split) return { activity: null, body: content };

	try {
		const parsed = JSON.parse(split.json);
		if (!isAgentActivity(parsed) || (!parsed.reasoning && parsed.steps.length === 0)) {
			return { activity: null, body: content };
		}
		return { activity: parsed, body: split.body };
	} catch {
		return { activity: null, body: content };
	}
}
