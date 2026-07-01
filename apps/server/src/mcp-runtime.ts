import type { McpServerRecord } from "@nyxel/db";
import { McpClientManager } from "@nyxel/mcp-client";

/** Process-wide MCP connection pool. See ARCHITECTURE.md section 8. */
export const mcpManager = new McpClientManager();

export async function ensureMcpServerConnected(server: McpServerRecord): Promise<void> {
  if (!server.enabled) throw new Error(`MCP server "${server.name}" is disabled.`);
  if (mcpManager.isConnected(server.id)) return;
  await mcpManager.connect({
    id: server.id,
    name: server.name,
    transport: server.transport,
    command: server.command,
    args: server.args,
    url: server.url,
  });
}
