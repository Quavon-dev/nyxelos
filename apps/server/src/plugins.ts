import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { getDb, type PluginAgentDefinition, type PluginRecord } from "@nyxel/db";
import { loadFileSkillBundle, parseSkillMarkdown, type SkillDefinition } from "@nyxel/skills-sdk";
import { isRemotePluginInstallEnabled } from "./feature-flags";
import { workspaceRootDir } from "./skills-registry";

/**
 * Root directory every installed plugin's files are downloaded into,
 * deliberately nested under the shared workspace root (not a separate
 * NYXEL_SKILLS_DIR-style location) so the existing workspace file tools —
 * already scoped to `workspaceRootDir` (see tools-builtin-seed.ts) — can
 * read a plugin's supporting files (scripts/, references/, pdf/, ...)
 * without any new permission wiring.
 */
const PLUGINS_ROOT = path.resolve(
	process.env.NYXEL_PLUGINS_DIR ?? path.join(workspaceRootDir, ".nyxel-plugins"),
);

function pluginInstallDir(workspaceId: string, slug: string): string {
	return path.join(PLUGINS_ROOT, workspaceId, slug);
}

function slugify(name: string): string {
	const slug = name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || `plugin-${Math.abs(hashCode(name))}`;
}

function hashCode(input: string): number {
	let hash = 0;
	for (let i = 0; i < input.length; i++) {
		hash = (hash << 5) - hash + input.charCodeAt(i);
		hash |= 0;
	}
	return hash;
}

/** Matches the GitHub repo URL forms users are likely to paste, plus the bare
 * `owner/repo` shorthand — an optional `/tree/<ref>/...` suffix pins a
 * branch/tag/commit instead of the repo's default branch. */
const GITHUB_URL_PATTERN =
	/^(?:https?:\/\/(?:www\.)?github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([\w.\-/]+))?\/?$/;

export interface ParsedGithubRepo {
	owner: string;
	repo: string;
	/** Explicit ref from a `/tree/<ref>` URL, if any — null means "use the
   * repo's default branch". */
	ref: string | null;
}

export function parseGithubRepoUrl(input: string): ParsedGithubRepo | null {
	const trimmed = input.trim().replace(/^git@github\.com:/, "github.com/");
	const match = GITHUB_URL_PATTERN.exec(trimmed);
	if (!match) return null;
	const [, owner, repo, ref] = match;
	if (!owner || !repo) return null;
	return { owner, repo, ref: ref ?? null };
}

interface GithubTreeEntry {
	path: string;
	type: "blob" | "tree" | "commit";
	sha: string;
	size?: number;
}

async function githubJson<T>(url: string): Promise<T> {
	const res = await fetch(url, {
		headers: {
			Accept: "application/vnd.github+json",
			"User-Agent": "nyxel-plugin-install",
		},
	});
	if (!res.ok) {
		throw new Error(`GitHub request failed (${res.status}): ${url}`);
	}
	return (await res.json()) as T;
}

async function resolveDefaultBranch(owner: string, repo: string): Promise<string> {
	const data = await githubJson<{ default_branch: string }>(
		`https://api.github.com/repos/${owner}/${repo}`,
	);
	return data.default_branch;
}

/** Best-effort: resolves a branch/tag/ref name to the commit SHA it currently
 * points at, so a moving ref can still be recorded ("installed from `main` at
 * commit `abc123`") even though the *next* reinstall will re-resolve it and
 * may land on a different commit. Never throws — a failure (rate limit,
 * network hiccup) just means `resolvedSha` is null and the install proceeds
 * with the ref name alone, same as before this hardening pass existed. */
async function resolveCommitSha(owner: string, repo: string, ref: string): Promise<string | null> {
	try {
		const data = await githubJson<{ sha: string }>(
			`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
		);
		return typeof data.sha === "string" ? data.sha : null;
	} catch {
		return null;
	}
}

const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

/** Branch names that move on every push — the common case users paste
 * without realizing a plugin install isn't pinned to anything. Tags are
 * conventionally-but-not-guaranteed immutable, so they're not flagged here;
 * only an exact 40-char commit SHA counts as genuinely pinned (see
 * `refPinned` below). */
function isMovingBranchName(ref: string): boolean {
	return /^(main|master|develop|dev|trunk|head)$/i.test(ref);
}

export interface PluginRiskFinding {
	/** Path (relative to the plugin's install dir) the pattern was found in. */
	file: string;
	/** Human-readable name of the risky pattern, e.g. "child_process". */
	pattern: string;
}

export interface PluginRiskSummary {
	/** Branch/tag/ref the install actually used. */
	ref: string;
	/** Best-effort-resolved commit SHA, or null if it couldn't be resolved. */
	resolvedSha: string | null;
	/** True only when the user pinned an exact commit via `/tree/<40-hex-sha>`. */
	refPinned: boolean;
	/** True when the install is not pinned to an exact commit — i.e. it will
	 * silently pick up whatever the branch/tag points to on the next
	 * reinstall (see docs/PLUGIN_SECURITY.md threat scenario 2). */
	branchWarning: boolean;
	/** True specifically when `ref` is (or defaulted to) a moving branch like
	 * `main`/`master` rather than a tag or other named ref — the case the
	 * acceptance criteria calls out as needing its own, stronger label. */
	isMovingBranch: boolean;
	/** Static-scan hits for risky code patterns (see `scanForRiskyPatterns`). */
	findings: PluginRiskFinding[];
}

/** Static Scan v1 (docs/PLUGIN_SECURITY.md stage 4). Deliberately naive
 * substring/regex matching over downloaded file contents — no AST parsing,
 * no attempt to resolve whether a match is reachable code or a comment/doc
 * example. This raises the bar against casual/careless plugins; it is not a
 * security boundary and a determined malicious author can trivially evade it
 * (string concatenation, indirection, obfuscation). Never treat a clean scan
 * as "safe" — only as "nothing obvious found". */
const RISK_PATTERNS: { pattern: string; regex: RegExp }[] = [
	{ pattern: "process.env", regex: /process\.env/ },
	{ pattern: "child_process", regex: /\bchild_process\b/ },
	{ pattern: "fs.rm / fs.unlink", regex: /\bfs\.(?:rm|unlink)\b/ },
	{ pattern: "fetch(...) (allowlist not verifiable statically)", regex: /\bfetch\s*\(/ },
	{ pattern: "Bun.spawn", regex: /\bBun\.spawn\b/ },
	{ pattern: "eval(...) / new Function(...)", regex: /\beval\s*\(|\bnew\s+Function\s*\(/ },
];

/** Skipped outright — binary/asset formats a naive utf-8 regex scan can't
 * usefully inspect and that would just waste CPU decoding. Anything else
 * downloaded is scanned, including files with no extension. */
const SCAN_SKIP_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".ico",
	".svg",
	".woff",
	".woff2",
	".ttf",
	".eot",
	".pdf",
	".zip",
	".tar",
	".gz",
	".mp3",
	".mp4",
	".wasm",
	".db",
	".sqlite",
]);

/** Bound on how much of a single file is scanned — a resource backstop like
 * `MAX_FILE_BYTES`, not a curation choice; risky patterns in practice show up
 * near the top of a script, not buried past a few hundred KB. */
const MAX_SCAN_BYTES = 2 * 1024 * 1024;

function scanForRiskyPatterns(entryPath: string, buf: ArrayBuffer): PluginRiskFinding[] {
	if (SCAN_SKIP_EXTENSIONS.has(path.extname(entryPath).toLowerCase())) return [];
	if (buf.byteLength > MAX_SCAN_BYTES) return [];
	const text = Buffer.from(buf).toString("utf-8");
	const findings: PluginRiskFinding[] = [];
	for (const { pattern, regex } of RISK_PATTERNS) {
		if (regex.test(text)) findings.push({ file: entryPath, pattern });
	}
	return findings;
}

/** Thrown by `installPluginFromGithub` when the static scan (stage 4) finds
 * risky patterns and the caller hasn't set `acknowledgeRisk: true`. This is
 * deliberately not a silent block (docs/PLUGIN_SECURITY.md stage 4's
 * acceptance criterion): the install is aborted, nothing is written to the
 * DB or left staged on disk, and the caller is expected to show
 * `riskSummary` to the user and retry with explicit acknowledgement. */
export class PluginInstallNeedsConfirmationError extends Error {
	riskSummary: PluginRiskSummary;
	constructor(riskSummary: PluginRiskSummary) {
		super(
			`This plugin has ${riskSummary.findings.length} risky code pattern(s) flagged by the static scan and needs explicit confirmation before installing.`,
		);
		this.name = "PluginInstallNeedsConfirmationError";
		this.riskSummary = riskSummary;
	}
}

async function fetchRepoTree(owner: string, repo: string, ref: string): Promise<GithubTreeEntry[]> {
	const data = await githubJson<{ tree: GithubTreeEntry[]; truncated: boolean }>(
		`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
	);
	if (data.truncated) {
		throw new Error(
			`Repository tree for ${owner}/${repo}@${ref} is too large to list in one request (GitHub truncated it).`,
		);
	}
	return data.tree;
}

/** Files larger than this are skipped rather than downloaded, as a resource
 * backstop — not a curation choice. Skipped paths are reported back to the
 * caller so nothing silently goes missing. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const DOWNLOAD_CONCURRENCY = 8;

async function downloadFile(
	owner: string,
	repo: string,
	ref: string,
	entryPath: string,
): Promise<ArrayBuffer> {
	const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${entryPath
		.split("/")
		.map(encodeURIComponent)
		.join("/")}`;
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`Failed to download ${entryPath} (${res.status})`);
	}
	return res.arrayBuffer();
}

async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let cursor = 0;
	async function worker() {
		while (cursor < items.length) {
			const index = cursor++;
			// biome-ignore lint/style/noNonNullAssertion: index is in bounds by construction
			results[index] = await fn(items[index]!);
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
	return results;
}

interface ParsedManifest {
	name: string;
	description: string;
	version: string | null;
	author: string | null;
	homepage: string | null;
	raw: Record<string, unknown>;
}

/** Claude Code's `.claude-plugin/plugin.json` format — `author` may be a
 * string or `{ name, email, url }`. Repos that ship skills/agents without a
 * manifest ("other Plugins", not just the Claude Code format) fall back to
 * the repo name and a generic description instead of failing the install. */
function parseManifest(raw: Record<string, unknown>, fallbackName: string): ParsedManifest {
	const author = raw.author;
	const authorName =
		typeof author === "string"
			? author
			: author && typeof author === "object" && "name" in author
				? String((author as { name?: unknown }).name ?? "")
				: null;
	return {
		name: typeof raw.name === "string" && raw.name ? raw.name : fallbackName,
		description:
			typeof raw.description === "string" && raw.description
				? raw.description
				: `Imported plugin from ${fallbackName}.`,
		version: typeof raw.version === "string" ? raw.version : null,
		author: authorName || null,
		homepage:
			typeof raw.homepage === "string"
				? raw.homepage
				: typeof raw.repository === "string"
					? raw.repository
					: null,
		raw,
	};
}

/** `agents/<slug>.md` files (Claude Code sub-agent format: frontmatter name/
 * description, body is the agent's system prompt). Parsed for display only —
 * NyxelOS agents are DB rows with their own model/tool config, so these
 * aren't auto-created as runnable agents, just surfaced so a user can see
 * what the plugin brings and hand-build an equivalent if useful. */
async function parsePluginAgent(filePath: string, slug: string): Promise<PluginAgentDefinition> {
	const raw = await readFile(filePath, "utf-8");
	const parsed = parseSkillMarkdown(raw);
	return {
		slug,
		name: parsed.name || slug,
		description: parsed.description || `Sub-agent: ${slug}`,
		body: parsed.body,
	};
}

export interface InstallPluginResult {
	plugin: PluginRecord;
	skills: SkillDefinition[];
	skippedFiles: string[];
	riskSummary: PluginRiskSummary;
}

/**
 * Installs a plugin from a GitHub repo: downloads every file in the repo
 * (preserving folder structure) under PLUGINS_ROOT/<workspaceId>/<slug>/,
 * registers every `skills/<name>/SKILL.md` (or a root `SKILL.md`) it ships
 * as a folder-bundle skill, parses `agents/*.md` sub-agents for display, and
 * records the whole thing as a `plugin` row. Reinstalling an already-
 * installed slug replaces its files and DB row (acts as an update).
 */
export async function installPluginFromGithub(input: {
	workspaceId: string;
	repoUrl: string;
	/** Set once the caller has shown `riskSummary` from a prior
	 * `PluginInstallNeedsConfirmationError` to the user and they chose to
	 * proceed anyway (docs/PLUGIN_SECURITY.md stage 4). */
	acknowledgeRisk?: boolean;
}): Promise<InstallPluginResult> {
	if (!isRemotePluginInstallEnabled()) {
		throw new Error(
			"Remote plugin installation is disabled on this server. Installed plugin code runs " +
				"with the same access as the server process, unsigned and unvetted (see " +
				"docs/PLUGIN_SECURITY.md) — set ENABLE_REMOTE_PLUGIN_INSTALL=true to opt in.",
		);
	}
	const parsed = parseGithubRepoUrl(input.repoUrl);
	if (!parsed) {
		throw new Error(
			`"${input.repoUrl}" doesn't look like a GitHub repo URL (expected https://github.com/owner/repo).`,
		);
	}
	const { owner, repo } = parsed;
	const explicitRef = parsed.ref;
	const ref = explicitRef ?? (await resolveDefaultBranch(owner, repo));
	// Only an exact 40-char commit SHA counts as genuinely pinned — a branch
	// or tag name (explicit or defaulted) can still move out from under the
	// install on next reinstall (docs/PLUGIN_SECURITY.md threat scenario 2).
	const refPinned = explicitRef != null && FULL_COMMIT_SHA_PATTERN.test(explicitRef);
	const resolvedSha = refPinned ? explicitRef : await resolveCommitSha(owner, repo, ref);
	const branchWarning = !refPinned;
	const isMovingBranch = !refPinned && (explicitRef == null || isMovingBranchName(ref));
	const treeRef = resolvedSha ?? ref;
	const tree = await fetchRepoTree(owner, repo, treeRef);

	const manifestEntry = tree.find(
		(entry) => entry.type === "blob" && entry.path === ".claude-plugin/plugin.json",
	);
	let manifestRaw: Record<string, unknown> = {};
	if (manifestEntry) {
		const buf = await downloadFile(owner, repo, treeRef, manifestEntry.path);
		try {
			manifestRaw = JSON.parse(Buffer.from(buf).toString("utf-8"));
		} catch {
			manifestRaw = {};
		}
	}
	const manifest = parseManifest(manifestRaw, repo);
	const slug = slugify(manifest.name);

	// Downloaded into a staging dir first — nothing under the plugin's real
	// slug-scoped installDir (and no existing install of the same slug) is
	// touched until the risk gate below clears, so a rejected/unconfirmed
	// high-risk install never disturbs a previously-installed plugin.
	const stagingDir = path.join(
		PLUGINS_ROOT,
		input.workspaceId,
		`.staging__${slug}__${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
	);
	await mkdir(stagingDir, { recursive: true });

	const blobs = tree.filter((entry) => entry.type === "blob");
	const skippedFiles: string[] = [];
	const downloadable = blobs.filter((entry) => {
		if ((entry.size ?? 0) > MAX_FILE_BYTES) {
			skippedFiles.push(entry.path);
			return false;
		}
		return true;
	});

	const findingsPerFile = await mapWithConcurrency(downloadable, DOWNLOAD_CONCURRENCY, async (entry) => {
		const buf = await downloadFile(owner, repo, treeRef, entry.path);
		const destPath = path.join(stagingDir, entry.path);
		await mkdir(path.dirname(destPath), { recursive: true });
		await Bun.write(destPath, buf);
		return scanForRiskyPatterns(entry.path, buf);
	});
	const findings = findingsPerFile.flat();

	const riskSummary: PluginRiskSummary = {
		ref,
		resolvedSha,
		refPinned,
		branchWarning,
		isMovingBranch,
		findings,
	};

	if (findings.length > 0 && !input.acknowledgeRisk) {
		await rm(stagingDir, { recursive: true, force: true });
		throw new PluginInstallNeedsConfirmationError(riskSummary);
	}

	const existing = await getDb().getPluginBySlug(input.workspaceId, slug);
	if (existing) {
		await uninstallPlugin(existing.id);
	}

	const installDir = pluginInstallDir(input.workspaceId, slug);
	await rm(installDir, { recursive: true, force: true });
	await rename(stagingDir, installDir);

	// skills/<name>/SKILL.md bundles, plus a single root SKILL.md if the repo
	// is a lone-skill plugin rather than a multi-skill collection like claude-seo.
	const skillDirNames = new Set(
		downloadable
			.map((entry) => /^skills\/([^/]+)\/SKILL\.md$/.exec(entry.path)?.[1])
			.filter((name): name is string => Boolean(name)),
	);
	const hasRootSkill = downloadable.some((entry) => entry.path === "SKILL.md");

	const skills: SkillDefinition[] = [];
	for (const dirName of skillDirNames) {
		skills.push(
			await loadFileSkillBundle(path.join(installDir, "skills", dirName), `${slug}__${dirName}`),
		);
	}
	if (hasRootSkill) {
		skills.push(await loadFileSkillBundle(installDir, slug));
	}

	const agentEntries = downloadable.filter((entry) => /^agents\/[^/]+\.md$/.test(entry.path));
	const agentDefs = await Promise.all(
		agentEntries.map((entry) => {
			const agentSlug = path.basename(entry.path, ".md");
			return parsePluginAgent(path.join(installDir, entry.path), agentSlug);
		}),
	);

	const pluginRecord = await getDb().createPlugin({
		workspaceId: input.workspaceId,
		slug,
		name: manifest.name,
		description: manifest.description,
		version: manifest.version,
		author: manifest.author,
		homepage: manifest.homepage,
		repoUrl: `https://github.com/${owner}/${repo}`,
		manifest: manifest.raw,
		skillSlugs: skills.map((s) => s.id),
		agentDefs,
		fileCount: downloadable.length,
		installDir,
		ref,
		resolvedSha,
		refPinned,
		riskFindings: findings.map((f) => `${f.pattern}: ${f.file}`),
	});

	return { plugin: pluginRecord, skills, skippedFiles, riskSummary };
}

export async function listPlugins(workspaceId: string): Promise<PluginRecord[]> {
	return getDb().listPluginsByWorkspace(workspaceId);
}

export async function getPlugin(id: string): Promise<PluginRecord | null> {
	return getDb().getPlugin(id);
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<PluginRecord> {
	return getDb().setPluginEnabled(id, enabled);
}

export async function uninstallPlugin(id: string): Promise<void> {
	const record = await getDb().getPlugin(id);
	if (!record) return;
	await rm(record.installDir, { recursive: true, force: true });
	await getDb().deletePlugin(id);
}

function normalizeRepoUrl(url: string): string {
	return url.trim().toLowerCase().replace(/\.git$/, "").replace(/\/+$/, "");
}

/** Finds an already-installed plugin in this workspace whose source repo
 * matches `repoUrl` (case/trailing-slash/`.git`-insensitive) — used to avoid
 * reinstalling (and re-downloading) a companion plugin an extension already
 * pulled in. */
export async function findPluginByRepoUrl(
	workspaceId: string,
	repoUrl: string,
): Promise<PluginRecord | null> {
	const target = normalizeRepoUrl(repoUrl);
	const plugins = await listPlugins(workspaceId);
	return plugins.find((p) => normalizeRepoUrl(p.repoUrl) === target) ?? null;
}

export interface EnsureExtensionPluginResult {
	status: "installed" | "already_installed" | "failed";
	plugin?: PluginRecord;
	skillCount?: number;
	agentCount?: number;
	error?: string;
}

/** Installs an extension's companion plugin (see
 * `ExtensionCatalogEntry.pluginRepoUrl`) the first time the extension is
 * activated in a workspace, so the extension's own agents have real
 * specialist skills/personas to draw on instead of shipping as a shell with
 * nothing behind it. Best-effort: failures are reported back but never
 * thrown, so a network hiccup never blocks the extension itself from
 * activating — the user can always retry from the Plugins page. */
export async function ensureExtensionPlugin(
	workspaceId: string,
	repoUrl: string,
): Promise<EnsureExtensionPluginResult> {
	const existing = await findPluginByRepoUrl(workspaceId, repoUrl);
	if (existing) {
		return {
			status: "already_installed",
			plugin: existing,
			skillCount: existing.skillSlugs.length,
			agentCount: existing.agentDefs.length,
		};
	}
	try {
		const result = await installPluginFromGithub({ workspaceId, repoUrl });
		return {
			status: "installed",
			plugin: result.plugin,
			skillCount: result.skills.length,
			agentCount: result.plugin.agentDefs.length,
		};
	} catch (err) {
		return { status: "failed", error: err instanceof Error ? err.message : String(err) };
	}
}

/** Loads the actual runnable SkillDefinition for every skill a plugin
 * contributes, straight off disk — used to merge plugin skills into the
 * workspace skill catalog (skills-resolve.ts) without duplicating the
 * bundle-loading logic there. */
export async function loadPluginSkillDefinitions(plugin: PluginRecord): Promise<SkillDefinition[]> {
	const definitions = await Promise.all(
		plugin.skillSlugs.map(async (skillId) => {
			const bundleSlug = skillId.replace(/^file_skill_bundle__/, "");
			const dirSuffix = bundleSlug.slice(plugin.slug.length + 2); // strip "<pluginSlug>__"
			const dir = dirSuffix ? path.join(plugin.installDir, "skills", dirSuffix) : plugin.installDir;
			try {
				return await loadFileSkillBundle(dir, bundleSlug);
			} catch {
				return null;
			}
		}),
	);
	return definitions.filter((skill): skill is SkillDefinition => skill !== null);
}
