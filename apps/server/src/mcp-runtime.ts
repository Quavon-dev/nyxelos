import type { McpServerRecord } from "@nyxel/db";
import { McpClientManager } from "@nyxel/mcp-client";

/** Process-wide MCP connection pool. See ARCHITECTURE.md section 8. */
export const mcpManager = new McpClientManager();

const WEB_APP_URL = process.env.WEB_ORIGIN ?? process.env.PUBLIC_APP_URL ?? "http://localhost:3000";

function buildMcpOAuthCallbackUrl(server: McpServerRecord): string {
  const url = new URL("/mcp-auth/callback", WEB_APP_URL);
  url.searchParams.set("serverId", server.id);
  url.searchParams.set("workspaceId", server.workspaceId);
  return url.toString();
}

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
    oauth:
      server.transport === "http"
        ? {
            callbackUrl: buildMcpOAuthCallbackUrl(server),
            clientName: `Nyxel · ${server.name}`,
          }
        : undefined,
  });
}

export async function completeMcpServerAuthorization(
  server: McpServerRecord,
  authorizationCode: string,
): Promise<void> {
  if (!server.enabled) throw new Error(`MCP server "${server.name}" is disabled.`);
  await mcpManager.connect({
    id: server.id,
    name: server.name,
    transport: server.transport,
    command: server.command,
    args: server.args,
    url: server.url,
    oauth:
      server.transport === "http"
        ? {
            callbackUrl: buildMcpOAuthCallbackUrl(server),
            clientName: `Nyxel · ${server.name}`,
          }
        : undefined,
  }).catch((err) => {
    // The first connect seeds config/provider state. If auth is still required,
    // completion below will exchange the returned code for tokens.
    if (err instanceof Error && err.name === "McpAuthorizationRequiredError") return;
    throw err;
  });
  await mcpManager.completeAuthorization(server.id, authorizationCode);
}
