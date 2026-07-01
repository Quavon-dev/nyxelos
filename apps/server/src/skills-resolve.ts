import type { SkillDefinition } from "@nyxel/skills-sdk";
import { skillRegistry } from "./skills-registry";

export interface SkillCatalogEntry {
	id: string;
	name: string;
	description: string;
	permissions: { network: string[]; filesystem: string[] };
	sensitive: boolean;
	enabled: boolean;
	/** Runtime skills are process-wide, hand-written (skills-registry.ts). */
	source: "builtin";
}

/**
 * The full runtime-skill catalog a workspace can choose from: the process-wide
 * hand-written skills in `packages/skills-sdk`.
 */
export async function listSkillCatalog(): Promise<SkillCatalogEntry[]> {
	return skillRegistry.list().map((skill) => ({
		id: skill.id,
		name: skill.name,
		description: skill.description,
		permissions: skill.permissions,
		sensitive: skill.sensitive,
		enabled: true,
		source: "builtin",
	}));
}

/**
 * Resolves one skill id to a runnable SkillDefinition from the static registry.
 */
export function resolveSkillDefinition(
	skillId: string,
): SkillDefinition | null {
	return skillRegistry.get(skillId) ?? null;
}
