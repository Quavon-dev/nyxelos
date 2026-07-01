import { stepCountIs, streamText, type ToolSet } from "ai";
import type { ChatStreamResult } from "./cli";
import { streamClaudeCli, streamCodexCli } from "./cli";
import { type InstalledModelProvider, parseInstalledModelId, resolveModel } from "./providers";

export interface MessageTextPart {
	type: "text";
	text: string;
}

export interface MessageImagePart {
	type: "image";
	image: string | URL;
	mediaType?: string;
}

export interface MessageFilePart {
	type: "file";
	data: string | URL;
	mediaType: string;
	filename?: string;
}

export type ChatMessageContentPart =
	| MessageTextPart
	| MessageImagePart
	| MessageFilePart;

export interface ChatMessageInput {
	role: "user" | "assistant" | "system";
	content: string | ChatMessageContentPart[];
}

export interface StreamChatInput {
	modelId: string;
	messages: ChatMessageInput[];
	systemPrompt?: string;
	installedProviders?: InstalledModelProvider[];
	/** Skills/MCP tools built by the caller (apps/server) — this package only
	 * knows how to talk to models, not what a "skill" or "MCP server" is.
	 * Ignored for claude_cli/codex_cli models: those CLIs bring their own
	 * file/shell tools instead (see cli.ts). */
	tools?: ToolSet;
	/** Only used by claude_cli/codex_cli models — the directory the spawned
	 * CLI runs its own file/shell tools in. Required for those model kinds. */
	cwd?: string;
	/** Only used by claude_cli/codex_cli models — "auto" (the chat's AUTO
	 * tool mode) grants the CLI unattended write/exec access; anything else
	 * runs it in a read-only/plan mode since there's no human to answer a
	 * permission prompt in a headless process. */
	toolMode?: "default" | "automatic" | "auto";
	/** Called once the full response text is available — the AI SDK awaits
	 * this as part of the stream's own lifecycle (unlike a detached `.then()`
	 * on `result.text`), so persistence side effects are tied to the request
	 * actually finishing rather than racing it. */
	onFinish?: (event: { text: string }) => void | Promise<void>;
	/** Called if the model/provider throws mid-stream — without this, a
	 * failure after the first token would otherwise vanish silently from the
	 * caller's perspective (the HTTP response is already streaming). */
	onError?: (event: { error: unknown }) => void;
	/** Lets a caller cancel an in-flight generation (e.g. a "Stop agent"
	 * action) — forwarded straight to the AI SDK's own abortSignal support. */
	abortSignal?: AbortSignal;
}

const INLINE_SYSTEM_PROMPT_MODEL_PREFIXES = new Set([
	"jan",
	"llamacpp",
	"lmstudio",
	"localai",
	"ollama",
	"textgen",
	"vllm",
]);

function findInstalledProvider(
	modelId: string,
	installedProviders: InstalledModelProvider[],
): InstalledModelProvider | null {
	return parseInstalledModelId(modelId, installedProviders)?.provider ?? null;
}

function shouldInlineSystemPrompt(
	modelId: string,
	installedProviders: InstalledModelProvider[],
): boolean {
	const installedProvider = findInstalledProvider(modelId, installedProviders);
	if (installedProvider) {
		return installedProvider.providerKind === "openai_compatible";
	}

	const prefix = modelId.split("/")[0] ?? "";
	return INLINE_SYSTEM_PROMPT_MODEL_PREFIXES.has(prefix);
}

function inlineSystemPromptIntoMessages(
	messages: ChatMessageInput[],
	systemPrompt: string,
): ChatMessageInput[] {
	const firstUserIndex = messages.findIndex(
		(message) => message.role === "user",
	);
	const preamble = [
		"System instructions for this conversation:",
		systemPrompt,
		"User message:",
	].join("\n\n");

	if (firstUserIndex === -1) {
		return [{ role: "user", content: preamble }, ...messages];
	}

	return messages.map((message, index) =>
		index === firstUserIndex
			? {
					...message,
					content:
						typeof message.content === "string"
							? `${preamble}\n\n${message.content}`
							: [{ type: "text" as const, text: preamble }, ...message.content],
				}
			: message,
	);
}

/** Streams a chat completion for the given model. Returns
 * `{ fullStream }` — either the Vercel AI SDK stream result directly (which
 * has a superset of that shape) or, for claude_cli/codex_cli models, a
 * hand-rolled async generator from cli.ts. apps/server's chat-stream.ts only
 * ever reads `.fullStream`, so both branches satisfy the same contract
 * without CLI providers needing to implement the AI SDK's LanguageModel
 * interface. */
export function streamChat({
	modelId,
	messages,
	systemPrompt,
	installedProviders,
	tools,
	cwd,
	toolMode,
	onFinish,
	onError,
	abortSignal,
}: StreamChatInput): ChatStreamResult {
	const resolvedInstalledProviders = installedProviders ?? [];

	const installed = parseInstalledModelId(modelId, resolvedInstalledProviders);
	if (installed?.provider.providerKind === "claude_cli" || installed?.provider.providerKind === "codex_cli") {
		if (!installed.provider.enabled) {
			throw new Error(`Installed model provider "${installed.provider.label}" is disabled.`);
		}
		if (!cwd) {
			throw new Error(`${installed.provider.providerKind} models require a working directory.`);
		}
		const cliOpts = {
			binary: installed.provider.baseUrl,
			nativeModelId: installed.nativeModelId,
			cwd,
			systemPrompt,
			messages,
			permissionMode: (toolMode === "auto" ? "auto" : "restricted") as "auto" | "restricted",
			onFinish,
			onError,
			abortSignal,
		};
		return installed.provider.providerKind === "claude_cli"
			? streamClaudeCli(cliOpts)
			: streamCodexCli(cliOpts);
	}

	const model = resolveModel(modelId, resolvedInstalledProviders);
	const inlineSystemPrompt =
		systemPrompt &&
		shouldInlineSystemPrompt(modelId, resolvedInstalledProviders)
			? systemPrompt
			: undefined;
	const preparedMessages = inlineSystemPrompt
		? inlineSystemPromptIntoMessages(messages, inlineSystemPrompt)
		: messages;

	return streamText({
		model,
		system: inlineSystemPrompt ? undefined : systemPrompt,
		messages: preparedMessages,
		tools,
		abortSignal,
		// Without this, streamText stops right after a tool call instead of
		// continuing on to produce a final answer from the tool's result.
		...(tools ? { stopWhen: stepCountIs(5) } : {}),
		...(onFinish
			? { onFinish: (event: any) => onFinish({ text: event.text }) }
			: {}),
		...(onError
			? { onError: (event: any) => onError({ error: event.error }) }
			: {}),
	} as any) as unknown as ChatStreamResult;
}
