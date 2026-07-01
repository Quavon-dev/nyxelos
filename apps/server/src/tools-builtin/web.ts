import type { ToolRecord } from "@nyxel/db";
import { createSkillContext, type SkillDefinition } from "@nyxel/skills-sdk";
import { z } from "zod";
import { allowedHostsFromConfig, baseFields } from "./shared";

const GITHUB_API_HOST = "api.github.com";

async function githubJsonFetch(
	allowedHosts: string[],
	url: string,
): Promise<unknown> {
	const ctx = createSkillContext({ network: allowedHosts, filesystem: [] });
	const res = await ctx.fetch(url, {
		headers: { Accept: "application/vnd.github+json", "User-Agent": "nyxel-agentic-os" },
	});
	if (!res.ok) {
		throw new Error(`GitHub API request failed: ${res.status} ${res.statusText}`);
	}
	return res.json();
}

export function buildGithubRepoFetchTool(record: ToolRecord): SkillDefinition {
	const allowedHosts = allowedHostsFromConfig(record.config ?? {});
	const hosts = allowedHosts.length > 0 ? allowedHosts : [GITHUB_API_HOST];
	return {
		...baseFields(record),
		inputSchema: z.object({
			owner: z.string(),
			repo: z.string(),
			path: z.string().optional().describe("File/dir path within the repo; omit for repo metadata."),
			ref: z.string().optional().describe("Branch, tag, or commit SHA."),
		}),
		permissions: { network: hosts, filesystem: [] },
		async run({ owner, repo, path: filePath, ref }) {
			const base = `https://${GITHUB_API_HOST}/repos/${owner}/${repo}`;
			const url = filePath
				? `${base}/contents/${filePath}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`
				: base;
			return githubJsonFetch(hosts, url);
		},
	};
}

export function buildGithubCodeSearchTool(record: ToolRecord): SkillDefinition {
	const allowedHosts = allowedHostsFromConfig(record.config ?? {});
	const hosts = allowedHosts.length > 0 ? allowedHosts : [GITHUB_API_HOST];
	return {
		...baseFields(record),
		inputSchema: z.object({
			query: z.string().min(1),
			owner: z.string().optional(),
			repo: z.string().optional(),
		}),
		permissions: { network: hosts, filesystem: [] },
		async run({ query, owner, repo }) {
			const qualifiers = repo && owner ? ` repo:${owner}/${repo}` : "";
			const url = `https://${GITHUB_API_HOST}/search/code?q=${encodeURIComponent(query + qualifiers)}`;
			return githubJsonFetch(hosts, url);
		},
	};
}
