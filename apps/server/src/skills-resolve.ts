import { getDb } from "@nyxel/db";
import type { SkillDefinition } from "@nyxel/skills-sdk";
import { buildDynamicSkillDefinition } from "./skills-dynamic";
import { skillRegistry } from "./skills-registry";

export interface SkillCatalogEntry {
  id: string;
  name: string;
  description: string;
  permissions: { network: string[]; filesystem: string[] };
  sensitive: boolean;
  enabled: boolean;
  /** "builtin" = process-wide, hand-written (skills-registry.ts); "custom" =
   * created through the workspace's Skills tab, stored in the DB. */
  source: "builtin" | "custom";
  kind?: string;
}

/**
 * The full skill catalog a workspace can choose from: the process-wide
 * hand-written skills (always available, "builtin") plus this workspace's
 * DB-backed dynamic skills ("custom"). Used by the Skills tab and the agent
 * skill picker. See ADR-0013.
 */
export async function listSkillCatalogForWorkspace(workspaceId: string): Promise<SkillCatalogEntry[]> {
  const builtins: SkillCatalogEntry[] = skillRegistry.list().map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    permissions: skill.permissions,
    sensitive: skill.sensitive,
    enabled: true,
    source: "builtin",
  }));

  const customRows = await getDb().listSkillsByWorkspace(workspaceId);
  const custom: SkillCatalogEntry[] = customRows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    permissions: extractPermissions(row.kind, row.config),
    sensitive: row.sensitive,
    enabled: row.enabled,
    source: "custom",
    kind: row.kind,
  }));

  return [...builtins, ...custom];
}

function extractPermissions(
  kind: string,
  config: Record<string, unknown>,
): { network: string[]; filesystem: string[] } {
  const stringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  switch (kind) {
    case "http_fetch":
      return { network: stringArray(config.allowedHosts), filesystem: [] };
    case "file_read":
    case "file_list":
    case "file_write":
      return { network: [], filesystem: stringArray(config.allowedDirs) };
    case "custom_code":
      return {
        network: stringArray(config.allowedHosts),
        filesystem: stringArray(config.allowedDirs),
      };
    default:
      return { network: [], filesystem: [] };
  }
}

/**
 * Resolves one skill id to a runnable SkillDefinition for a given workspace —
 * checked against the static registry first (ids like "web_fetch" are
 * process-wide and workspace-independent), then this workspace's DB-backed
 * skills. Returns null for an unknown, disabled, or cross-workspace id so
 * callers can skip it rather than fail the whole tool-building pass, mirroring
 * how unreachable MCP servers are handled in tools.ts.
 */
export async function resolveSkillDefinition(
  workspaceId: string,
  skillId: string,
): Promise<SkillDefinition | null> {
  const builtin = skillRegistry.get(skillId);
  if (builtin) return builtin;

  const record = await getDb().getSkill(skillId);
  if (!record || record.workspaceId !== workspaceId || !record.enabled) return null;
  return buildDynamicSkillDefinition(record);
}
