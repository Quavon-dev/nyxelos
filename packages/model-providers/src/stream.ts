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
  });
}
