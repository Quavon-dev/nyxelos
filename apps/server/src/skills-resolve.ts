import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	loadFileSkill,
	parseSkillMarkdown,
	type SkillDefinition,
	serializeSkillMarkdown,
} from "@nyxel/skills-sdk";
import { skillRegistry } from "./skills-registry";

const SKILLS_ROOT = path.resolve(process.env.NYXEL_SKILLS_DIR ?? "/tmp/nyxel-skills");

function workspaceSkillsDir(workspaceId: string): string {
	return path.join(SKILLS_ROOT, workspaceId);
}

function skillFilePath(workspaceId: string, slug: string): string {
	return path.join(workspaceSkillsDir(workspaceId), `${slug}.md`);
}

function slugify(name: string): string {
	const slug = name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || `skill-${Date.now()}`;
}

export interface SkillCatalogEntry {
	id: string;
	name: string;
	description: string;
	permissions: { network: string[]; filesystem: string[] };
	sensitive: boolean;
	enabled: boolean;
	/** Runtime skills are process-wide, hand-written (skills-registry.ts).
	 * File skills are real markdown files (packages/skills-sdk/src/file-skill.ts),
	 * created/edited/deleted per workspace from the Skills page. */
	source: "builtin" | "file";
	/** Only set for `source: "file"` — the filename (no extension), needed to
	 * address update/delete. */
	slug?: string;
	/** Only set for `source: "file"` — the skill's markdown body (the
	 * instructions returned when the skill is invoked). */
	body?: string;
}

/**
 * The full runtime-skill catalog a workspace can choose from: the
 * process-wide hand-written skills in `packages/skills-sdk`, merged with
 * this workspace's own file-based skills (real `.md` files under
 * NYXEL_SKILLS_DIR/<workspaceId>/).
 */
export async function listSkillCatalog(
	workspaceId: string,
): Promise<SkillCatalogEntry[]> {
	const builtin: SkillCatalogEntry[] = skillRegistry.list().map((skill) => ({
		id: skill.id,
		name: skill.name,
		description: skill.description,
		permissions: skill.permissions,
		sensitive: skill.sensitive,
		enabled: true,
		source: "builtin",
	}));

	const fileSkills = await listFileSkillEntries(workspaceId);
	return [...builtin, ...fileSkills];
}

async function listFileSkillEntries(
	workspaceId: string,
): Promise<SkillCatalogEntry[]> {
	const dir = workspaceSkillsDir(workspaceId);
	let files: string[];
	try {
		files = (await readdir(dir)).filter((name) => name.endsWith(".md"));
	} catch {
		return [];
	}
	return Promise.all(
		files.map(async (fileName) => {
			const slug = fileName.replace(/\.md$/, "");
			const raw = await readFile(path.join(dir, fileName), "utf-8");
			const parsed = parseSkillMarkdown(raw);
			return {
				id: `file_skill__${slug}`,
				name: parsed.name || slug,
				description: parsed.description || `Custom skill: ${slug}`,
				permissions: { network: [], filesystem: [] },
				sensitive: false,
				enabled: true,
				source: "file" as const,
				slug,
				body: parsed.body,
			};
		}),
	);
}

/**
 * Resolves one skill id to a runnable SkillDefinition — checks the static
 * registry first, then this workspace's file-based skills.
 */
export async function resolveSkillDefinition(
	workspaceId: string,
	skillId: string,
): Promise<SkillDefinition | null> {
	const builtin = skillRegistry.get(skillId);
	if (builtin) return builtin;
	if (!skillId.startsWith("file_skill__")) return null;
	const slug = skillId.slice("file_skill__".length);
	try {
		return await loadFileSkill(skillFilePath(workspaceId, slug), slug);
	} catch {
		return null;
	}
}

export async function createFileSkill(input: {
	workspaceId: string;
	name: string;
	description: string;
	body: string;
}): Promise<SkillCatalogEntry> {
	const slug = slugify(input.name);
	const dir = workspaceSkillsDir(input.workspaceId);
	await mkdir(dir, { recursive: true });
	const filePath = skillFilePath(input.workspaceId, slug);
	await writeFile(
		filePath,
		serializeSkillMarkdown({ name: input.name, description: input.description, body: input.body }),
		"utf-8",
	);
	return {
		id: `file_skill__${slug}`,
		name: input.name,
		description: input.description,
		permissions: { network: [], filesystem: [] },
		sensitive: false,
		enabled: true,
		source: "file",
		slug,
		body: input.body,
	};
}

export async function updateFileSkill(input: {
	workspaceId: string;
	slug: string;
	name: string;
	description: string;
	body: string;
}): Promise<SkillCatalogEntry> {
	const filePath = skillFilePath(input.workspaceId, input.slug);
	await writeFile(
		filePath,
		serializeSkillMarkdown({ name: input.name, description: input.description, body: input.body }),
		"utf-8",
	);
	return {
		id: `file_skill__${input.slug}`,
		name: input.name,
		description: input.description,
		permissions: { network: [], filesystem: [] },
		sensitive: false,
		enabled: true,
		source: "file",
		slug: input.slug,
		body: input.body,
	};
}

export async function deleteFileSkill(input: {
	workspaceId: string;
	slug: string;
}): Promise<void> {
	await rm(skillFilePath(input.workspaceId, input.slug), { force: true });
}
