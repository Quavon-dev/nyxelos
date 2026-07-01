import type { AgentRecord } from "@nyxel/db";
import { getDb } from "@nyxel/db";
import { listSkillCatalog } from "./skills-resolve";
import { listToolCatalogForWorkspace } from "./tools-resolve";

const AUTO_AGENT_NAME_PREFIX = "Auto assistant";

const AUTO_AGENT_SYSTEM_PROMPT = [
	"You are the workspace's automatically provisioned assistant.",
	"When the user asks for implementation work, first make a short internal plan, gather the missing local context with your tools, and then execute the best next step instead of waiting for manual guidance.",
	"Use attached runtime skills, workspace tools, MCP servers, and workspace instructions when they help answer or complete the task.",
	"If you are missing essential information, ask one concise follow-up question instead of guessing.",
	"Never claim a sensitive action completed if the tool returned a pending approval result.",
	"If a tool reads local personal data such as calendar, contacts, or reminders, only use the returned data that is necessary for the user's request.",
].join(" ");

export function isAutoAssistant(agent: Pick<AgentRecord, "name">): boolean {
	return agent.name.startsWith(`${AUTO_AGENT_NAME_PREFIX} `);
}

function autoAssistantName(modelId: string): string {
	return `${AUTO_AGENT_NAME_PREFIX} (${modelId})`;
}

export async function getWorkspaceDefaultToolIds(workspaceId: string): Promise<{
	skillIds: string[];
	toolIds: string[];
	mcpServerIds: string[];
}> {
	const db = getDb();
	const [servers, skills, tools] = await Promise.all([
		db.listMcpServersByWorkspace(workspaceId),
		listSkillCatalog(workspaceId),
		listToolCatalogForWorkspace(workspaceId),
	]);

	return {
		skillIds: skills.filter((skill) => skill.enabled).map((skill) => skill.id),
		toolIds: tools.filter((tool) => tool.enabled).map((tool) => tool.id),
		mcpServerIds: servers
			.filter((server) => server.enabled)
			.map((server) => server.id),
	};
}

export async function ensureAutoAssistantForWorkspaceModel(
	workspaceId: string,
	modelId: string,
): Promise<AgentRecord> {
	const db = getDb();
	const name = autoAssistantName(modelId);
	const existing = (await db.listAgentsByWorkspace(workspaceId)).find(
		(agent) => agent.name === name,
	);
	if (existing) return existing;

	const [{ skillIds, toolIds, mcpServerIds }, workspace] = await Promise.all([
		getWorkspaceDefaultToolIds(workspaceId),
		db.getWorkspace(workspaceId),
	]);
	return db.createAgent({
		workspaceId,
		name,
		systemPrompt: AUTO_AGENT_SYSTEM_PROMPT,
		modelId,
		autonomyLevel: workspace?.defaultAutonomyLevel ?? "assisted",
		skillIds,
		toolIds,
		mcpServerIds,
	});
}

export async function resolveAgentRuntimeConfig(
	agent: AgentRecord,
): Promise<AgentRecord> {
	if (!isAutoAssistant(agent)) return agent;
	const { skillIds, toolIds, mcpServerIds } = await getWorkspaceDefaultToolIds(
		agent.workspaceId,
	);
	return {
		...agent,
		skillIds,
		toolIds,
		mcpServerIds,
	};
}
