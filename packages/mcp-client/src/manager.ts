import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerConfig, McpToolSummary } from "./types";

function createTransport(config: McpServerConfig): Transport {
  if (config.transport === "stdio") {
    if (!config.command) {
      throw new Error(`MCP server "${config.name}" is configured as stdio but has no command.`);
    }
    return new StdioClientTransport({ command: config.command, args: config.args ?? [] });
  }
  if (!config.url) {
    throw new Error(`MCP server "${config.name}" is configured as http but has no url.`);
  }
  return new StreamableHTTPClientTransport(new URL(config.url));
}

interface ConnectedServer {
  config: McpServerConfig;
  client: Client;
}

/**
 * Owns connections to configured MCP servers (ARCHITECTURE.md section 8).
 * Nyxel is a client to third-party MCP servers and, per ADR-0003, to "my
 * computer" (the macOS/Windows companion) through this exact same
 * interface — there is nothing companion-specific here, which is the point.
 */
export class McpClientManager {
  private servers = new Map<string, ConnectedServer>();

  async connect(config: McpServerConfig): Promise<void> {
    if (this.servers.has(config.id)) return;
    const client = new Client({ name: "nyxel", version: "0.1.0" });
    const transport = createTransport(config);
    await client.connect(transport);
    this.servers.set(config.id, { config, client });
  }

  async disconnect(serverId: string): Promise<void> {
    const entry = this.servers.get(serverId);
    if (!entry) return;
    await entry.client.close();
    this.servers.delete(serverId);
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([...this.servers.keys()].map((id) => this.disconnect(id)));
  }

  isConnected(serverId: string): boolean {
    return this.servers.has(serverId);
  }

  async listTools(serverId: string): Promise<McpToolSummary[]> {
    const entry = this.servers.get(serverId);
    if (!entry) throw new Error(`Not connected to MCP server: ${serverId}`);
    const { tools } = await entry.client.listTools();
    return tools.map((tool) => ({
      serverId: entry.config.id,
      serverName: entry.config.name,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
  }

  async listAllTools(): Promise<McpToolSummary[]> {
    const all = await Promise.all([...this.servers.keys()].map((id) => this.listTools(id)));
    return all.flat();
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const entry = this.servers.get(serverId);
    if (!entry) throw new Error(`Not connected to MCP server: ${serverId}`);
    return entry.client.callTool({ name: toolName, arguments: args });
  }
}
