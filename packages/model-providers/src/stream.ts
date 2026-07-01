import { streamText } from "ai";
import { resolveModel } from "./providers";

export interface ChatMessageInput {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface StreamChatInput {
  modelId: string;
  messages: ChatMessageInput[];
  systemPrompt?: string;
}

/** Streams a chat completion for the given model. Returns the Vercel AI SDK
 * stream result; apps/server pipes `.toTextStreamResponse()` /
 * `.toUIMessageStreamResponse()` straight onto an SSE HTTP response. */
export function streamChat({ modelId, messages, systemPrompt }: StreamChatInput) {
  const model = resolveModel(modelId);
  return streamText({
    model,
    system: systemPrompt,
    messages,
  });
}
