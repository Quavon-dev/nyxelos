import { stepCountIs, streamText, type ToolSet } from "ai";
import { type InstalledModelProvider, resolveModel } from "./providers";

export interface ChatMessageInput {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface StreamChatInput {
  modelId: string;
  messages: ChatMessageInput[];
  systemPrompt?: string;
  installedProviders?: InstalledModelProvider[];
  /** Skills/MCP tools built by the caller (apps/server) — this package only
   * knows how to talk to models, not what a "skill" or "MCP server" is. */
  tools?: ToolSet;
  /** Called once the full response text is available — the AI SDK awaits
   * this as part of the stream's own lifecycle (unlike a detached `.then()`
   * on `result.text`), so persistence side effects are tied to the request
   * actually finishing rather than racing it. */
  onFinish?: (event: { text: string }) => void | Promise<void>;
  /** Called if the model/provider throws mid-stream — without this, a
   * failure after the first token would otherwise vanish silently from the
   * caller's perspective (the HTTP response is already streaming). */
  onError?: (event: { error: unknown }) => void;
}

/** Streams a chat completion for the given model. Returns the Vercel AI SDK
 * stream result; apps/server pipes `.toTextStreamResponse()` /
 * `.toUIMessageStreamResponse()` straight onto an SSE HTTP response. */
export function streamChat({
  modelId,
  messages,
  systemPrompt,
  installedProviders,
  tools,
  onFinish,
  onError,
}: StreamChatInput) {
  const model = resolveModel(modelId, installedProviders);
  return streamText({
    model,
    system: systemPrompt,
    messages,
    tools,
    // Without this, streamText stops right after a tool call instead of
    // continuing on to produce a final answer from the tool's result.
    ...(tools ? { stopWhen: stepCountIs(5) } : {}),
    ...(onFinish ? { onFinish: (event) => onFinish({ text: event.text }) } : {}),
    ...(onError ? { onError: (event) => onError({ error: event.error }) } : {}),
  });
}
