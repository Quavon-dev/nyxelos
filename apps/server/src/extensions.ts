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
	/** GitHub repo URL of a companion plugin (see plugins.ts) installed
	 * automatically alongside this extension — its skills/sub-agents are
	 * what the extension's own agents actually use at runtime, so a bare
	 * `extension` row without it would be a shell with nothing behind it.
	 * Best-effort: a failed plugin install never blocks extension activation
	 * (see ensureExtensionPlugin), the extension just falls back to its
	 * built-in heuristics until the plugin is installed (retry from the
	 * Plugins page, or by disabling/re-enabling the extension). */
	pluginRepoUrl?: string;
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
		pluginRepoUrl: "https://github.com/AgricIDaniel/claude-seo",
	},
	{
		key: "video-studio",
		name: "Video Studio",
		description:
			"Describe a clip and generate it with Sora, then play back, edit, and organize everything it renders — every result lands in the Library too.",
		category: "Creative",
		icon: "Film",
		route: "video-studio",
	},
];

export function getExtensionCatalogEntry(
	key: string,
): ExtensionCatalogEntry | undefined {
	return EXTENSION_CATALOG.find((entry) => entry.key === key);
}
