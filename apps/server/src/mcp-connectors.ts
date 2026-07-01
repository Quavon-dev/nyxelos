export interface McpConnectorConfigField {
	/** Key this value is submitted under from the "Connect" dialog. */
	key: string;
	label: string;
	description?: string;
	placeholder?: string;
	/** "secret-file" writes the submitted value to a local file and points
	 * envVar at its path (for tools that only accept a credentials file path,
	 * not the file contents directly). "secret-value" sets envVar to the
	 * submitted value as-is. */
	kind: "secret-file" | "secret-value";
	envVar: string;
}

export interface McpConnectorCatalogEntry {
	/** Stable key used to match an existing configured server back to its catalog entry. */
	key: string;
	name: string;
	description: string;
	category: string;
	/** "http" (default) connects to a hosted remote MCP endpoint over OAuth.
	 * "stdio" spawns a local command on the same machine as the server
	 * process — used for connectors with no remote MCP server at all, like
	 * ones that drive a native app on this machine. */
	transport?: "http" | "stdio";
	/** Remote Streamable HTTP MCP endpoint, as published by the provider. Required when transport is "http". */
	url?: string;
	/** Local command to spawn. Required when transport is "stdio". */
	command?: string;
	args?: string[];
	/** When set, "Connect" opens a form collecting these values instead of
	 * connecting immediately — for stdio connectors whose command needs a
	 * secret (an OAuth credentials file, an API token) that has nowhere else
	 * to come from. */
	configFields?: McpConnectorConfigField[];
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
	{
		key: "airtable",
		name: "Airtable",
		description: "Bases, tables, and records.",
		category: "Database",
		url: "https://mcp.airtable.com/mcp",
	},
	{
		key: "attio",
		name: "Attio",
		description: "CRM records and workflows.",
		category: "CRM",
		url: "https://mcp.attio.com/mcp",
	},
	{
		key: "monday",
		name: "monday.com",
		description: "Boards, items, and workflows.",
		category: "Productivity",
		url: "https://mcp.monday.com/sse",
	},
	{
		key: "neon",
		name: "Neon",
		description: "Serverless Postgres branching and queries.",
		category: "Database",
		url: "https://mcp.neon.tech/mcp",
	},
	{
		key: "netlify",
		name: "Netlify",
		description: "Sites, deploys, and build config.",
		category: "Developer tools",
		url: "https://netlify-mcp.netlify.app/mcp",
	},
	{
		key: "wix",
		name: "Wix",
		description: "Sites, pages, and CMS collections.",
		category: "Design",
		url: "https://mcp.wix.com/sse",
	},
	{
		key: "square",
		name: "Square",
		description: "Payments, orders, and inventory.",
		category: "Finance",
		url: "https://mcp.squareup.com/sse",
	},
	{
		key: "prisma",
		name: "Prisma Postgres",
		description: "Managed Postgres databases and branches.",
		category: "Database",
		url: "https://mcp.prisma.io/mcp",
	},
	{
		key: "cloudflare-observability",
		name: "Cloudflare Observability",
		description: "Logs, traces, and Workers analytics.",
		category: "Developer tools",
		url: "https://observability.mcp.cloudflare.com/sse",
	},
	{
		key: "cloudinary",
		name: "Cloudinary",
		description: "Media assets, uploads, and transforms.",
		category: "Design",
		url: "https://asset-management.mcp.cloudinary.com/sse",
	},
	{
		key: "buildkite",
		name: "Buildkite",
		description: "CI pipelines and build status.",
		category: "Developer tools",
		url: "https://mcp.buildkite.com/mcp",
	},
	{
		key: "fireflies",
		name: "Fireflies",
		description: "Meeting transcripts and notes.",
		category: "Productivity",
		url: "https://api.fireflies.ai/mcp",
	},
	{
		key: "ramp",
		name: "Ramp",
		description: "Corporate cards and spend management.",
		category: "Finance",
		url: "https://ramp-mcp-remote.ramp.com/mcp",
	},
	{
		key: "huggingface",
		name: "Hugging Face",
		description: "Models, datasets, and spaces. No sign-in required.",
		category: "Developer tools",
		url: "https://hf.co/mcp",
	},
	{
		key: "exa",
		name: "Exa",
		description: "Neural web search. No sign-in required.",
		category: "Search",
		url: "https://mcp.exa.ai/mcp",
	},
	{
		key: "aws-knowledge",
		name: "AWS Knowledge",
		description: "AWS docs and API references. No sign-in required.",
		category: "Developer tools",
		url: "https://knowledge-mcp.global.api.aws",
	},
	{
		key: "semgrep",
		name: "Semgrep",
		description: "Static analysis and security scanning. No sign-in required.",
		category: "Developer tools",
		url: "https://mcp.semgrep.ai/sse",
	},
	{
		key: "google-calendar",
		name: "Google Calendar",
		description:
			"Read, create, and manage events. No hosted Google server exists for this — runs locally via @cocal/google-calendar-mcp, and needs your own Google Cloud OAuth client (Desktop app type) since Google doesn't support anonymous dynamic client registration.",
		category: "Productivity",
		transport: "stdio",
		command: "npx",
		args: ["-y", "@cocal/google-calendar-mcp"],
		configFields: [
			{
				key: "credentialsJson",
				label: "OAuth client credentials (gcp-oauth.keys.json)",
				description:
					"From Google Cloud Console → APIs & Services → Credentials → your Desktop app OAuth client → Download JSON. Paste the full file contents.",
				placeholder: '{"installed":{"client_id":"...","project_id":"...","client_secret":"..."}}',
				kind: "secret-file",
				envVar: "GOOGLE_OAUTH_CREDENTIALS",
			},
		],
	},
];
