export interface ExtensionCatalogEntry {
	/** Stable key used to match an installed extension row back to its
	 * catalog entry — never renamed once shipped, since it's stored in the
	 * `extension.key` column. */
	key: string;
	name: string;
	description: string;
	category: string;
	/** Sidebar icon name — must be a key in ICON_MAP on the web client (see
	 * apps/web/src/components/app-sidebar.tsx). */
	icon: string;
	/** Route segment under /workspace/{id}/extensions/{key} — normally equal
	 * to `key`, kept separate in case a future extension needs a nicer URL. */
	route: string;
}

// The marketplace of extensions installable from workspace settings. Mirrors
// MCP_CONNECTOR_CATALOG's shape (see mcp-connectors.ts) — "installing" an
// extension creates an `extension` row scoped to the workspace, same as
// "connecting" a catalog entry creates an `mcpServer` row.
export const EXTENSION_CATALOG: ExtensionCatalogEntry[] = [
	{
		key: "seo-analyzer",
		name: "SEO/GEO/AEO Analyzer",
		description:
			"Links a domain to a local repo, audits search/answer-engine readiness, dispatches an AI agent to fix findings, and drafts blog posts for keyword gaps.",
		category: "Growth",
		icon: "TrendingUp",
		route: "seo-analyzer",
	},
];

export function getExtensionCatalogEntry(
	key: string,
): ExtensionCatalogEntry | undefined {
	return EXTENSION_CATALOG.find((entry) => entry.key === key);
}
