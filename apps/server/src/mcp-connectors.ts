export interface McpConnectorCatalogEntry {
	/** Stable key used to match an existing configured server back to its catalog entry. */
	key: string;
	name: string;
	description: string;
	category: string;
	/** Remote Streamable HTTP MCP endpoint, as published by the provider. */
	url: string;
}

// Verified, officially published remote MCP endpoints. "Connectors" is just
// Anthropic/OpenAI's product name for a remote MCP server — connecting one
// here creates a normal http-transport McpServerRecord, same as a custom one.
//
// Only providers whose remote MCP server supports OAuth 2.1 dynamic client
// registration (RFC 7591) are listed here — our OAuth flow (mcp-client's
// InMemoryMcpOAuthProvider) registers a client on the fly and has no slot for
// a pre-issued client_id/secret. GitHub, Atlassian, Box, Close, and Plaid
// require a pre-registered client and fail with "does not support dynamic
// client registration"; HubSpot and Zapier are API-key-only (no OAuth
// challenge at all). All of those belong in "Add custom connector" instead,
// once this app grows a way to store a static client_id/secret or API key.
export const MCP_CONNECTOR_CATALOG: McpConnectorCatalogEntry[] = [
	{
		key: "notion",
		name: "Notion",
		description: "Pages, databases, and docs.",
		category: "Productivity",
		url: "https://mcp.notion.com/mcp",
	},
	{
		key: "linear",
		name: "Linear",
		description: "Issues, projects, and cycles.",
		category: "Developer tools",
		url: "https://mcp.linear.app/mcp",
	},
	{
		key: "asana",
		name: "Asana",
		description: "Tasks and project tracking.",
		category: "Productivity",
		url: "https://mcp.asana.com/sse",
	},
	{
		key: "stripe",
		name: "Stripe",
		description: "Payments, customers, and invoices.",
		category: "Finance",
		url: "https://mcp.stripe.com/",
	},
	{
		key: "sentry",
		name: "Sentry",
		description: "Errors, issues, and performance traces.",
		category: "Developer tools",
		url: "https://mcp.sentry.dev/mcp",
	},
	{
		key: "cloudflare",
		name: "Cloudflare",
		description: "Workers, KV, and bindings.",
		category: "Developer tools",
		url: "https://bindings.mcp.cloudflare.com/sse",
	},
	{
		key: "vercel",
		name: "Vercel",
		description: "Deployments and project config.",
		category: "Developer tools",
		url: "https://mcp.vercel.com/",
	},
	{
		key: "supabase",
		name: "Supabase",
		description: "Postgres, auth, and storage.",
		category: "Developer tools",
		url: "https://mcp.supabase.com/mcp",
	},
	{
		key: "webflow",
		name: "Webflow",
		description: "Sites, CMS collections, and pages.",
		category: "Design",
		url: "https://mcp.webflow.com/sse",
	},
	{
		key: "intercom",
		name: "Intercom",
		description: "Conversations and customer support.",
		category: "Support",
		url: "https://mcp.intercom.com/sse",
	},
	{
		key: "paypal",
		name: "PayPal",
		description: "Payments and transactions.",
		category: "Finance",
		url: "https://mcp.paypal.com/sse",
	},
	{
		key: "canva",
		name: "Canva",
		description: "Designs, templates, and exports.",
		category: "Design",
		url: "https://mcp.canva.com/mcp",
	},
];
