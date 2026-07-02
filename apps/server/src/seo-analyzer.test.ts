import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { getDb, type PluginRecord } from "@nyxel/db";
import {
	matchesCategory,
	pickBestModelIdForSeo,
	pickRelevantPluginPersonas,
	pickRelevantPluginSkills,
} from "./seo-analyzer";

async function withWorkspace(): Promise<string> {
	const user = await getDb().getOrCreateDemoUser();
	const workspace = await getDb().createWorkspace({ userId: user.id, name: "seo-test" });
	return workspace.id;
}

function fakePlugin(overrides: Partial<PluginRecord> = {}): PluginRecord {
	return {
		id: "plugin-1",
		workspaceId: "workspace-1",
		slug: "claude-seo",
		name: "claude-seo",
		description: "SEO plugin",
		version: "2.2.0",
		author: "AgriciDaniel",
		homepage: null,
		repoUrl: "https://github.com/AgricIDaniel/claude-seo",
		manifest: {},
		skillSlugs: [],
		agentDefs: [],
		fileCount: 0,
		installDir: "/tmp/does-not-exist",
		enabled: true,
		createdAt: new Date(),
		...overrides,
	};
}

describe("matchesCategory", () => {
	it("matches on category keywords, case-insensitively", () => {
		expect(matchesCategory("SEO Technical Audit skill", ["seo"])).toBe(true);
		expect(matchesCategory("Schema.org markup validator", ["geo"])).toBe(true);
		expect(matchesCategory("FAQ / answer engine skill", ["aeo"])).toBe(true);
	});

	it("returns false when nothing matches any of the given categories", () => {
		expect(matchesCategory("Unrelated productivity skill", ["seo", "geo", "aeo"])).toBe(false);
	});
});

describe("pickRelevantPluginPersonas", () => {
	it("returns only personas matching the requested categories", () => {
		const plugin = fakePlugin({
			agentDefs: [
				{ slug: "technical-auditor", name: "Technical Auditor", description: "Audits technical SEO issues", body: "..." },
				{ slug: "schema-specialist", name: "Schema Specialist", description: "Structured data / schema.org expert", body: "..." },
				{ slug: "copywriter", name: "General Copywriter", description: "Writes marketing copy", body: "..." },
			],
		});
		const personas = pickRelevantPluginPersonas(plugin, ["seo"]);
		expect(personas.map((p) => p.slug)).toEqual(["technical-auditor"]);
	});

	it("returns an empty list rather than guessing when nothing matches", () => {
		const plugin = fakePlugin({
			agentDefs: [
				{ slug: "copywriter", name: "General Copywriter", description: "Writes marketing copy", body: "..." },
			],
		});
		expect(pickRelevantPluginPersonas(plugin, ["seo", "geo", "aeo"])).toEqual([]);
	});
});

describe("pickRelevantPluginSkills", () => {
	const installDir = "/tmp/claude-0/-home-user-nyxelos/0ba69a41-21e5-57c5-b733-bc66b97b7bdb/scratchpad/seo-plugin-test";

	afterEach(async () => {
		await rm(installDir, { recursive: true, force: true });
	});

	async function writeSkill(dirName: string, name: string, description: string) {
		const dir = path.join(installDir, "skills", dirName);
		await mkdir(dir, { recursive: true });
		await writeFile(
			path.join(dir, "SKILL.md"),
			`---\nname: ${name}\ndescription: ${description}\n---\nDo the thing.`,
			"utf-8",
		);
	}

	it("picks skills whose name/description matches the requested categories", async () => {
		await writeSkill("seo-technical", "SEO Technical", "Technical SEO audit skill.");
		await writeSkill("seo-schema", "SEO Schema", "Schema.org markup skill.");
		const plugin = fakePlugin({
			installDir,
			skillSlugs: [
				"file_skill_bundle__claude-seo__seo-technical",
				"file_skill_bundle__claude-seo__seo-schema",
			],
		});

		const { skillNames } = await pickRelevantPluginSkills(plugin, ["seo"]);
		expect(skillNames).toEqual(["SEO Technical"]);
	});

	it("falls back to every skill when nothing matches, instead of using none", async () => {
		await writeSkill("unrelated-a", "Totally Unrelated A", "Nothing to do with search.");
		await writeSkill("unrelated-b", "Totally Unrelated B", "Also unrelated.");
		const plugin = fakePlugin({
			installDir,
			skillSlugs: [
				"file_skill_bundle__claude-seo__unrelated-a",
				"file_skill_bundle__claude-seo__unrelated-b",
			],
		});

		const { skillNames } = await pickRelevantPluginSkills(plugin, ["seo", "geo", "aeo"]);
		expect(skillNames.sort()).toEqual(["Totally Unrelated A", "Totally Unrelated B"]);
	});
});

describe("pickBestModelIdForSeo", () => {
	it("prefers a strong model family (opus) over cheaper/other installed models", async () => {
		const workspaceId = await withWorkspace();
		await getDb().createModelInstallation({
			workspaceId,
			label: "Test provider",
			providerKind: "openai_compatible",
			baseUrl: "http://localhost:9999",
			modelIds: ["claude-haiku-4-5-mini", "claude-sonnet-5", "claude-opus-4-8"],
		});

		const modelId = await pickBestModelIdForSeo(workspaceId, null);
		expect(modelId).toContain("opus");
	});

	it("skips obviously-cheap model variants even if listed first", async () => {
		const workspaceId = await withWorkspace();
		await getDb().createModelInstallation({
			workspaceId,
			label: "Test provider",
			providerKind: "openai_compatible",
			baseUrl: "http://localhost:9999",
			modelIds: ["gpt-5-mini", "gpt-5"],
		});

		const modelId = await pickBestModelIdForSeo(workspaceId, null);
		expect(modelId).toContain("gpt-5");
		expect(modelId).not.toContain("mini");
	});

	it("falls back to the workspace default when no installed model ranks", async () => {
		const workspaceId = await withWorkspace();
		const modelId = await pickBestModelIdForSeo(workspaceId, "some-default-model");
		expect(modelId).toBe("some-default-model");
	});

	it("throws when there is truly nothing to fall back to", async () => {
		const workspaceId = await withWorkspace();
		await expect(pickBestModelIdForSeo(workspaceId, null)).rejects.toThrow(/No models/);
	});
});
