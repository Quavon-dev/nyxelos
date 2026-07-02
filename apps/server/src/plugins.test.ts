import { afterEach, describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { getDb } from "@nyxel/db";
import {
	installPluginFromGithub,
	loadPluginSkillDefinitions,
	parseGithubRepoUrl,
	uninstallPlugin,
} from "./plugins";
import { resolveSkillDefinition } from "./skills-resolve";

const OWNER = "AgricIDaniel";
const REPO = "claude-seo";
const BRANCH = "main";

/** Mirrors the real claude-seo layout closely enough to exercise the full
 * install path: a Claude Code plugin manifest, two skills/ bundles (one with
 * a supporting script), and an agents/ sub-agent — plus a plain README that
 * isn't part of either, to prove "download everything" isn't limited to
 * skills/agents. */
const FILES: Record<string, string> = {
	".claude-plugin/plugin.json": JSON.stringify({
		name: "claude-seo",
		version: "2.2.0",
		description: "Comprehensive SEO analysis plugin for Claude Code.",
		author: { name: "AgriciDaniel", email: "agricidaniel@gmail.com" },
		homepage: "https://claude-seo.md",
	}),
	"skills/seo-technical/SKILL.md":
		"---\nname: SEO Technical\ndescription: Technical SEO audit skill.\n---\nRun the crawler and report issues.",
	"skills/seo-technical/scripts/crawl.py": "print('crawl')",
	"skills/seo-schema/SKILL.md":
		"---\nname: SEO Schema\ndescription: Schema.org markup skill.\n---\nValidate JSON-LD.",
	"agents/technical-auditor.md":
		"---\nname: Technical Auditor\ndescription: Audits technical SEO.\n---\nYou are a technical SEO auditor sub-agent.",
	"README.md": "# claude-seo\n\nSEO plugin.",
};

function installFetchMock(): typeof fetch {
	const realFetch = fetch;
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.toString();
		if (url === `https://api.github.com/repos/${OWNER}/${REPO}`) {
			return new Response(JSON.stringify({ default_branch: BRANCH }), { status: 200 });
		}
		if (url.startsWith(`https://api.github.com/repos/${OWNER}/${REPO}/git/trees/`)) {
			const tree = Object.entries(FILES).map(([path, content]) => ({
				path,
				type: "blob",
				sha: path,
				size: content.length,
			}));
			return new Response(JSON.stringify({ tree, truncated: false }), { status: 200 });
		}
		const rawPrefix = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/`;
		if (url.startsWith(rawPrefix)) {
			const relPath = decodeURIComponent(url.slice(rawPrefix.length));
			const content = FILES[relPath];
			if (content === undefined) return new Response("not found", { status: 404 });
			return new Response(content, { status: 200 });
		}
		return realFetch(input, init);
	}) as typeof fetch;
}

async function withWorkspace(): Promise<string> {
	const user = await getDb().getOrCreateDemoUser();
	const workspace = await getDb().createWorkspace({ userId: user.id, name: "plugins-test" });
	return workspace.id;
}

describe("parseGithubRepoUrl", () => {
	it("parses plain https URLs", () => {
		expect(parseGithubRepoUrl("https://github.com/AgricIDaniel/claude-seo")).toEqual({
			owner: "AgricIDaniel",
			repo: "claude-seo",
			ref: null,
		});
	});

	it("parses owner/repo shorthand and .git suffixes", () => {
		expect(parseGithubRepoUrl("AgricIDaniel/claude-seo")).toEqual({
			owner: "AgricIDaniel",
			repo: "claude-seo",
			ref: null,
		});
		expect(parseGithubRepoUrl("https://github.com/AgricIDaniel/claude-seo.git")).toEqual({
			owner: "AgricIDaniel",
			repo: "claude-seo",
			ref: null,
		});
	});

	it("captures an explicit ref from a /tree/<ref> URL", () => {
		expect(parseGithubRepoUrl("https://github.com/AgricIDaniel/claude-seo/tree/v2")).toEqual({
			owner: "AgricIDaniel",
			repo: "claude-seo",
			ref: "v2",
		});
	});

	it("rejects non-GitHub input", () => {
		expect(parseGithubRepoUrl("not a url")).toBeNull();
		expect(parseGithubRepoUrl("https://gitlab.com/a/b")).toBeNull();
	});
});

describe("installPluginFromGithub", () => {
	const installedPluginIds: string[] = [];

	afterEach(async () => {
		while (installedPluginIds.length > 0) {
			const id = installedPluginIds.pop();
			if (id) await uninstallPlugin(id);
		}
	});

	it("downloads every file, registers skills/agents, and is queryable", async () => {
		const workspaceId = await withWorkspace();
		const originalFetch = globalThis.fetch;
		globalThis.fetch = installFetchMock();
		let result: Awaited<ReturnType<typeof installPluginFromGithub>>;
		try {
			result = await installPluginFromGithub({
				workspaceId,
				repoUrl: `https://github.com/${OWNER}/${REPO}`,
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
		installedPluginIds.push(result.plugin.id);

		expect(result.plugin.name).toBe("claude-seo");
		expect(result.plugin.slug).toBe("claude-seo");
		expect(result.plugin.version).toBe("2.2.0");
		expect(result.plugin.author).toBe("AgriciDaniel");
		expect(result.plugin.fileCount).toBe(Object.keys(FILES).length);
		expect(result.skippedFiles).toEqual([]);
		expect(result.plugin.agentDefs).toEqual([
			{
				slug: "technical-auditor",
				name: "Technical Auditor",
				description: "Audits technical SEO.",
				body: "You are a technical SEO auditor sub-agent.",
			},
		]);

		const skillIds = result.skills.map((s) => s.id).sort();
		expect(skillIds).toEqual(
			[
				"file_skill_bundle__claude-seo__seo-schema",
				"file_skill_bundle__claude-seo__seo-technical",
			].sort(),
		);

		const technical = result.skills.find((s) => s.id.endsWith("seo-technical"));
		expect(technical?.name).toBe("SEO Technical");
		const body = await technical?.run({}, undefined as never);
		expect(body).toContain("Run the crawler and report issues.");
		expect(body).toContain("scripts/crawl.py");

		// Resolvable through the same path chat/automation tool-building uses.
		const resolved = await resolveSkillDefinition(
			workspaceId,
			"file_skill_bundle__claude-seo__seo-schema",
		);
		expect(resolved?.name).toBe("SEO Schema");

		const definitions = await loadPluginSkillDefinitions(result.plugin);
		expect(definitions.map((d) => d.id).sort()).toEqual(skillIds);
	});

	it("reinstalling the same repo replaces the previous install", async () => {
		const workspaceId = await withWorkspace();
		const originalFetch = globalThis.fetch;
		globalThis.fetch = installFetchMock();
		let first: Awaited<ReturnType<typeof installPluginFromGithub>>;
		let second: Awaited<ReturnType<typeof installPluginFromGithub>>;
		try {
			first = await installPluginFromGithub({
				workspaceId,
				repoUrl: `https://github.com/${OWNER}/${REPO}`,
			});
			second = await installPluginFromGithub({
				workspaceId,
				repoUrl: `https://github.com/${OWNER}/${REPO}`,
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
		installedPluginIds.push(second.plugin.id);

		expect(second.plugin.id).not.toBe(first.plugin.id);
		const remaining = await getDb().listPluginsByWorkspace(workspaceId);
		expect(remaining.map((p) => p.id)).toEqual([second.plugin.id]);
	});

	it("uninstall removes both the DB row and the downloaded files", async () => {
		const workspaceId = await withWorkspace();
		const originalFetch = globalThis.fetch;
		globalThis.fetch = installFetchMock();
		let result: Awaited<ReturnType<typeof installPluginFromGithub>>;
		try {
			result = await installPluginFromGithub({
				workspaceId,
				repoUrl: `https://github.com/${OWNER}/${REPO}`,
			});
		} finally {
			globalThis.fetch = originalFetch;
		}

		await uninstallPlugin(result.plugin.id);
		expect(await getDb().getPlugin(result.plugin.id)).toBeNull();
		await expect(rm(result.plugin.installDir, { recursive: false })).rejects.toThrow();
	});

	it("rejects a non-GitHub repo URL", async () => {
		const workspaceId = await withWorkspace();
		await expect(installPluginFromGithub({ workspaceId, repoUrl: "not a url" })).rejects.toThrow(
			/doesn't look like a GitHub repo URL/,
		);
	});
});
