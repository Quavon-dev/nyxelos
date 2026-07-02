import path from "node:path";
import type { ToolRecord } from "@nyxel/db";
import { createSkillContext, type SkillDefinition } from "@nyxel/skills-sdk";
import { z } from "zod";
import { isCustomCodeSkillsEnabled } from "./feature-flags";
import { listKnowledgeBaseDocuments } from "./knowledge-base";
import { buildGenerateSpeechTool, buildTranscribeAudioTool } from "./tools-builtin/audio";
import {
	buildBrowserClickTool,
	buildBrowserDragTool,
	buildBrowserHandleDialogTool,
	buildBrowserHoverTool,
	buildBrowserNavigateTool,
	buildBrowserReadPageTool,
	buildBrowserRunPlaywrightCodeTool,
	buildBrowserScreenshotTool,
	buildBrowserTypeTool,
} from "./tools-builtin/browser";
import {
	buildDirectoryCreateTool,
	buildFileCreateTool,
	buildFileMoveTool,
	buildFilePatchTool,
	buildNotebookEditTool,
} from "./tools-builtin/edit";
import { buildGenerateImageTool } from "./tools-builtin/image";
import { buildEditVideoTool } from "./tools-builtin/video-edit";
import { buildGenerateVideoTool } from "./tools-builtin/video";
import {
	buildFileStatTool,
	buildFileViewImageTool,
	buildNotebookCellOutputTool,
	buildNotebookSummaryTool,
	buildProblemsTool,
	buildTerminalLastCommandTool,
	buildTerminalOutputTool,
} from "./tools-builtin/read";
import {
	buildChangesTool,
	buildCodebaseSearchTool,
	buildFileSearchTool,
	buildTextSearchTool,
	buildUsagesTool,
} from "./tools-builtin/search";
import {
	buildTaskRunTool,
	buildTerminalKillTool,
	buildTerminalRunTool,
	buildTerminalSendInputTool,
	buildTestRunTool,
} from "./tools-builtin/terminal";
import { buildGithubCodeSearchTool, buildGithubRepoFetchTool } from "./tools-builtin/web";

/**
 * Turns a DB-backed ToolRecord (created through the workspace tools tab, or
 * seeded as a builtin default — see tools-builtin-seed.ts) into the same
 * SkillDefinition shape as the hand-written skills in packages/skills-sdk,
 * so apps/server/src/tools.ts can run both kinds through one code path.
 *
 * The original 7 kinds (http_fetch..custom_code) stay inline below; every
 * newer kind dispatches to a per-category builder in ./tools-builtin — see
 * that directory and the plan doc for what each category covers and what's
 * deliberately simplified (usages/codebase_search are regex, not LSP/
 * embeddings; problems is `tsc --noEmit` output, not a live diagnostics
 * feed; notebook cell execution is a one-off subprocess, not a persistent
 * kernel).
 */
export function buildDynamicToolDefinition(
	record: ToolRecord,
): SkillDefinition {
	const config = record.config ?? {};
	const stringArray = (value: unknown): string[] =>
		Array.isArray(value)
			? value.filter((v): v is string => typeof v === "string")
			: [];

	const allowedHosts = stringArray(config.allowedHosts);
	const allowedDirs = stringArray(config.allowedDirs).map((dir) =>
		path.resolve(dir),
	);

	const base = {
		id: record.id,
		name: record.name,
		description: record.description,
		sensitive: record.sensitive,
	};

	switch (record.kind) {
		case "http_fetch":
			return {
				...base,
				inputSchema: z.object({ url: z.string().url() }),
				permissions: { network: allowedHosts, filesystem: [] },
				async run({ url }) {
					const ctx = createSkillContext({
						network: allowedHosts,
						filesystem: [],
					});
					const res = await ctx.fetch(url);
					const text = await res.text();
					return { status: res.status, body: text.slice(0, 4000) };
				},
			};

		case "file_read":
			return {
				...base,
				inputSchema: z.object({
					path: z.string().describe("Absolute path to read."),
				}),
				permissions: { network: [], filesystem: allowedDirs },
				async run({ path: filePath }) {
					const ctx = createSkillContext({
						network: [],
						filesystem: allowedDirs,
					});
					const content = await ctx.readFile(filePath);
					return { path: filePath, content: content.slice(0, 20_000) };
				},
			};

		case "file_list":
			return {
				...base,
				inputSchema: z.object({
					path: z.string().describe("Absolute directory path to list."),
				}),
				permissions: { network: [], filesystem: allowedDirs },
				async run({ path: dirPath }) {
					const ctx = createSkillContext({
						network: [],
						filesystem: allowedDirs,
					});
					const entries = await ctx.readDir(dirPath);
					return { path: dirPath, entries };
				},
			};

		case "file_write":
			return {
				...base,
				inputSchema: z.object({
					path: z.string().describe("Absolute path to write."),
					content: z.string(),
				}),
				permissions: { network: [], filesystem: allowedDirs },
				async run({ path: filePath, content }) {
					const ctx = createSkillContext({
						network: [],
						filesystem: allowedDirs,
					});
					await ctx.writeFile(filePath, content);
					return { path: filePath, bytesWritten: content.length };
				},
			};

		case "file_delete":
			return {
				...base,
				inputSchema: z.object({
					path: z.string().describe("Absolute path to delete."),
				}),
				permissions: { network: [], filesystem: allowedDirs },
				async run({ path: filePath }) {
					const ctx = createSkillContext({
						network: [],
						filesystem: allowedDirs,
					});
					await ctx.deleteFile(filePath);
					return { path: filePath, deleted: true };
				},
			};

		case "kb_search":
			return {
				...base,
				inputSchema: z.object({ query: z.string().min(1) }),
				permissions: { network: [], filesystem: [] },
				async run({ query }) {
					const documents = await listKnowledgeBaseDocuments(
						record.workspaceId,
					);
					const needle = query.toLowerCase();
					const matches = documents
						.filter(
							(doc) =>
								doc.title.toLowerCase().includes(needle) ||
								doc.path.toLowerCase().includes(needle),
						)
						.slice(0, 10)
						.map((doc) => ({ path: doc.path, title: doc.title }));
					return { query, matches };
				},
			};

		case "custom_code": {
			const code = typeof config.code === "string" ? config.code : "";
			return {
				...base,
				inputSchema: z.record(z.string(), z.unknown()).default({}),
				permissions: { network: allowedHosts, filesystem: allowedDirs },
				async run(input) {
					if (!isCustomCodeSkillsEnabled()) {
						throw new Error(
							"Custom-code skills are disabled on this server. This tool kind runs " +
								"arbitrary code in the main server process via `new Function` — set " +
								"ENABLE_CUSTOM_CODE_SKILLS=true to opt in (dev only; not recommended in production).",
						);
					}
					const ctx = createSkillContext({
						network: allowedHosts,
						filesystem: allowedDirs,
					});
					// Deliberately in-process, not sandboxed beyond the scoped fetch/fs
					// context above — same trust model as every other skill (ADR-0007).
					// A custom-code skill can still reach arbitrary Node/Bun APIs; the
					// approval workflow (sensitive: true by default) is the actual
					// safety net for what it's allowed to *do*, not what it can *see*.
					const fn = new Function(
						"input",
						"ctx",
						`return (async () => { ${code} })();`,
					) as (
						input: unknown,
						ctx: ReturnType<typeof createSkillContext>,
					) => Promise<unknown>;
					return fn(input, ctx);
				},
			};
		}

		// edit
		case "file_create":
			return buildFileCreateTool(record);
		case "directory_create":
			return buildDirectoryCreateTool(record);
		case "file_move":
			return buildFileMoveTool(record);
		case "file_patch":
			return buildFilePatchTool(record);
		case "notebook_edit":
			return buildNotebookEditTool(record);

		// read
		case "file_stat":
			return buildFileStatTool(record);
		case "file_view_image":
			return buildFileViewImageTool(record);
		case "notebook_summary":
			return buildNotebookSummaryTool(record);
		case "notebook_cell_output":
			return buildNotebookCellOutputTool(record);
		case "terminal_last_command":
			return buildTerminalLastCommandTool(record);
		case "terminal_output":
			return buildTerminalOutputTool(record);
		case "problems":
			return buildProblemsTool(record);

		// search
		case "file_search":
			return buildFileSearchTool(record);
		case "text_search":
			return buildTextSearchTool(record);
		case "usages":
			return buildUsagesTool(record);
		case "codebase_search":
			return buildCodebaseSearchTool(record);
		case "changes":
			return buildChangesTool(record);

		// execute
		case "terminal_run":
			return buildTerminalRunTool(record);
		case "terminal_send_input":
			return buildTerminalSendInputTool(record);
		case "terminal_kill":
			return buildTerminalKillTool(record);
		case "task_run":
			return buildTaskRunTool(record);
		case "test_run":
			return buildTestRunTool(record);

		// browser
		case "browser_navigate":
			return buildBrowserNavigateTool(record);
		case "browser_click":
			return buildBrowserClickTool(record);
		case "browser_drag":
			return buildBrowserDragTool(record);
		case "browser_hover":
			return buildBrowserHoverTool(record);
		case "browser_type":
			return buildBrowserTypeTool(record);
		case "browser_handle_dialog":
			return buildBrowserHandleDialogTool(record);
		case "browser_screenshot":
			return buildBrowserScreenshotTool(record);
		case "browser_read_page":
			return buildBrowserReadPageTool(record);
		case "browser_run_playwright_code":
			return buildBrowserRunPlaywrightCodeTool(record);

		// web
		case "github_repo_fetch":
			return buildGithubRepoFetchTool(record);
		case "github_code_search":
			return buildGithubCodeSearchTool(record);
		case "generate_image":
			return buildGenerateImageTool(record);
		case "generate_video":
			return buildGenerateVideoTool(record);
		case "edit_video":
			return buildEditVideoTool(record);
		case "generate_speech":
			return buildGenerateSpeechTool(record);
		case "transcribe_audio":
			return buildTranscribeAudioTool(record);

		default:
			// Exhaustiveness guard — a future ToolKind added to the DB schema
			// without a case here degrades to a no-op rather than crashing tool
			// building for the whole agent.
			return {
				...base,
				inputSchema: z.record(z.string(), z.unknown()).default({}),
				permissions: { network: [], filesystem: [] },
				async run() {
					throw new Error(`Unsupported tool kind: ${record.kind}`);
				},
			};
	}
}

/** Which screenshot-derived category each ToolKind belongs to — used by the
 * frontend's Tools page for grouping and by tools-builtin-seed.ts for the
 * default catalog. Kept here (not duplicated client-side) as the single
 * source of truth; the frontend's copy in apps/web mirrors this list. */
export const TOOL_KIND_CATEGORY: Record<
	ToolRecord["kind"],
	"edit" | "read" | "search" | "execute" | "browser" | "web"
> = {
	http_fetch: "web",
	file_read: "read",
	file_write: "edit",
	file_list: "search",
	file_delete: "edit",
	kb_search: "search",
	custom_code: "execute",
	file_create: "edit",
	file_patch: "edit",
	file_move: "edit",
	directory_create: "edit",
	notebook_edit: "edit",
	file_stat: "read",
	file_view_image: "read",
	notebook_summary: "read",
	notebook_cell_output: "read",
	terminal_last_command: "read",
	terminal_output: "read",
	problems: "read",
	file_search: "search",
	text_search: "search",
	usages: "search",
	codebase_search: "search",
	changes: "search",
	terminal_run: "execute",
	terminal_send_input: "execute",
	terminal_kill: "execute",
	task_run: "execute",
	test_run: "execute",
	browser_navigate: "browser",
	browser_click: "browser",
	browser_drag: "browser",
	browser_hover: "browser",
	browser_type: "browser",
	browser_handle_dialog: "browser",
	browser_screenshot: "browser",
	browser_read_page: "browser",
	browser_run_playwright_code: "browser",
	github_repo_fetch: "web",
	github_code_search: "web",
	generate_image: "web",
	generate_video: "web",
	edit_video: "web",
	generate_speech: "web",
	transcribe_audio: "web",
};
