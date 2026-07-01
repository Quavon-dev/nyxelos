import type { ToolRecord } from "@nyxel/db";
import type { SkillDefinition } from "@nyxel/skills-sdk";
import { z } from "zod";
import { baseFields } from "./shared";

interface TerminalSession {
	proc: ReturnType<typeof Bun.spawn>;
	command: string;
	output: string;
	status: "running" | "exited";
	exitCode: number | null;
	startedAt: Date;
}

/** Process-wide, in-memory only (see the plan's "execute" section) — a
 * server restart clears every running terminal, which is fine since nothing
 * here is meant to survive a restart.
 *
 * Originally built on node-pty for real PTY semantics, but node-pty's output
 * capture (it wraps the pty master fd in Node's `tty.ReadStream`) never
 * fired a single `data` event under Bun in testing, even though the process
 * itself spawned and exited correctly — a runtime-compat gap, not a bug in
 * this file. Bun's own `Bun.spawn` is native to this codebase (already used
 * throughout, e.g. `bun:sqlite`) and its piped stdout/stderr streams are
 * confirmed working, so terminal execution here is now shell-out-with-piped-
 * output rather than a true interactive PTY. That's a fine trade for an
 * agent tool: it cares about captured text, not ANSI cursor control. */
const sessions = new Map<string, TerminalSession>();
let lastCommand: { command: string; execId: string } | null = null;
let nextId = 1;

const MAX_BUFFERED_CHARS = 200_000;
const shell = process.platform === "win32" ? "powershell.exe" : "/bin/sh";

async function pumpStream(session: TerminalSession, stream: ReadableStream<Uint8Array>) {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		session.output += decoder.decode(value, { stream: true });
		if (session.output.length > MAX_BUFFERED_CHARS) {
			session.output = session.output.slice(-MAX_BUFFERED_CHARS);
		}
	}
}

function spawnSession(command: string, cwd: string | undefined): string {
	const execId = `term_${nextId++}`;
	const proc = Bun.spawn([shell, "-c", command], {
		cwd: cwd ?? process.cwd(),
		env: process.env as Record<string, string>,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	const session: TerminalSession = {
		proc,
		command,
		output: "",
		status: "running",
		exitCode: null,
		startedAt: new Date(),
	};
	sessions.set(execId, session);
	lastCommand = { command, execId };

	void pumpStream(session, proc.stdout as ReadableStream<Uint8Array>);
	void pumpStream(session, proc.stderr as ReadableStream<Uint8Array>);
	void proc.exited.then((exitCode) => {
		session.status = "exited";
		session.exitCode = exitCode;
	});

	return execId;
}

/** Waits up to `timeoutMs` for the process to either finish or just
 * accumulate some initial output, whichever comes first — long-running
 * commands (dev servers, watch tasks) are meant to keep running in the
 * background; get_terminal_output/terminal_output reads more later. */
function waitForInitialOutput(execId: string, timeoutMs: number): Promise<void> {
	return new Promise((resolve) => {
		const start = Date.now();
		const interval = setInterval(() => {
			const session = sessions.get(execId);
			if (!session || session.status === "exited" || Date.now() - start > timeoutMs) {
				clearInterval(interval);
				resolve();
			}
		}, 150);
	});
}

export function getTerminalSession(execId: string): TerminalSession | undefined {
	return sessions.get(execId);
}

export function getLastCommand() {
	return lastCommand;
}

/** Runs a command to completion (or until `timeoutMs` elapses, whichever
 * comes first) and returns its full buffered output — used by read.ts's
 * `problems` tool (`tsc --noEmit` et al.), which needs the whole result
 * rather than a snapshot of "whatever's ready so far". */
export async function runCommandToCompletion(
	command: string,
	cwd: string | undefined,
	timeoutMs: number,
): Promise<{ output: string; exitCode: number | null; timedOut: boolean }> {
	const execId = spawnSession(command, cwd);
	const start = Date.now();
	await new Promise<void>((resolve) => {
		const interval = setInterval(() => {
			const session = sessions.get(execId);
			if (!session || session.status === "exited" || Date.now() - start > timeoutMs) {
				clearInterval(interval);
				resolve();
			}
		}, 150);
	});
	const session = sessions.get(execId);
	const timedOut = session?.status === "running";
	if (timedOut) session?.proc.kill();
	return {
		output: session?.output ?? "",
		exitCode: session?.exitCode ?? null,
		timedOut,
	};
}

/** Category: execute. terminal_run's config is empty (the command comes from
 * the model at call time); task_run/test_run are meant to be created as
 * workspace tools with a fixed `config.command`, so an agent can run "the
 * configured test suite" without being trusted to construct a shell command
 * itself. */
export function buildTerminalRunTool(record: ToolRecord): SkillDefinition {
	return {
		...baseFields(record),
		inputSchema: z.object({
			command: z.string().min(1),
			cwd: z.string().optional(),
		}),
		permissions: { network: [], filesystem: [] },
		async run({ command, cwd }) {
			const execId = spawnSession(command, cwd);
			await waitForInitialOutput(execId, 1500);
			const session = sessions.get(execId);
			return {
				execId,
				status: session?.status ?? "running",
				exitCode: session?.exitCode ?? null,
				output: (session?.output ?? "").slice(-4000),
			};
		},
	};
}

function buildConfiguredCommandTool(record: ToolRecord): SkillDefinition {
	const configuredCommand =
		typeof record.config?.command === "string" ? record.config.command : "";
	return {
		...baseFields(record),
		inputSchema: z.object({ cwd: z.string().optional() }),
		permissions: { network: [], filesystem: [] },
		async run({ cwd }) {
			if (!configuredCommand) {
				throw new Error(
					`"${record.name}" has no command configured (config.command is empty).`,
				);
			}
			const execId = spawnSession(configuredCommand, cwd);
			await waitForInitialOutput(execId, 4000);
			const session = sessions.get(execId);
			return {
				execId,
				command: configuredCommand,
				status: session?.status ?? "running",
				exitCode: session?.exitCode ?? null,
				output: (session?.output ?? "").slice(-8000),
			};
		},
	};
}

export const buildTaskRunTool = buildConfiguredCommandTool;
export const buildTestRunTool = buildConfiguredCommandTool;

export function buildTerminalSendInputTool(record: ToolRecord): SkillDefinition {
	return {
		...baseFields(record),
		inputSchema: z.object({ execId: z.string(), input: z.string() }),
		permissions: { network: [], filesystem: [] },
		async run({ execId, input }) {
			const session = sessions.get(execId);
			if (!session) throw new Error(`Unknown terminal execId: ${execId}`);
			const writer = session.proc.stdin;
			if (writer && typeof writer !== "number") {
				writer.write(input);
				await writer.flush();
			}
			return { execId, sent: true };
		},
	};
}

export function buildTerminalKillTool(record: ToolRecord): SkillDefinition {
	return {
		...baseFields(record),
		inputSchema: z.object({ execId: z.string() }),
		permissions: { network: [], filesystem: [] },
		async run({ execId }) {
			const session = sessions.get(execId);
			if (!session) throw new Error(`Unknown terminal execId: ${execId}`);
			session.proc.kill();
			return { execId, killed: true };
		},
	};
}
