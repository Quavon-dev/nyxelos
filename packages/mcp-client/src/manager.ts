import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  UnauthorizedError,
  auth as runOAuthFlow,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  McpAuthorizationRequiredError,
  McpInvalidConfigurationError,
  type McpServerConfig,
  type McpToolSummary,
} from "./types";

function parseHttpMcpUrl(config: McpServerConfig): URL {
  if (!config.url) {
    throw new McpInvalidConfigurationError({
      serverName: config.name,
      reason: "HTTP transport is missing its endpoint URL.",
    });
  }

  const trimmed = config.url.trim();
  if (trimmed.startsWith("/")) {
    if (trimmed.startsWith("/guides/")) {
      throw new McpInvalidConfigurationError({
        serverName: config.name,
        reason:
          `the configured endpoint is a documentation path (${trimmed}); use the actual MCP server URL instead, for example https://mcp.notion.com/mcp.`,
      });
    }
    throw new McpInvalidConfigurationError({
      serverName: config.name,
      reason:
        `the configured endpoint is relative (${trimmed}); HTTP MCP endpoints must be absolute URLs like https://mcp.notion.com/mcp.`,
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    try {
      parsed = new URL(`https://${trimmed}`);
    } catch {
      throw new McpInvalidConfigurationError({
        serverName: config.name,
        reason:
          `"${config.url}" is not a valid endpoint URL. Use the MCP endpoint itself, for example https://example.com/mcp, not a docs path.`,
      });
    }
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new McpInvalidConfigurationError({
      serverName: config.name,
      reason: `"${config.url}" must start with http:// or https://.`,
    });
  }

  return parsed;
}

class InMemoryMcpOAuthProvider implements OAuthClientProvider {
  private clientInfo?: OAuthClientInformationMixed;
  private savedTokens?: OAuthTokens;
  private savedCodeVerifier?: string;
  private lastAuthorizationUrl?: URL;

  constructor(
    private readonly callbackUrl: string,
    private readonly clientName: string,
    readonly clientMetadataUrl?: string,
  ) {}

  get redirectUrl(): string {
    return this.callbackUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.clientName,
      redirect_uris: [this.callbackUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.clientInfo;
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    this.clientInfo = clientInformation;
  }

  tokens(): OAuthTokens | undefined {
    return this.savedTokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.savedTokens = tokens;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.lastAuthorizationUrl = authorizationUrl;
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.savedCodeVerifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.savedCodeVerifier) {
      throw new Error("No OAuth code verifier saved for this MCP server.");
    }
    return this.savedCodeVerifier;
  }

  getAuthorizationUrl(): URL | undefined {
    return this.lastAuthorizationUrl;
  }
}

function createTransport(
  config: McpServerConfig,
  authProvider?: OAuthClientProvider,
): Transport {
  if (config.transport === "stdio") {
    if (!config.command) {
      throw new Error(`MCP server "${config.name}" is configured as stdio but has no command.`);
    }
    return new StdioClientTransport({ command: config.command, args: config.args ?? [] });
  }
  if (!config.url) {
    throw new Error(`MCP server "${config.name}" is configured as http but has no url.`);
  }
  return new StreamableHTTPClientTransport(
    parseHttpMcpUrl(config),
    authProvider ? { authProvider } : undefined,
  );
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
  private configs = new Map<string, McpServerConfig>();
  private oauthProviders = new Map<string, InMemoryMcpOAuthProvider>();

  private getOrCreateOAuthProvider(config: McpServerConfig): InMemoryMcpOAuthProvider | undefined {
    if (config.transport !== "http" || !config.oauth?.callbackUrl) return undefined;
    const existing = this.oauthProviders.get(config.id);
    if (existing) return existing;
    const provider = new InMemoryMcpOAuthProvider(
      config.oauth.callbackUrl,
      config.oauth.clientName ?? "Nyxel MCP Client",
      config.oauth.clientMetadataUrl,
    );
    this.oauthProviders.set(config.id, provider);
    return provider;
  }

  private toAuthorizationRequiredError(serverId: string, serverName: string): McpAuthorizationRequiredError {
    const provider = this.oauthProviders.get(serverId);
    const authorizationUrl = provider?.getAuthorizationUrl();
    const callbackUrl = provider?.redirectUrl;
    if (!authorizationUrl || !callbackUrl) {
      throw new Error(`MCP server "${serverName}" requires authentication, but no authorization URL was produced.`);
    }
    return new McpAuthorizationRequiredError({
      serverName,
      authorizationUrl: authorizationUrl.toString(),
      callbackUrl: String(callbackUrl),
    });
  }

  private rethrowUnauthorized(serverId: string, serverName: string, err: unknown): never {
    if (err instanceof UnauthorizedError) {
      throw this.toAuthorizationRequiredError(serverId, serverName);
    }
    throw err;
  }

  async connect(config: McpServerConfig): Promise<void> {
    if (this.servers.has(config.id)) return;
    this.configs.set(config.id, config);
    const client = new Client({ name: "nyxel", version: "0.1.0" });
    const transport = createTransport(config, this.getOrCreateOAuthProvider(config));
    try {
      await client.connect(transport);
    } catch (err) {
      this.rethrowUnauthorized(config.id, config.name, err);
    }
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

  async completeAuthorization(serverId: string, authorizationCode: string): Promise<void> {
    const config = this.configs.get(serverId);
    if (!config) {
      throw new Error(`Unknown MCP server: ${serverId}`);
    }
    if (config.transport !== "http" || !config.url) {
      throw new Error(`MCP server "${config.name}" does not use HTTP auth.`);
    }
    const provider = this.getOrCreateOAuthProvider(config);
    if (!provider) {
      throw new Error(`MCP server "${config.name}" has no OAuth provider configured.`);
    }
    await runOAuthFlow(provider, { serverUrl: config.url, authorizationCode });
    await this.disconnect(serverId);
  }

  async listTools(serverId: string): Promise<McpToolSummary[]> {
    const entry = this.servers.get(serverId);
    if (!entry) throw new Error(`Not connected to MCP server: ${serverId}`);
    let tools;
    try {
      ({ tools } = await entry.client.listTools());
    } catch (err) {
      this.rethrowUnauthorized(entry.config.id, entry.config.name, err);
    }
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
    try {
      return entry.client.callTool({ name: toolName, arguments: args });
    } catch (err) {
      this.rethrowUnauthorized(entry.config.id, entry.config.name, err);
    }
  }
}
