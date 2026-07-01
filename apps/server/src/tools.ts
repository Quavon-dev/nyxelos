import type { AgentRecord } from "@nyxel/db";
import { getDb } from "@nyxel/db";
import { dynamicTool, jsonSchema, type ToolSet, tool } from "ai";
import { ensureMcpServerConnected, mcpManager } from "./mcp-runtime";
import { skillRegistry } from "./skills-registry";

/**
 * Builds the AI SDK tool set an agent is allowed to call for one chat turn:
 * its assigned skills (packages/skills-sdk) plus tools from its assigned,
 * connected MCP servers (packages/mcp-client). Unknown/removed skills and
 * unreachable MCP servers are skipped rather than failing the whole chat —
 * a partially-degraded tool set is better than no response at all.
 * See ARCHITECTURE.md sections 6 and 8.
 */
export async function buildToolsForAgent(agent: AgentRecord): Promise<ToolSet> {
  const tools: ToolSet = {};

  for (const skillId of agent.skillIds) {
    const skill = skillRegistry.get(skillId);
    if (!skill) continue;
    tools[skill.id] = tool({
      description: skill.description,
      inputSchema: skill.inputSchema,
      execute: async (input) => skillRegistry.run(skill.id, input),
    });
  }

  if (agent.mcpServerIds.length === 0) return tools;

  const db = getDb();
  for (const serverId of agent.mcpServerIds) {
    const server = await db.getMcpServer(serverId);
    if (!server || !server.enabled) continue;

    try {
      await ensureMcpServerConnected(server);
    } catch (err) {
      console.error(`Skipping MCP server "${server.name}" — failed to connect:`, err);
      continue;
    }

    const mcpTools = await mcpManager.listTools(server.id);
    for (const mcpTool of mcpTools) {
      // Namespaced so identically-named tools from two servers don't collide.
      const toolKey = `${server.name}__${mcpTool.name}`;
      tools[toolKey] = dynamicTool({
        description:
          mcpTool.description ?? `Tool "${mcpTool.name}" from MCP server "${server.name}".`,
        inputSchema: jsonSchema(mcpTool.inputSchema as Parameters<typeof jsonSchema>[0]),
        execute: async (input) =>
          mcpManager.callTool(server.id, mcpTool.name, input as Record<string, unknown>),
      });
    }
  }

  return tools;
}
