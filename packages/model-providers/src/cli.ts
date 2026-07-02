import type { ChatMessageInput } from "./stream";

/** The narrow subset of an AI SDK `streamText()` result that its actual
 * callers use — `chat-stream.ts` iterates `fullStream`,
 * `agent-runtime.ts` uses `text`/`textStream` for automations. Letting
 * `streamChat()` return this instead of the full AI SDK result type lets a
 * CLI-spawned provider produce a compatible value without implementing the
 * AI SDK's `LanguageModel` interface (doGenerate/doStream) at all. */
export type ChatStreamPart =
	| { type: "text-delta"; text: string }
	| { type: "reasoning-delta"; text: string }
	| { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
	| { type: "tool-result"; toolCallId: string; toolName: string; output: unknown }
	| { type: "tool-error"; toolCallId: string; toolName: string; error: unknown };

export interface ChatStreamResult {
	fullStream: AsyncIterable<ChatStreamPart>;
	textStream: AsyncIterable<string>;
	text: Promise<string>;
}

/** "restricted" is used for every chat tool mode except "auto" — it must
 * never let the spawned CLI edit files or run commands without asking,
 * since there's no human on the other end of a headless `-p`/`exec` process
 * to answer a permission prompt. "auto" mirrors the app's own AUTO tool mode
 * (chat-stream.ts's CHAT_MODE_GUIDANCE.auto): the CLI gets full, unattended
 * read/write/exec access in the chat's working directory. */
export type CliPermissionMode = "restricted" | "auto";

/** Sentinel `nativeModelId` value (same as an empty string) meaning "omit
 * `--model` and let the CLI use whatever it's configured for" — the only
 * choice guaranteed to work regardless of the CLI's auth method. See
 * `CODEX_CLI_DEFAULT_MODELS` in providers.ts for why specific model names
 * can't be safely hardcoded as a default. */
export const CLI_DEFAULT_MODEL_SENTINEL = "default";

function modelFlagArgs(nativeModelId: string): string[] {
	return nativeModelId && nativeModelId !== CLI_DEFAULT_MODEL_SENTINEL
		? ["--model", nativeModelId]
		: [];
}

export interface CliStreamOptions {
	/** Resolved binary path/name, e.g. "claude" or "/usr/local/bin/codex". */
	binary: string;
	/** Empty string or CLI_DEFAULT_MODEL_SENTINEL means "use the CLI's own
	 * configured default model". */
	nativeModelId: string;
	cwd: string;
	systemPrompt?: string;
	messages: ChatMessageInput[];
	permissionMode: CliPermissionMode;
	onFinish?: (event: { text: string }) => void | Promise<void>;
	onError?: (event: { error: unknown }) => void;
	abortSignal?: AbortSignal;
}

function contentToPlainText(content: ChatMessageInput["content"]): string {
	if (typeof content === "string") return content;
	return content
		.map((part) => {
			if (part.type === "text") return part.text;
			if (part.type === "image") return "[image attachment omitted — CLI providers are text-only]";
			return `[file attachment omitted: ${part.filename ?? part.mediaType}]`;
		})
		.join("\n");
}

/** Both CLIs are single-shot "exec" invocations with no memory of earlier
 * turns, so prior chat history has to be flattened into one prompt string
 * fed over stdin (not passed as an argv string — avoids shell/arg-length
 * limits entirely). */
function composePrompt(systemPrompt: string | undefined, messages: ChatMessageInput[]): string {
	const sections: string[] = [];
	if (systemPrompt) sections.push(`System instructions:\n${systemPrompt}`);
	for (const message of messages) {
		const text = contentToPlainText(message.content);
		if (!text.trim()) continue;
		const speaker = message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : "System";
		sections.push(`${speaker}: ${text}`);
	}
	return sections.join("\n\n");
}

interface SpawnedCliProcess {
	proc: ReturnType<typeof Bun.spawn>;
	lines: AsyncIterable<string>;
	stderrPromise: Promise<string>;
}

function spawnCli(binary: string, args: string[], cwd: string, prompt: string): SpawnedCliProcess {
	const proc = Bun.spawn([binary, ...args], {
		cwd,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});

	const stdin = proc.stdin;
	if (stdin && typeof stdin !== "number") {
		// A real composed system prompt (workspace instructions + agent prompt +
		// mode guidance) easily runs 10-20KB — writing it without awaiting
		// `flush()` before `end()` let `end()` race the write for anything past
		// a few KB, silently truncating the prompt the CLI ever saw. Codex then
		// hung waiting for input that already looked closed; the fix mirrors
		// terminal.ts's send-input tool, which already awaits `flush()`.
		stdin.write(prompt);
		void (async () => {
			await stdin.flush();
			await stdin.end();
		})();
	}

	async function* readLines(): AsyncIterable<string> {
		const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex);
				buffer = buffer.slice(newlineIndex + 1);
				if (line.trim()) yield line;
				newlineIndex = buffer.indexOf("\n");
			}
		}
		if (buffer.trim()) yield buffer;
	}

	async function drainStderr(): Promise<string> {
		const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
		const decoder = new TextDecoder();
		let text = "";
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			text += decoder.decode(value, { stream: true });
		}
		return text;
	}

	return { proc, lines: readLines(), stderrPromise: drainStderr() };
}

function tryParseJsonLine(line: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(line);
		return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** Maps one parsed Claude Code `--output-format stream-json` NDJSON event to
 * zero or more stream parts. Schema per Claude Code's headless/SDK output —
 * verify against the installed CLI version; an event this doesn't recognize
 * falls through untouched (see the raw-line fallback in `runCli`). */
function mapClaudeEvent(event: Record<string, unknown>): ChatStreamPart[] {
	const parts: ChatStreamPart[] = [];
	if (event.type === "assistant" || event.type === "user") {
		const message = event.message as { content?: unknown[] } | undefined;
		const content = Array.isArray(message?.content) ? message.content : [];
		for (const block of content) {
			if (typeof block !== "object" || block === null) continue;
			const b = block as Record<string, unknown>;
			if (b.type === "text" && typeof b.text === "string") {
				parts.push({ type: "text-delta", text: b.text });
			} else if (b.type === "tool_use") {
				parts.push({
					type: "tool-call",
					toolCallId: String(b.id ?? ""),
					toolName: String(b.name ?? "tool"),
					input: b.input,
				});
			} else if (b.type === "tool_result") {
				parts.push({
					type: "tool-result",
					toolCallId: String(b.tool_use_id ?? ""),
					toolName: "tool",
					output: b.content,
				});
			}
		}
	} else if (event.type === "result" && event.is_error === true) {
		// A turn-level failure (e.g. hit max turns, execution error) surfaces
		// here instead of inside an assistant message block — without this
		// branch it silently produced zero parts, so a mid-turn Claude failure
		// rendered as an empty reply instead of an explanation.
		const message = typeof event.result === "string" && event.result ? event.result : "Claude CLI run failed.";
		parts.push({ type: "text-delta", text: `⚠ ${message}` });
	}
	return parts;
}

/** Codex's `error.message` is itself a JSON-encoded API error body (e.g.
 * `{"type":"error","status":400,"error":{"message":"..."}}`) rather than a
 * plain string — unwrap it to the human-readable message when possible. */
function extractCodexErrorMessage(rawMessage: string): string {
	try {
		const parsed = JSON.parse(rawMessage);
		const nested = parsed?.error?.message;
		return typeof nested === "string" && nested ? nested : rawMessage;
	} catch {
		return rawMessage;
	}
}

/** Maps one parsed Codex `exec --json` NDJSON event. Schema per Codex CLI's
 * experimental JSON exec output — verify against the installed CLI version. */
function mapCodexEvent(event: Record<string, unknown>): ChatStreamPart[] {
	const parts: ChatStreamPart[] = [];
	if (event.type === "item.completed") {
		const item = event.item as Record<string, unknown> | undefined;
		if (!item) return parts;
		if (item.type === "agent_message" && typeof item.text === "string") {
			parts.push({ type: "text-delta", text: item.text });
		} else if (item.type === "command_execution") {
			const id = String(item.id ?? item.call_id ?? "");
			parts.push({
				type: "tool-call",
				toolCallId: id,
				toolName: "command_execution",
				input: { command: item.command },
			});
			parts.push({
				type: "tool-result",
				toolCallId: id,
				toolName: "command_execution",
				output: { output: item.aggregated_output, exitCode: item.exit_code },
			});
		}
	} else if (event.type === "error" && typeof event.message === "string") {
		// A turn-level failure (bad model id, rate limit, etc.), not tied to any
		// specific tool call. Emitting this as a "tool-error" with no matching
		// prior "tool-call" id meant the client silently dropped it (steps only
		// get created by a tool-call event, never by tool-result/tool-error) —
		// the chat just showed an empty reply. Text-delta always renders.
		parts.push({ type: "text-delta", text: `⚠ ${extractCodexErrorMessage(event.message)}` });
	}
	return parts;
}

async function* runCli(
	kind: "claude" | "codex",
	opts: CliStreamOptions,
	buildArgs: (opts: CliStreamOptions) => string[],
	mapEvent: (event: Record<string, unknown>) => ChatStreamPart[],
): AsyncGenerator<ChatStreamPart> {
	const prompt = composePrompt(opts.systemPrompt, opts.messages);
	const args = buildArgs(opts);
	const { proc, lines, stderrPromise } = spawnCli(opts.binary, args, opts.cwd, prompt);

	opts.abortSignal?.addEventListener("abort", () => proc.kill(), { once: true });

	let finalText = "";
	let sawAnyPart = false;
	// Both CLIs emit one *complete* text block per turn (not token deltas) —
	// a fresh "assistant"/"item.completed" event after a tool call starts a
	// new block with no boundary of its own. Without a separator here, the
	// client's `full += event.text` concatenation runs two sentences
	// together with no space (e.g. "...server code.Read chat-stream...").
	let sawToolSinceText = false;
	// Every real NDJSON event line carries an id unique to that event (Claude
	// Code stamps a "uuid" on each; Codex's "item.completed" events carry a
	// stable item id) — a byte-identical line appearing again in the stream
	// is a CLI-side replay (observed after transient mid-turn retries), not a
	// new event. Re-mapping it would re-emit the same tool-call/tool-result
	// pair with the same id, duplicating that whole exchange in the SSE
	// stream the client renders.
	const seenLines = new Set<string>();

	try {
		for await (const line of lines) {
			const event = tryParseJsonLine(line);
			if (event) {
				if (seenLines.has(line)) continue;
				seenLines.add(line);
			}
			const parts = event ? mapEvent(event) : [{ type: "text-delta" as const, text: line }];
			for (let part of parts) {
				sawAnyPart = true;
				if (part.type === "tool-call" || part.type === "tool-result" || part.type === "tool-error") {
					sawToolSinceText = true;
				} else if ((part.type === "text-delta" || part.type === "reasoning-delta") && part.text) {
					if (sawToolSinceText) {
						part = { ...part, text: `\n\n${part.text}` };
						sawToolSinceText = false;
					}
					if (part.type === "text-delta") finalText += part.text;
				}
				yield part;
			}
		}

		const exitCode = await proc.exited;
		if (exitCode !== 0) {
			const stderr = await stderrPromise;
			const error = new Error(
				`${kind} CLI exited with code ${exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
			);
			opts.onError?.({ error });
			if (!sawAnyPart) throw error;
		}
	} finally {
		await opts.onFinish?.({ text: finalText });
	}
}

/** `runCli()` only spawns the process once its returned generator is first
 * iterated (spawning happens inside the `async function*` body, which
 * doesn't run until `.next()` is called) — so it's safe to hand out
 * independent generator instances per property here: whichever one the
 * caller actually reads (`fullStream` for interactive chat, `textStream`/
 * `text` for background automations) triggers exactly one spawn. `text` and
 * `textStream` are lazy getters rather than plain properties for the same
 * reason: an `async function` (unlike an `async function*`) runs
 * synchronously up to its first `await`, which would spawn the process
 * immediately on object construction if `text` were assigned eagerly. */
function buildCliChatStreamResult(
	kind: "claude" | "codex",
	opts: CliStreamOptions,
	buildArgs: (opts: CliStreamOptions) => string[],
	mapEvent: (event: Record<string, unknown>) => ChatStreamPart[],
): ChatStreamResult {
	async function* textStream(): AsyncGenerator<string> {
		for await (const part of runCli(kind, opts, buildArgs, mapEvent)) {
			if (part.type === "text-delta") yield part.text;
		}
	}

	async function collectText(): Promise<string> {
		let text = "";
		for await (const chunk of textStream()) text += chunk;
		return text;
	}

	return {
		fullStream: runCli(kind, opts, buildArgs, mapEvent),
		get textStream() {
			return textStream();
		},
		get text() {
			return collectText();
		},
	};
}

export function streamClaudeCli(opts: CliStreamOptions): ChatStreamResult {
	return buildCliChatStreamResult(
		"claude",
		opts,
		(o) => [
			"-p",
			"--output-format",
			"stream-json",
			"--verbose",
			...modelFlagArgs(o.nativeModelId),
			"--permission-mode",
			o.permissionMode === "auto" ? "bypassPermissions" : "plan",
		],
		mapClaudeEvent,
	);
}

export function streamCodexCli(opts: CliStreamOptions): ChatStreamResult {
	return buildCliChatStreamResult(
		"codex",
		opts,
		(o) => [
			"exec",
			"--json",
			"--skip-git-repo-check",
			...modelFlagArgs(o.nativeModelId),
			// `codex exec --help` (v0.120.0) has no `--ask-for-approval` flag —
			// only `-c approval_policy=<value>` and `--sandbox`. "auto" gets a
			// sandboxed-but-unattended run; "restricted" stays read-only, which
			// needs no approval policy override since it can't touch anything
			// outside the sandbox.
			...(o.permissionMode === "auto"
				? ["--sandbox", "workspace-write", "-c", "approval_policy=never"]
				: ["--sandbox", "read-only"]),
		],
		mapCodexEvent,
	);
}
