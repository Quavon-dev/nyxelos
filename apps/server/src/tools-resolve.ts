import { getDb, type ToolKind } from "@nyxel/db";
import type { SkillDefinition } from "@nyxel/skills-sdk";
import { buildDynamicToolDefinition } from "./tools-dynamic";

export interface ToolCatalogEntry {
	id: string;
	name: string;
	description: string;
	permissions: { network: string[]; filesystem: string[] };
	sensitive: boolean;
	enabled: boolean;
	source: "workspace";
	kind: ToolKind;
}

export async function listToolCatalogForWorkspace(
	workspaceId: string,
): Promise<ToolCatalogEntry[]> {
	const rows = await getDb().listToolsByWorkspace(workspaceId);
	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		description: row.description,
		permissions: extractPermissions(row.kind, row.config),
		sensitive: row.sensitive,
		enabled: row.enabled,
		source: "workspace",
		kind: row.kind,
	}));
}

export async function resolveToolDefinition(
	workspaceId: string,
	toolId: string,
): Promise<SkillDefinition | null> {
	const record = await getDb().getTool(toolId);
	if (!record || record.workspaceId !== workspaceId || !record.enabled)
		return null;
	return buildDynamicToolDefinition(record);
}

function extractPermissions(
	kind: ToolKind,
	config: Record<string, unknown>,
): { network: string[]; filesystem: string[] } {
	const stringArray = (value: unknown): string[] =>
		Array.isArray(value)
			? value.filter((v): v is string => typeof v === "string")
			: [];
	switch (kind) {
		case "http_fetch":
			return { network: stringArray(config.allowedHosts), filesystem: [] };
		case "file_read":
		case "file_list":
		case "file_write":
		case "file_delete":
			return { network: [], filesystem: stringArray(config.allowedDirs) };
		case "custom_code":
			return {
				network: stringArray(config.allowedHosts),
				filesystem: stringArray(config.allowedDirs),
			};
		case "kb_search":
			return { network: [], filesystem: [] };
		default:
			return { network: [], filesystem: [] };
	}
}
