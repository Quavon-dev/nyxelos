import path from "node:path";
import { z } from "zod";
import { defineSkill } from "../define-skill";

function resolveWorkspacePath(rootDir: string, requestedPath: string) {
	return path.isAbsolute(requestedPath)
		? requestedPath
		: path.join(rootDir, requestedPath);
}

function buildUnifiedDiffPreview(
	beforeContent: string,
	afterContent: string,
	maxLines = 200,
) {
	const beforeLines = beforeContent.split("\n");
	const afterLines = afterContent.split("\n");
	const preview: string[] = ["--- before", "+++ after"];
	const shared = Math.max(beforeLines.length, afterLines.length);
	for (let index = 0; index < shared && preview.length < maxLines; index++) {
		const beforeLine = beforeLines[index];
		const afterLine = afterLines[index];
		if (beforeLine === afterLine) {
			preview.push(` ${beforeLine ?? ""}`);
			continue;
		}
		if (beforeLine !== undefined) preview.push(`-${beforeLine}`);
		if (afterLine !== undefined) preview.push(`+${afterLine}`);
	}
	return preview.join("\n");
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
	z.object({
		type: z.literal("insert_before"),
		anchor: z.string().min(1),
		content: z.string(),
		matchIndex: z.number().int().min(0).optional(),
	}),
	z.object({
		type: z.literal("insert_after"),
		anchor: z.string().min(1),
		content: z.string(),
		matchIndex: z.number().int().min(0).optional(),
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
	const selectedIndex = matchIndex ?? 0;
	const start = matches[selectedIndex];
	if (start === undefined) {
		throw new Error(
			`matchIndex ${selectedIndex} is out of range for anchor "${needle.slice(0, 120)}".`,
		);
	}
	return start;
}

function applyPatchOperations(
	initialContent: string,
	operations: z.infer<typeof patchOperationSchema>[],
) {
	let content = initialContent;
	for (const operation of operations) {
		if (operation.type === "search_replace") {
			const start = findMatchIndex(content, operation.search, operation.matchIndex);
			content =
				content.slice(0, start) +
				operation.replace +
				content.slice(start + operation.search.length);
			continue;
		}
		if (operation.type === "replace_lines") {
			const lines = content.split("\n");
			const start = operation.startLine - 1;
			const end = operation.endLine;
			if (start < 0 || end < operation.startLine || start > lines.length) {
				throw new Error(
					`Invalid line range ${operation.startLine}-${operation.endLine}.`,
				);
			}
			lines.splice(start, end - start, ...operation.content.split("\n"));
			content = lines.join("\n");
			continue;
		}
		const start = findMatchIndex(content, operation.anchor, operation.matchIndex);
		const insertion =
			operation.type === "insert_before"
				? operation.content
				: `${operation.anchor}${operation.content}`;
		content =
			operation.type === "insert_before"
				? content.slice(0, start) + operation.content + content.slice(start)
				: content.slice(0, start) + insertion + content.slice(start + operation.anchor.length);
	}
	return content;
}

export function createWorkspaceFileReadSkill(rootDir: string) {
	return defineSkill({
		id: "workspace_file_read",
		name: "Read workspace file",
		description:
			"Read a text file from the current workspace. Use this to inspect existing code, config, or docs before making changes.",
		inputSchema: z.object({
			path: z
				.string()
				.describe(
					"Workspace-relative or absolute path to a file inside the workspace.",
				),
		}),
		permissions: { network: [], filesystem: [rootDir] },
		sensitive: false,
		async run({ path: requestedPath }, ctx) {
			const filePath = resolveWorkspacePath(rootDir, requestedPath);
			const content = await ctx.readFile(filePath);
			return { path: filePath, content: content.slice(0, 20_000) };
		},
	});
}

export function createWorkspaceFileListSkill(rootDir: string) {
	return defineSkill({
		id: "workspace_file_list",
		name: "List workspace directory",
		description:
			"List the immediate contents of a workspace directory so you can discover nearby files before reading or editing them.",
		inputSchema: z.object({
			path: z
				.string()
				.default(".")
				.describe(
					"Workspace-relative or absolute directory path inside the workspace.",
				),
		}),
		permissions: { network: [], filesystem: [rootDir] },
		sensitive: false,
		async run({ path: requestedPath }, ctx) {
			const dirPath = resolveWorkspacePath(rootDir, requestedPath);
			const entries = await ctx.readDir(dirPath);
			return { path: dirPath, entries };
		},
	});
}

export function createWorkspaceFileWriteSkill(rootDir: string) {
	return defineSkill({
		id: "workspace_file_write",
		name: "Write workspace file",
		description:
			"Create or overwrite a text file in the current workspace. Use after you have inspected the relevant context and decided on the change.",
		inputSchema: z.object({
			path: z
				.string()
				.describe(
					"Workspace-relative or absolute file path inside the workspace.",
				),
			content: z.string(),
		}),
		permissions: { network: [], filesystem: [rootDir] },
		sensitive: true,
		async run({ path: requestedPath, content }, ctx) {
			const filePath = resolveWorkspacePath(rootDir, requestedPath);
			await ctx.writeFile(filePath, content);
			return { path: filePath, bytesWritten: content.length };
		},
	});
}

export function createWorkspaceFileReadRangeSkill(rootDir: string) {
	return defineSkill({
		id: "workspace_file_read_range",
		name: "Read workspace file range",
		description:
			"Read a line range from a workspace text file. Use this when you only need a focused section before editing.",
		inputSchema: z.object({
			path: z.string().describe("Workspace-relative or absolute file path."),
			startLine: z.number().int().min(1),
			endLine: z.number().int().min(1),
		}),
		permissions: { network: [], filesystem: [rootDir] },
		sensitive: false,
		async run({ path: requestedPath, startLine, endLine }, ctx) {
			const filePath = resolveWorkspacePath(rootDir, requestedPath);
			const content = await ctx.readFile(filePath);
			const lines = content.split("\n");
			return {
				path: filePath,
				startLine,
				endLine,
				content: lines.slice(startLine - 1, endLine).join("\n"),
			};
		},
	});
}

export function createWorkspaceFileStatSkill(rootDir: string) {
	return defineSkill({
		id: "workspace_file_stat",
		name: "Stat workspace path",
		description:
			"Inspect a workspace file or directory for size and modification time before or after edits.",
		inputSchema: z.object({
			path: z.string().describe("Workspace-relative or absolute path."),
		}),
		permissions: { network: [], filesystem: [rootDir] },
		sensitive: false,
		async run({ path: requestedPath }, ctx) {
			const filePath = resolveWorkspacePath(rootDir, requestedPath);
			return ctx.statPath(filePath);
		},
	});
}

export function createWorkspaceFileAppendSkill(rootDir: string) {
	return defineSkill({
		id: "workspace_file_append",
		name: "Append workspace file",
		description:
			"Append text to an existing workspace file or create it if missing.",
		inputSchema: z.object({
			path: z.string().describe("Workspace-relative or absolute file path."),
			content: z.string(),
		}),
		permissions: { network: [], filesystem: [rootDir] },
		sensitive: true,
			async run({ path: requestedPath, content }, ctx) {
				const filePath = resolveWorkspacePath(rootDir, requestedPath);
				await ctx.appendFile(filePath, content);
				const { path: _ignoredPath, ...stats } = await ctx.statPath(filePath);
				return { path: filePath, bytesAppended: content.length, ...stats };
		},
	});
}

export function createWorkspaceFileMoveSkill(rootDir: string) {
	return defineSkill({
		id: "workspace_file_move",
		name: "Move workspace file",
		description:
			"Move or rename a workspace file after related edits are complete.",
		inputSchema: z.object({
			fromPath: z.string().describe("Workspace-relative or absolute source path."),
			toPath: z.string().describe("Workspace-relative or absolute destination path."),
		}),
		permissions: { network: [], filesystem: [rootDir] },
		sensitive: true,
		async run({ fromPath, toPath }, ctx) {
			const resolvedFrom = resolveWorkspacePath(rootDir, fromPath);
			const resolvedTo = resolveWorkspacePath(rootDir, toPath);
			await ctx.moveFile(resolvedFrom, resolvedTo);
			const stats = await ctx.statPath(resolvedTo);
			return { fromPath: resolvedFrom, toPath: resolvedTo, ...stats };
		},
	});
}

export function createWorkspaceFilePatchSkill(rootDir: string) {
	return defineSkill({
		id: "workspace_file_patch",
		name: "Patch workspace file",
		description:
			"Apply targeted ordered edits to a workspace text file using search/replace, line replacement, or anchor insertion.",
		inputSchema: z.object({
			path: z.string().describe("Workspace-relative or absolute file path."),
			createIfMissing: z.boolean().default(false),
			operations: z.array(patchOperationSchema).min(1),
		}),
		permissions: { network: [], filesystem: [rootDir] },
		sensitive: true,
		async run({ path: requestedPath, createIfMissing, operations }, ctx) {
			const filePath = resolveWorkspacePath(rootDir, requestedPath);
			let before = "";
			try {
				before = await ctx.readFile(filePath);
			} catch (error) {
				if (!createIfMissing) throw error;
			}
				const after = applyPatchOperations(before, operations);
				await ctx.writeFile(filePath, after);
				const { path: _ignoredPath, ...stats } = await ctx.statPath(filePath);
				return {
					path: filePath,
				operationsApplied: operations.length,
				diffPreview: buildUnifiedDiffPreview(before, after),
				...stats,
			};
		},
	});
}

export function createWorkspaceFileDeleteSkill(rootDir: string) {
	return defineSkill({
		id: "workspace_file_delete",
		name: "Delete workspace file",
		description:
			"Delete a file from the current workspace. Only use this when the user asked for removal or the change is clearly safe and necessary.",
		inputSchema: z.object({
			path: z
				.string()
				.describe(
					"Workspace-relative or absolute file path inside the workspace.",
				),
		}),
		permissions: { network: [], filesystem: [rootDir] },
		sensitive: true,
		async run({ path: requestedPath }, ctx) {
			const filePath = resolveWorkspacePath(rootDir, requestedPath);
			await ctx.deleteFile(filePath);
			return { path: filePath, deleted: true };
		},
	});
}
