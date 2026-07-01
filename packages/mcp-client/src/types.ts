export type McpTransportKind = "stdio" | "http";

/** Matches packages/db's McpServerRecord shape closely on purpose — this is
 * what a persisted mcp_server row gets turned into before connecting. */
export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransportKind;
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
}

export interface McpToolSummary {
  serverId: string;
  serverName: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}
