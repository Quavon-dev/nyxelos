import path from "node:path";
import type { ToolRecord } from "@nyxel/db";
import { createSkillContext, type SkillDefinition } from "@nyxel/skills-sdk";
import { z } from "zod";
import { allowedDirsFromConfig, baseFields } from "./shared";
import { getLastCommand, getTerminalSession, runCommandToCompletion } from "./terminal";

const IMAGE_MIME_BY_EXT: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
};

export function buildFileStatTool(record: ToolRecord): SkillDefinition {
	const allowedDirs = allowedDirsFromConfig(record.config ?? {});
	return {
		...baseFields(record),
		inputSchema: z.object({ path: z.string() }),
		permissions: { network: [], filesystem: allowedDirs },
		async run({ path: filePath }) {
			const ctx = createSkillContext({ network: [], filesystem: allowedDirs });
			return ctx.statPath(filePath);
		},
	};
}

export function buildFileViewImageTool(record: ToolRecord): SkillDefinition {
	const allowedDirs = allowedDirsFromConfig(record.config ?? {});
	return {
		...baseFields(record),
		inputSchema: z.object({ path: z.string() }),
		permissions: { network: [], filesystem: allowedDirs },
		async run({ path: filePath }) {
			// Images are binary — skills-sdk's readFile/SkillContext only exposes
			// utf-8 text reads, so this goes through raw fs directly, still gated
			// by the same allow-listed directories (same check readFile itself
			// uses) rather than skipping permission enforcement.
			const resolved = path.resolve(filePath);
			const allowed = allowedDirs.some(
				(dir) => resolved === dir || resolved.startsWith(`${dir}/`),
			);
			if (!allowed) {
				throw new Error(
					`"${resolved}" isn't in this tool's declared filesystem permissions.`,
				);
			}
			const { readFile } = await import("node:fs/promises");
			const buffer = await readFile(resolved);
			const mimeType = IMAGE_MIME_BY_EXT[path.extname(resolved).toLowerCase()] ??
				"application/octet-stream";
			return {
				path: resolved,
				mimeType,
				base64: buffer.toString("base64"),
				bytes: buffer.length,
			};
		},
	};
}

export function buildNotebookSummaryTool(record: ToolRecord): SkillDefinition {
	const allowedDirs = allowedDirsFromConfig(record.config ?? {});
	return {
		...baseFields(record),
		inputSchema: z.object({ path: z.string() }),
		permissions: { network: [], filesystem: allowedDirs },
		async run({ path: filePath }) {
			const ctx = createSkillContext({ network: [], filesystem: allowedDirs });
			const notebook = JSON.parse(await ctx.readFile(filePath)) as {
				cells: { cell_type: string; source: string[] }[];
			};
			return {
				path: filePath,
				cells: notebook.cells.map((cell, index) => ({
					index,
					cellType: cell.cell_type,
					firstLine: cell.source[0]?.slice(0, 200) ?? "",
				})),
			};
		},
	};
}

export function buildNotebookCellOutputTool(record: ToolRecord): SkillDefinition {
	const allowedDirs = allowedDirsFromConfig(record.config ?? {});
	return {
		...baseFields(record),
		inputSchema: z.object({ path: z.string(), index: z.number().int().min(0) }),
		permissions: { network: [], filesystem: allowedDirs },
		async run({ path: filePath, index }) {
			const ctx = createSkillContext({ network: [], filesystem: allowedDirs });
			const notebook = JSON.parse(await ctx.readFile(filePath)) as {
				cells: { outputs?: unknown[] }[];
			};
			const cell = notebook.cells[index];
			if (!cell) throw new Error(`Cell index ${index} out of range.`);
			return { path: filePath, index, outputs: cell.outputs ?? [] };
		},
	};
}

export function buildTerminalLastCommandTool(record: ToolRecord): SkillDefinition {
	return {
		...baseFields(record),
		inputSchema: z.object({}),
		permissions: { network: [], filesystem: [] },
		async run() {
			return getLastCommand() ?? { command: null, execId: null };
		},
	};
}

export function buildTerminalOutputTool(record: ToolRecord): SkillDefinition {
	return {
		...baseFields(record),
		inputSchema: z.object({ execId: z.string() }),
		permissions: { network: [], filesystem: [] },
		async run({ execId }) {
			const session = getTerminalSession(execId);
			if (!session) throw new Error(`Unknown terminal execId: ${execId}`);
			// Same tail-slice cap terminal_run/task_run/test_run already apply to
			// their own output — a long-running session's full buffer (up to
			// MAX_BUFFERED_CHARS in terminal.ts) shouldn't go straight into the
			// model's context uncapped just because it's read back separately.
			return {
				execId,
				status: session.status,
				exitCode: session.exitCode,
				output: session.output.slice(-8000),
			};
		},
	};
}

/** Runs the workspace's own type-checker/linter and parses its output into a
 * flat list — see the plan's "Explicitly out of scope" note: this is
 * `tsc --noEmit` (or a configured command) read after the fact, not a live
 * language-server diagnostics feed. */
export function buildProblemsTool(record: ToolRecord): SkillDefinition {
	const configuredCommand =
		typeof record.config?.command === "string" && record.config.command
			? record.config.command
			: "tsc --noEmit";
	return {
		...baseFields(record),
		inputSchema: z.object({ cwd: z.string().optional() }),
		permissions: { network: [], filesystem: [] },
		async run({ cwd }) {
			const { output, exitCode, timedOut } = await runCommandToCompletion(
				configuredCommand,
				cwd,
				30_000,
			);
			const problems = output
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => /:\d+:\d+/.test(line))
				.slice(0, 200);
			return { command: configuredCommand, exitCode, timedOut, problems, rawOutput: output.slice(-4000) };
		},
	};
}
