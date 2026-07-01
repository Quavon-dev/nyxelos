import { getDb, type McpServerRecord } from "@nyxel/db";
import { McpClientManager, type McpOAuthProviderState } from "@nyxel/mcp-client";

/** Process-wide MCP connection pool. See ARCHITECTURE.md section 8. */
export const mcpManager = new McpClientManager();

const WEB_APP_URL =
	process.env.WEB_ORIGIN ??
	process.env.PUBLIC_APP_URL ??
	"http://localhost:3000";

function buildMcpOAuthCallbackUrl(server: McpServerRecord): string {
	const url = new URL("/mcp-auth/callback", WEB_APP_URL);
	url.searchParams.set("serverId", server.id);
	url.searchParams.set("workspaceId", server.workspaceId);
	return url.toString();
}

function toMcpServerConfig(server: McpServerRecord) {
	return {
		id: server.id,
		name: server.name,
		transport: server.transport,
		command: server.command,
		args: server.args,
		url: server.url,
		env: server.env,
		oauth:
			server.transport === "http"
				? {
						callbackUrl: buildMcpOAuthCallbackUrl(server),
						clientName: `Nyxel · ${server.name}`,
						// Rehydrate whatever was persisted last time so a server
						// restart doesn't force every previously-authorized
						// connector back through dynamic client registration and
						// full re-authorization. Every subsequent change (new
						// tokens, refreshed tokens, new client registration) is
						// written straight back here.
						initialState: server.oauthState ?? undefined,
						onStateChange: (state: McpOAuthProviderState) => {
							void getDb().updateMcpServerOAuthState(
								server.id,
								state as unknown as Record<string, unknown>,
							);
						},
					}
				: undefined,
	};
}

export async function ensureMcpServerConnected(
	server: McpServerRecord,
): Promise<void> {
	if (!server.enabled)
		throw new Error(`MCP server "${server.name}" is disabled.`);
	if (mcpManager.isConnected(server.id)) return;
	await mcpManager.connect(toMcpServerConfig(server));
}

export async function completeMcpServerAuthorization(
	server: McpServerRecord,
	authorizationCode: string,
): Promise<void> {
	if (!server.enabled)
		throw new Error(`MCP server "${server.name}" is disabled.`);
	mcpManager.rememberConfig(toMcpServerConfig(server));
	await mcpManager.completeAuthorization(server.id, authorizationCode);
}
