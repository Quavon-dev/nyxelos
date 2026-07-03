import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createSkillContext } from "@nyxel/skills-sdk";

/**
 * Read-only groundwork for the Coding workspace mode (ARCHITECTURE.md
 * section 11 / ADR-0017): file tree, git status, git diff. Deliberately
 * read-only — actual file writes still go through the existing
 * approval-gated file tools (tools.ts), matching the "diff-first" principle
 * (the agent prepares a patch, the user reviews it here, approval executes
 * it) rather than this module writing anything itself.
 *
 * git commands run via `Bun.spawn` with an argv array (never a shell
 * string), so there's no shell-injection surface from a repo path or file
 * path containing special characters — unlike tools-builtin/terminal.ts,
 * which deliberately runs an arbitrary shell string and is gated
 * accordingly.
 */

async function runGit(rootDir: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn(["git", ...args], {
		cwd: rootDir,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, exitCode };
}

export interface RepoInfo {
	isGitRepo: boolean;
	branch: string | null;
	error: string | null;
}

export async function getRepoInfo(rootDir: string): Promise<RepoInfo> {
	const check = await runGit(rootDir, ["rev-parse", "--is-inside-work-tree"]);
	if (check.exitCode !== 0) {
		return { isGitRepo: false, branch: null, error: check.stderr.trim() || "Not a git repository." };
	}
	const branch = await runGit(rootDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
	return { isGitRepo: true, branch: branch.stdout.trim() || null, error: null };
}

export type GitFileStatus =
	| "modified"
	| "added"
	| "deleted"
	| "renamed"
	| "untracked"
	| "unknown";

export interface GitStatusEntry {
	path: string;
	status: GitFileStatus;
	staged: boolean;
}

function classifyPorcelainCode(code: string): GitFileStatus {
	if (code.includes("?")) return "untracked";
	if (code.includes("A")) return "added";
	if (code.includes("D")) return "deleted";
	if (code.includes("R")) return "renamed";
	if (code.includes("M")) return "modified";
	return "unknown";
}

export async function getGitStatus(rootDir: string): Promise<GitStatusEntry[]> {
	const result = await runGit(rootDir, ["status", "--porcelain=v1"]);
	if (result.exitCode !== 0) return [];
	return result.stdout
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const stagedCode = line.slice(0, 1);
			const worktreeCode = line.slice(1, 2);
			const path = line.slice(3);
			const staged = stagedCode !== " " && stagedCode !== "?";
			return {
				path,
				status: classifyPorcelainCode(stagedCode + worktreeCode),
				staged,
			};
		});
}

/** Unified diff for the whole working tree, or one file when `filePath` is
 * given. `filePath` is passed as its own argv element (after `--`), never
 * concatenated into a command string. */
export async function getGitDiff(rootDir: string, filePath?: string): Promise<string> {
	const args = ["diff", "HEAD"];
	if (filePath) args.push("--", filePath);
	const result = await runGit(rootDir, args);
	return result.stdout;
}

export interface DirectoryEntry {
	name: string;
	isDirectory: boolean;
}

/** Lists one directory's immediate children, confined to `rootDir` via the
 * same permission-scoped filesystem context every skill uses
 * (packages/skills-sdk) — `relativePath` can't escape `rootDir` regardless
 * of `..` segments (see skills-sdk/runtime.ts's assertPathAllowed). */
export async function listDirectory(
	rootDir: string,
	relativePath: string,
): Promise<DirectoryEntry[]> {
	const ctx = createSkillContext({ network: [], filesystem: [rootDir] });
	const target = relativePath ? `${rootDir}/${relativePath}` : rootDir;
	return ctx.readDir(target);
}

const SEARCH_IGNORED_DIR_NAMES = new Set(["node_modules", ".git", "dist", "build", ".next"]);
const SEARCH_MAX_WALK_ENTRIES = 5_000;
const SEARCH_MAX_RESULTS = 20;
const SEARCH_MAX_CONTENT_BYTES = 200_000;

export interface FileSearchMatch {
	path: string;
	matchedOn: "filename" | "content";
	snippet: string | null;
}

/** Finds files whose name or content contains `query`, for the Coding
 * workspace's "relevant files" panel. Read-only, bounded (entry count, file
 * size, result count) so a huge repo can't make this hang. Confined to
 * `rootDir` — it only ever walks into `rootDir`'s own subdirectories, never
 * out of them. */
export async function searchFiles(rootDir: string, query: string): Promise<FileSearchMatch[]> {
	const needle = query.trim().toLowerCase();
	if (!needle) return [];

	const resolvedRoot = path.resolve(rootDir);
	const results: FileSearchMatch[] = [];
	let visited = 0;

	async function walk(dir: string): Promise<void> {
		if (results.length >= SEARCH_MAX_RESULTS || visited > SEARCH_MAX_WALK_ENTRIES) return;
		let entries: import("node:fs").Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (results.length >= SEARCH_MAX_RESULTS || visited > SEARCH_MAX_WALK_ENTRIES) return;
			visited++;
			const fullPath = path.join(dir, entry.name);
			const relativePath = path.relative(resolvedRoot, fullPath);

			if (entry.isDirectory()) {
				if (SEARCH_IGNORED_DIR_NAMES.has(entry.name) || entry.name.startsWith(".")) continue;
				await walk(fullPath);
				continue;
			}
			if (!entry.isFile()) continue;

			if (entry.name.toLowerCase().includes(needle)) {
				results.push({ path: relativePath, matchedOn: "filename", snippet: null });
				continue;
			}

			try {
				const stats = await stat(fullPath);
				if (stats.size > SEARCH_MAX_CONTENT_BYTES) continue;
				const content = await readFile(fullPath, "utf-8");
				const matchIndex = content.toLowerCase().indexOf(needle);
				if (matchIndex === -1) continue;
				const lineStart = content.lastIndexOf("\n", matchIndex) + 1;
				const lineEndIndex = content.indexOf("\n", matchIndex);
				const lineEnd = lineEndIndex === -1 ? content.length : lineEndIndex;
				results.push({
					path: relativePath,
					matchedOn: "content",
					snippet: content.slice(lineStart, lineEnd).trim().slice(0, 200),
				});
			} catch {
				// Unreadable/binary file — skip.
			}
		}
	}

	await walk(resolvedRoot);
	return results;
}
