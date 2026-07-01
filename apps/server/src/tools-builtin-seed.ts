import { getDb, type ToolKind } from "@nyxel/db";
import { workspaceRootDir } from "./skills-registry";

interface BuiltinToolSeed {
	kind: ToolKind;
	name: string;
	description: string;
	sensitive: boolean;
	config: Record<string, unknown>;
}

const WORKSPACE_DIR_CONFIG = { allowedDirs: [workspaceRootDir] };
const GITHUB_HOST_CONFIG = { allowedHosts: ["api.github.com"] };

/**
 * The default, non-deletable tool catalog seeded into every workspace —
 * mirrors the categorized tool list from the VS Code-style screenshots that
 * prompted this feature (see the plan doc). `task_run`/`test_run` are
 * deliberately not seeded here: they only make sense with a real
 * `config.command`, and there's no tool-edit mutation yet to set one on a
 * builtin (non-deletable) row after the fact — those two kinds stay
 * available for users to create manually from the Tools page instead.
 */
export const BUILTIN_TOOL_SEEDS: BuiltinToolSeed[] = [
	// edit
	{
		kind: "file_create",
		name: "Create file",
		description: "Create a new file with content; fails if it already exists unless overwrite is set.",
		sensitive: true,
		config: WORKSPACE_DIR_CONFIG,
	},
	{
		kind: "file_patch",
		name: "Edit files",
		description: "Apply targeted search/replace or line-range edits to an existing text file.",
		sensitive: true,
		config: WORKSPACE_DIR_CONFIG,
	},
	{
		kind: "file_move",
		name: "Rename/move file",
		description: "Move or rename a file.",
		sensitive: true,
		config: WORKSPACE_DIR_CONFIG,
	},
	{
		kind: "directory_create",
		name: "Create directory",
		description: "Create a new directory (and any missing parents).",
		sensitive: true,
		config: WORKSPACE_DIR_CONFIG,
	},
	{
		kind: "notebook_edit",
		name: "Edit notebook",
		description: "Add, remove, or edit cells in a Jupyter notebook (.ipynb) file.",
		sensitive: true,
		config: WORKSPACE_DIR_CONFIG,
	},
	// read
	{
		kind: "file_stat",
		name: "Inspect file",
		description: "Get size, type, and modification time for a file or directory.",
		sensitive: false,
		config: WORKSPACE_DIR_CONFIG,
	},
	{
		kind: "file_view_image",
		name: "View image",
		description: "Read an image file and return it as base64 with its mime type.",
		sensitive: false,
		config: WORKSPACE_DIR_CONFIG,
	},
	{
		kind: "notebook_summary",
		name: "Get notebook summary",
		description: "List a notebook's cells with their type and first line.",
		sensitive: false,
		config: WORKSPACE_DIR_CONFIG,
	},
	{
		kind: "notebook_cell_output",
		name: "Read notebook cell output",
		description: "Read the stored output of one notebook cell.",
		sensitive: false,
		config: WORKSPACE_DIR_CONFIG,
	},
	{
		kind: "terminal_last_command",
		name: "Get last terminal command",
		description: "Return the most recently run terminal command and its execution id.",
		sensitive: false,
		config: {},
	},
	{
		kind: "terminal_output",
		name: "Get terminal output",
		description: "Read the buffered output and status of a running or finished terminal session.",
		sensitive: false,
		config: {},
	},
	{
		kind: "problems",
		name: "Check for problems",
		description: "Run the workspace's type-checker (tsc --noEmit by default) and list reported problems.",
		sensitive: false,
		config: {},
	},
	// search
	{
		kind: "file_search",
		name: "Search files by name",
		description: "Find files by a glob-style filename pattern.",
		sensitive: false,
		config: WORKSPACE_DIR_CONFIG,
	},
	{
		kind: "text_search",
		name: "Search file contents",
		description: "Search file contents by regex/text across the workspace.",
		sensitive: false,
		config: WORKSPACE_DIR_CONFIG,
	},
	{
		kind: "usages",
		name: "Find usages",
		description: "Find occurrences of an identifier across the workspace (regex-based, not a language server).",
		sensitive: false,
		config: WORKSPACE_DIR_CONFIG,
	},
	{
		kind: "codebase_search",
		name: "Search codebase",
		description: "Broad text search across the workspace (heuristic, not semantic/embeddings-based).",
		sensitive: false,
		config: WORKSPACE_DIR_CONFIG,
	},
	{
		kind: "changes",
		name: "Get git changes",
		description: "Show git status/diff for the workspace.",
		sensitive: false,
		config: WORKSPACE_DIR_CONFIG,
	},
	// execute
	{
		kind: "terminal_run",
		name: "Run in terminal",
		description: "Run a shell command in a new terminal session and return its initial output.",
		sensitive: true,
		config: {},
	},
	{
		kind: "terminal_send_input",
		name: "Send terminal input",
		description: "Send text input to a running terminal session.",
		sensitive: true,
		config: {},
	},
	{
		kind: "terminal_kill",
		name: "Kill terminal",
		description: "Terminate a running terminal session.",
		sensitive: true,
		config: {},
	},
	// browser
	{
		kind: "browser_navigate",
		name: "Navigate browser",
		description: "Navigate the shared headless browser to a URL.",
		sensitive: true,
		config: {},
	},
	{
		kind: "browser_click",
		name: "Click element",
		description: "Click an element on the current browser page by CSS selector.",
		sensitive: true,
		config: {},
	},
	{
		kind: "browser_drag",
		name: "Drag element",
		description: "Drag an element over another element on the current browser page.",
		sensitive: true,
		config: {},
	},
	{
		kind: "browser_hover",
		name: "Hover element",
		description: "Hover the pointer over an element on the current browser page.",
		sensitive: true,
		config: {},
	},
	{
		kind: "browser_type",
		name: "Type into element",
		description: "Type text into a form field on the current browser page.",
		sensitive: true,
		config: {},
	},
	{
		kind: "browser_handle_dialog",
		name: "Handle browser dialog",
		description: "Accept or dismiss the next alert/confirm/prompt dialog on the current browser page.",
		sensitive: true,
		config: {},
	},
	{
		kind: "browser_screenshot",
		name: "Screenshot page",
		description: "Take a screenshot of the current browser page.",
		sensitive: false,
		config: {},
	},
	{
		kind: "browser_read_page",
		name: "Read page",
		description: "Read the visible text content of the current browser page.",
		sensitive: false,
		config: {},
	},
	{
		kind: "browser_run_playwright_code",
		name: "Run Playwright code",
		description: "Run arbitrary Playwright code against the current browser page — the most powerful/least restricted browser tool.",
		sensitive: true,
		config: {},
	},
	// web
	{
		kind: "github_repo_fetch",
		name: "Fetch GitHub repo",
		description: "Fetch repository metadata or file contents from the GitHub API.",
		sensitive: false,
		config: GITHUB_HOST_CONFIG,
	},
	{
		kind: "github_code_search",
		name: "Search GitHub code",
		description: "Search code on GitHub via the GitHub code search API.",
		sensitive: false,
		config: GITHUB_HOST_CONFIG,
	},
];

/** Idempotent — only inserts seeds whose `kind` isn't already present for
 * this workspace, so it's safe to call on every workspace-create and again
 * at every server boot (see index.ts) to backfill workspaces created before
 * this feature shipped. */
export async function seedBuiltinToolsForWorkspace(
	workspaceId: string,
): Promise<void> {
	const db = getDb();
	const existing = await db.listToolsByWorkspace(workspaceId);
	const existingKinds = new Set(existing.map((tool) => tool.kind));
	for (const seed of BUILTIN_TOOL_SEEDS) {
		if (existingKinds.has(seed.kind)) continue;
		await db.createTool({
			workspaceId,
			name: seed.name,
			description: seed.description,
			kind: seed.kind,
			config: seed.config,
			sensitive: seed.sensitive,
			enabled: true,
			builtin: true,
		});
	}
}

export async function seedBuiltinToolsForAllWorkspaces(): Promise<void> {
	const db = getDb();
	const workspaces = await db.listWorkspaces();
	for (const workspace of workspaces) {
		await seedBuiltinToolsForWorkspace(workspace.id);
	}
}
