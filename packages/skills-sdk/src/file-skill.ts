import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { SkillDefinition } from "./types";

/**
 * Real, file-based skills — a markdown file with simple frontmatter, matching
 * Anthropic's Agent Skills format: calling the skill just returns its body
 * text (the instructions) for the model to follow using its other tools,
 * rather than performing an action itself. Always read-only, always enabled.
 *
 * Frontmatter is hand-parsed (not a YAML dependency — see the plan doc):
 * only flat `key: value` lines between a leading and trailing `---` line are
 * supported, which is all `name`/`description` need.
 */
export interface ParsedFileSkill {
	name: string;
	description: string;
	body: string;
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseSkillMarkdown(raw: string): ParsedFileSkill {
	const match = FRONTMATTER_PATTERN.exec(raw);
	if (!match) {
		return { name: "", description: "", body: raw.trim() };
	}
	const [, frontmatterBlock, body] = match;
	const frontmatter: Record<string, string> = {};
	for (const line of (frontmatterBlock ?? "").split("\n")) {
		const separatorIndex = line.indexOf(":");
		if (separatorIndex === -1) continue;
		const key = line.slice(0, separatorIndex).trim();
		const value = line.slice(separatorIndex + 1).trim();
		if (key) frontmatter[key] = value;
	}
	return {
		name: frontmatter.name ?? "",
		description: frontmatter.description ?? "",
		body: (body ?? "").trim(),
	};
}

export function serializeSkillMarkdown(input: ParsedFileSkill): string {
	return `---\nname: ${input.name}\ndescription: ${input.description}\n---\n${input.body}\n`;
}

function slugToId(slug: string): string {
	return `file_skill__${slug}`;
}

export function loadFileSkill(filePath: string, slug: string): Promise<SkillDefinition> {
	return readFile(filePath, "utf-8").then((raw) => {
		const parsed = parseSkillMarkdown(raw);
		return {
			id: slugToId(slug),
			name: parsed.name || slug,
			description: parsed.description || `Custom skill: ${slug}`,
			inputSchema: z.object({}),
			permissions: { network: [], filesystem: [] },
			sensitive: false,
			async run() {
				return parsed.body;
			},
		};
	});
}

/** Scans `dir` for `*.md` files (flat, one skill per file — no
 * folder-with-supporting-files bundles yet, see the plan doc) and builds a
 * SkillDefinition per file. Returns `[]` rather than throwing if `dir`
 * doesn't exist yet (a workspace with no custom skills is the common case). */
export async function loadFileSkillsFromDir(dir: string): Promise<SkillDefinition[]> {
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return [];
	}
	const mdFiles = entries.filter((name) => name.endsWith(".md"));
	return Promise.all(
		mdFiles.map((name) => loadFileSkill(path.join(dir, name), name.replace(/\.md$/, ""))),
	);
}
