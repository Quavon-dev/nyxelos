import type { ToolRecord } from "@nyxel/db";
import { createSkillContext, type SkillDefinition } from "@nyxel/skills-sdk";
import { z } from "zod";
import { allowedDirsFromConfig, baseFields } from "./shared";

/** Category: edit. Config shape (all kinds): `{ allowedDirs: string[] }`. */

export function buildFileCreateTool(record: ToolRecord): SkillDefinition {
	const allowedDirs = allowedDirsFromConfig(record.config ?? {});
	return {
		...baseFields(record),
		inputSchema: z.object({
			path: z.string().describe("Absolute path to create."),
			content: z.string().default(""),
			overwrite: z
				.boolean()
				.default(false)
				.describe("If false (default), fails when the file already exists."),
		}),
		permissions: { network: [], filesystem: allowedDirs },
		async run({ path: filePath, content, overwrite }) {
			const ctx = createSkillContext({ network: [], filesystem: allowedDirs });
			if (!overwrite) {
				try {
					await ctx.statPath(filePath);
					throw new Error(
						`"${filePath}" already exists — pass overwrite: true to replace it.`,
					);
				} catch (err) {
					// ENOENT (file doesn't exist yet) is the expected/happy path here.
					const code = (err as NodeJS.ErrnoException).code;
					if (code !== "ENOENT") throw err;
				}
			}
			await ctx.writeFile(filePath, content);
			return { path: filePath, bytesWritten: content.length, created: true };
		},
	};
}

export function buildDirectoryCreateTool(record: ToolRecord): SkillDefinition {
	const allowedDirs = allowedDirsFromConfig(record.config ?? {});
	return {
		...baseFields(record),
		inputSchema: z.object({
			path: z.string().describe("Absolute directory path to create."),
		}),
		permissions: { network: [], filesystem: allowedDirs },
		async run({ path: dirPath }) {
			const ctx = createSkillContext({ network: [], filesystem: allowedDirs });
			await ctx.mkdir(dirPath);
			return { path: dirPath, created: true };
		},
	};
}

export function buildFileMoveTool(record: ToolRecord): SkillDefinition {
	const allowedDirs = allowedDirsFromConfig(record.config ?? {});
	return {
		...baseFields(record),
		inputSchema: z.object({
			fromPath: z.string().describe("Absolute source path."),
			toPath: z.string().describe("Absolute destination path."),
		}),
		permissions: { network: [], filesystem: allowedDirs },
		async run({ fromPath, toPath }) {
			const ctx = createSkillContext({ network: [], filesystem: allowedDirs });
			await ctx.moveFile(fromPath, toPath);
			const stats = await ctx.statPath(toPath);
			return { fromPath, toPath, ...stats };
		},
	};
}

const patchOperationSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("search_replace"),
		search: z.string().min(1),
		replace: z.string(),
		matchIndex: z.number().int().min(0).optional(),
	}),
	z.object({
		type: z.literal("replace_lines"),
		startLine: z.number().int().min(1),
		endLine: z.number().int().min(1),
		content: z.string(),
	}),
]);

function findMatchIndex(
	content: string,
	needle: string,
	matchIndex: number | undefined,
) {
	const matches: number[] = [];
	let searchFrom = 0;
	while (searchFrom <= content.length) {
		const found = content.indexOf(needle, searchFrom);
		if (found === -1) break;
		matches.push(found);
		searchFrom = found + needle.length;
	}
	if (matches.length === 0) {
		throw new Error(`Patch anchor not found: "${needle.slice(0, 120)}"`);
	}
	if (matchIndex === undefined && matches.length > 1) {
		throw new Error(
			`Patch anchor is ambiguous (${matches.length} matches); supply matchIndex.`,
		);
	}
	const selected = matches[matchIndex ?? 0];
	if (selected === undefined) {
		throw new Error(`matchIndex ${matchIndex} is out of range.`);
	}
	return selected;
}

/** file_patch reimplements (rather than reuses) skills-sdk's
 * createWorkspaceFilePatchSkill: that factory hardcodes its own `id`
 * ("workspace_file_patch"), and every builtin/custom tool here needs to keep
 * `record.id` as its tool id (see baseFields) to stay addressable from
 * agent.toolIds. */
export function buildFilePatchTool(record: ToolRecord): SkillDefinition {
	const allowedDirs = allowedDirsFromConfig(record.config ?? {});
	return {
		...baseFields(record),
		inputSchema: z.object({
			path: z.string().describe("Absolute file path."),
			createIfMissing: z.boolean().default(false),
			operations: z.array(patchOperationSchema).min(1),
		}),
		permissions: { network: [], filesystem: allowedDirs },
		async run({ path: filePath, createIfMissing, operations }) {
			const ctx = createSkillContext({ network: [], filesystem: allowedDirs });
			let before = "";
			try {
				before = await ctx.readFile(filePath);
			} catch (err) {
				if (!createIfMissing) throw err;
			}
			let content = before;
			for (const op of operations) {
				if (op.type === "search_replace") {
					const start = findMatchIndex(content, op.search, op.matchIndex);
					content =
						content.slice(0, start) +
						op.replace +
						content.slice(start + op.search.length);
				} else {
					const lines = content.split("\n");
					const start = op.startLine - 1;
					const end = op.endLine;
					if (start < 0 || end < op.startLine || start > lines.length) {
						throw new Error(`Invalid line range ${op.startLine}-${op.endLine}.`);
					}
					lines.splice(start, end - start, ...op.content.split("\n"));
					content = lines.join("\n");
				}
			}
			await ctx.writeFile(filePath, content);
			const { path: _ignoredPath, ...stats } = await ctx.statPath(filePath);
			return { path: filePath, operationsApplied: operations.length, ...stats };
		},
	};
}

interface NotebookCell {
	cell_type: "code" | "markdown";
	source: string[];
	outputs?: unknown[];
	execution_count?: number | null;
	metadata?: Record<string, unknown>;
}

interface NotebookJson {
	cells: NotebookCell[];
	metadata: Record<string, unknown>;
	nbformat: number;
	nbformat_minor: number;
}

function emptyNotebook(): NotebookJson {
	return { cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 };
}

/** Structural .ipynb editing only — see docs/frontend-migration note in the
 * plan: no live kernel, so cell outputs here are whatever was last stored in
 * the file, not freshly executed (that's tools-builtin/read.ts's
 * notebook_cell_output plus the separate test_run/terminal_run tools for
 * actually running code). */
export function buildNotebookEditTool(record: ToolRecord): SkillDefinition {
	const allowedDirs = allowedDirsFromConfig(record.config ?? {});
	return {
		...baseFields(record),
		inputSchema: z.object({
			path: z.string().describe("Absolute .ipynb path."),
			createIfMissing: z.boolean().default(true),
			operation: z.discriminatedUnion("type", [
				z.object({
					type: z.literal("add_cell"),
					cellType: z.enum(["code", "markdown"]),
					source: z.string(),
					index: z.number().int().min(0).optional(),
				}),
				z.object({ type: z.literal("remove_cell"), index: z.number().int().min(0) }),
				z.object({
					type: z.literal("update_cell_source"),
					index: z.number().int().min(0),
					source: z.string(),
				}),
			]),
		}),
		permissions: { network: [], filesystem: allowedDirs },
		async run({ path: filePath, createIfMissing, operation }) {
			const ctx = createSkillContext({ network: [], filesystem: allowedDirs });
			let notebook: NotebookJson;
			try {
				notebook = JSON.parse(await ctx.readFile(filePath));
			} catch (err) {
				if (!createIfMissing) throw err;
				notebook = emptyNotebook();
			}
			if (operation.type === "add_cell") {
				const cell: NotebookCell = {
					cell_type: operation.cellType,
					source: operation.source.split("\n"),
					outputs: operation.cellType === "code" ? [] : undefined,
				};
				const index = operation.index ?? notebook.cells.length;
				notebook.cells.splice(index, 0, cell);
			} else if (operation.type === "remove_cell") {
				if (operation.index >= notebook.cells.length) {
					throw new Error(`Cell index ${operation.index} out of range.`);
				}
				notebook.cells.splice(operation.index, 1);
			} else {
				const cell = notebook.cells[operation.index];
				if (!cell) throw new Error(`Cell index ${operation.index} out of range.`);
				cell.source = operation.source.split("\n");
			}
			await ctx.writeFile(filePath, JSON.stringify(notebook, null, 1));
			return { path: filePath, cellCount: notebook.cells.length };
		},
	};
}
