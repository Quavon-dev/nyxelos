import path from "node:path";
import { z } from "zod";
import { defineSkill } from "../define-skill";

function resolveWorkspacePath(rootDir: string, requestedPath: string) {
	return path.isAbsolute(requestedPath)
		? requestedPath
		: path.join(rootDir, requestedPath);
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
