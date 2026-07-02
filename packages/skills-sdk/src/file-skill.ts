import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
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

async function listFilesRecursive(dir: string, base: string = dir): Promise<string[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const results: string[] = [];
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...(await listFilesRecursive(fullPath, base)));
		} else {
			results.push(path.relative(base, fullPath).split(path.sep).join("/"));
		}
	}
	return results;
}

function bundleSlugToId(slug: string): string {
	return `file_skill_bundle__${slug}`;
}

/**
 * A folder-based skill bundle — `SKILL.md` plus supporting files (`scripts/`,
 * `references/`, `assets/`, ...) under the same directory, matching
 * Anthropic's full Agent Skills format (as opposed to the flat, single-file
 * skills above). `run()` still only returns text, per the file-skill design
 * — the SKILL.md body plus a manifest of the supporting files' absolute
 * paths — so the model reads them on demand with its own file tools instead
 * of the whole bundle being inlined up front. Callers are responsible for
 * placing `dirPath` somewhere those file tools can actually reach (e.g. under
 * the shared workspace root), otherwise the manifest points at paths the
 * model has no way to open.
 */
export async function loadFileSkillBundle(
	dirPath: string,
	slug: string,
): Promise<SkillDefinition> {
	const raw = await readFile(path.join(dirPath, "SKILL.md"), "utf-8");
	const parsed = parseSkillMarkdown(raw);
	const supportingFiles = (await listFilesRecursive(dirPath))
		.filter((relativePath) => relativePath !== "SKILL.md")
		.sort();
	return {
		id: bundleSlugToId(slug),
		name: parsed.name || slug,
		description: parsed.description || `Custom skill: ${slug}`,
		inputSchema: z.object({}),
		permissions: { network: [], filesystem: [dirPath] },
		sensitive: false,
		async run() {
			if (supportingFiles.length === 0) return parsed.body;
			const manifest = supportingFiles
				.map((relativePath) => `- ${path.join(dirPath, relativePath)}`)
				.join("\n");
			return `${parsed.body}\n\n---\nSupporting files for this skill (read with your file tools as needed):\n${manifest}`;
		},
	};
}

/**
 * Scans `dir` for subdirectories containing a `SKILL.md` (a folder-based
 * skill bundle) and builds a `SkillDefinition` per bundle. Complements
 * `loadFileSkillsFromDir`'s flat `*.md` scan — a directory can mix both
 * kinds. Returns `[]` rather than throwing if `dir` doesn't exist yet.
 */
export async function loadFileSkillBundlesFromDir(dir: string): Promise<SkillDefinition[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const bundles = await Promise.all(
		entries
			.filter((entry) => entry.isDirectory())
			.map(async (entry) => {
				const bundleDir = path.join(dir, entry.name);
				const skillMdExists = await stat(path.join(bundleDir, "SKILL.md"))
					.then((s) => s.isFile())
					.catch(() => false);
				if (!skillMdExists) return null;
				return loadFileSkillBundle(bundleDir, entry.name);
			}),
	);
	return bundles.filter((bundle): bundle is SkillDefinition => bundle !== null);
}
