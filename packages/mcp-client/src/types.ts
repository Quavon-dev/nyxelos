export type McpTransportKind = "stdio" | "http";

/** Everything InMemoryMcpOAuthProvider holds that's worth surviving a
 * restart. Opaque to callers — persist and hand back verbatim. */
export interface McpOAuthProviderState {
	clientInfo?: unknown;
	tokens?: unknown;
	codeVerifier?: string;
	discoveryState?: unknown;
}

export interface McpOAuthConfig {
	callbackUrl: string;
	clientName?: string;
	clientMetadataUrl?: string;
	/** Rehydrates the OAuth provider from a previously-persisted state
	 * instead of starting a fresh session (dynamic client registration +
	 * full re-authorization) on every process restart. */
	initialState?: McpOAuthProviderState;
	/** Called every time the provider's state changes (new client
	 * registration, new/refreshed tokens, PKCE verifier) so the caller can
	 * persist it. */
	onStateChange?: (state: McpOAuthProviderState) => void;
}

/** Matches packages/db's McpServerRecord shape closely on purpose — this is
 * what a persisted mcp_server row gets turned into before connecting. */
export interface McpServerConfig {
	id: string;
	name: string;
	transport: McpTransportKind;
	command?: string | null;
	args?: string[] | null;
	url?: string | null;
	/** Extra env vars merged into the spawned process's environment. stdio only. */
	env?: Record<string, string> | null;
	oauth?: McpOAuthConfig;
}

export interface McpToolSummary {
	serverId: string;
	serverName: string;
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
}

export class McpAuthorizationRequiredError extends Error {
	readonly authorizationUrl: string;
	readonly callbackUrl: string;

	constructor(input: {
		serverName: string;
		authorizationUrl: string;
		callbackUrl: string;
	}) {
		super(
			`MCP server "${input.serverName}" requires sign-in before Nyxel can use it.`,
		);
		this.name = "McpAuthorizationRequiredError";
		this.authorizationUrl = input.authorizationUrl;
		this.callbackUrl = input.callbackUrl;
	}
}

export class McpInvalidConfigurationError extends Error {
	constructor(input: { serverName: string; reason: string }) {
		super(`MCP server "${input.serverName}" is misconfigured: ${input.reason}`);
		this.name = "McpInvalidConfigurationError";
	}
}
