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

export type ChatMessageContentPart = MessageTextPart | MessageImagePart | MessageFilePart;

/** Token accounting for one generation, normalized from the AI SDK's
 * `LanguageModelUsage` — see chat-stream.ts for how this feeds the detailed
 * statistics dashboard. */
export interface ChatStreamUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  totalTokens?: number;
}

export interface ChatMessageInput {
  role: "user" | "assistant" | "system";
  content: string | ChatMessageContentPart[];
}

/** How hard the model should think before answering. Maps onto Anthropic's
 * extended-thinking token budget and OpenAI's reasoning effort; silently a
 * no-op for providers without a reasoning knob (local OpenAI-compatible
 * runtimes still surface whatever reasoning deltas they emit on their own). */
export type ReasoningEffort = "low" | "medium" | "high";

const ANTHROPIC_THINKING_BUDGET_TOKENS: Record<ReasoningEffort, number> = {
  low: 4_000,
  medium: 12_000,
  high: 24_000,
};

/** Multi-step tool loops previously hard-stopped at 5 steps, which silently
 * truncated any genuinely agentic task (read → plan → edit → verify → retry
 * easily exceeds it). 12 keeps runaway loops bounded while giving autonomous
 * runs room to actually finish. */
const DEFAULT_MAX_TOOL_STEPS = 12;

/** Applied whenever a caller doesn't set `maxOutputTokens` explicitly — see
 * the field doc on StreamChatInput. Exported so callers that need to
 * *predict* a call's cost before making it (autonomy-budget.ts's cost
 * preflight) use the exact same default this module actually applies,
 * rather than a duplicated magic number that could drift out of sync. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;

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
   * actually finishing rather than racing it. `usage` is undefined for
   * claude_cli/codex_cli models — those CLIs don't report token counts. */
  onFinish?: (event: { text: string; usage?: ChatStreamUsage }) => void | Promise<void>;
  /** Called if the model/provider throws mid-stream — without this, a
   * failure after the first token would otherwise vanish silently from the
   * caller's perspective (the HTTP response is already streaming). */
  onError?: (event: { error: unknown }) => void;
  /** Lets a caller cancel an in-flight generation (e.g. a "Stop agent"
   * action) — forwarded straight to the AI SDK's own abortSignal support. */
  abortSignal?: AbortSignal;
  /** Opt-in extended thinking/reasoning — see ReasoningEffort. */
  reasoningEffort?: ReasoningEffort;
  /** Caps the agentic tool loop (model → tool → model …) for this call.
   * Defaults to DEFAULT_MAX_TOOL_STEPS; only meaningful when tools are set. */
  maxToolSteps?: number;
  /** Caps generated output tokens for this call. Defaults to
   * DEFAULT_MAX_OUTPUT_TOKENS — without an explicit cap, some providers
   * (OpenRouter in particular) size the request against the model's full
   * context window, which can demand far more prepaid credits than a
   * normal reply needs and 402s accounts that can't cover it. */
  maxOutputTokens?: number;
  /** Sampling controls forwarded as-is to the AI SDK — no-ops for
   * claude_cli/codex_cli models, which don't take sampling params. */
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
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

/** Translates the effort level into the provider-specific reasoning option.
 * Returns undefined for providers without a reasoning parameter so the
 * request stays byte-identical to today's behavior there. */
function buildReasoningProviderOptions(
  modelId: string,
  installedProviders: InstalledModelProvider[],
  effort: ReasoningEffort | undefined,
): Record<string, Record<string, unknown>> | undefined {
  if (!effort) return undefined;

  const installedKind = findInstalledProvider(modelId, installedProviders)?.providerKind;
  const prefix = modelId.split("/")[0] ?? "";
  const kind = installedKind ?? (prefix === "anthropic" ? "anthropic" : null);

  if (kind === "anthropic") {
    return {
      anthropic: {
        thinking: {
          type: "enabled",
          budgetTokens: ANTHROPIC_THINKING_BUDGET_TOKENS[effort],
        },
      },
    };
  }
  if (kind === "openai") {
    return { openai: { reasoningEffort: effort } };
  }
  return undefined;
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
  const firstUserIndex = messages.findIndex((message) => message.role === "user");
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
  reasoningEffort,
  maxToolSteps,
  maxOutputTokens,
  temperature,
  topP,
  frequencyPenalty,
  presencePenalty,
  stopSequences,
}: StreamChatInput): ChatStreamResult {
  const resolvedInstalledProviders = installedProviders ?? [];

  const installed = parseInstalledModelId(modelId, resolvedInstalledProviders);
  if (
    installed?.provider.providerKind === "claude_cli" ||
    installed?.provider.providerKind === "codex_cli"
  ) {
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
    systemPrompt && shouldInlineSystemPrompt(modelId, resolvedInstalledProviders)
      ? systemPrompt
      : undefined;
  const preparedMessages = inlineSystemPrompt
    ? inlineSystemPromptIntoMessages(messages, inlineSystemPrompt)
    : messages;
  const providerOptions = buildReasoningProviderOptions(
    modelId,
    resolvedInstalledProviders,
    reasoningEffort,
  );

  return streamText({
    model,
    system: inlineSystemPrompt ? undefined : systemPrompt,
    messages: preparedMessages,
    tools,
    abortSignal,
    maxOutputTokens: maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { topP } : {}),
    ...(frequencyPenalty !== undefined ? { frequencyPenalty } : {}),
    ...(presencePenalty !== undefined ? { presencePenalty } : {}),
    ...(stopSequences?.length ? { stopSequences } : {}),
    ...(providerOptions ? { providerOptions } : {}),
    // Without this, streamText stops right after a tool call instead of
    // continuing on to produce a final answer from the tool's result.
    ...(tools ? { stopWhen: stepCountIs(maxToolSteps ?? DEFAULT_MAX_TOOL_STEPS) } : {}),
    ...(onFinish
      ? {
          onFinish: (event: any) =>
            onFinish({
              text: event.text,
              usage: {
                inputTokens: event.usage?.inputTokens,
                outputTokens: event.usage?.outputTokens,
                reasoningTokens: event.usage?.outputTokenDetails?.reasoningTokens,
                cacheReadTokens: event.usage?.inputTokenDetails?.cacheReadTokens,
                totalTokens: event.usage?.totalTokens,
              },
            }),
        }
      : {}),
    ...(onError ? { onError: (event: any) => onError({ error: event.error }) } : {}),
  } as any) as unknown as ChatStreamResult;
}
