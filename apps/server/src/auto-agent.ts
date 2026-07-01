import type { AgentRecord } from "@nyxel/db";
import { getDb } from "@nyxel/db";
import { listSkillCatalogForWorkspace } from "./skills-resolve";

const AUTO_AGENT_NAME_PREFIX = "Auto assistant";

const AUTO_AGENT_SYSTEM_PROMPT = [
  "You are the workspace's automatically provisioned assistant.",
  "Use attached skills, MCP servers, and workspace instructions when they help answer or complete the task.",
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
  mcpServerIds: string[];
}> {
  const db = getDb();
  const [servers, skills] = await Promise.all([
    db.listMcpServersByWorkspace(workspaceId),
    listSkillCatalogForWorkspace(workspaceId),
  ]);

  return {
    skillIds: skills.filter((skill) => skill.enabled).map((skill) => skill.id),
    mcpServerIds: servers.filter((server) => server.enabled).map((server) => server.id),
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

  const { skillIds, mcpServerIds } = await getWorkspaceDefaultToolIds(workspaceId);
  return db.createAgent({
    workspaceId,
    name,
    systemPrompt: AUTO_AGENT_SYSTEM_PROMPT,
    modelId,
    autonomyLevel: "assisted",
    skillIds,
    mcpServerIds,
  });
}

export async function resolveAgentRuntimeConfig(agent: AgentRecord): Promise<AgentRecord> {
  if (!isAutoAssistant(agent)) return agent;
  const { skillIds, mcpServerIds } = await getWorkspaceDefaultToolIds(agent.workspaceId);
  return {
    ...agent,
    skillIds,
    mcpServerIds,
  };
}
