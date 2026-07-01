"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";

export interface StreamingMessage {
  role: "assistant";
  content: string;
}

/**
 * Consumes the SSE-style streaming response from POST /api/chat/stream
 * token by token and keeps it in local state while streaming, then
 * invalidates the TanStack Query messages cache once the server has
 * persisted the final assistant message. See ARCHITECTURE.md section 14
 * (Streaming Architecture).
 *
 * The model is resolved server-side from `agent.modelId ?? chat.modelId`
 * (see apps/server/src/routes/chat-stream.ts) — this hook only ever needs
 * the chat id.
 */
export function useChatStream(chatId: string) {
  const [streamingMessage, setStreamingMessage] = useState<StreamingMessage | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const sendMessage = useCallback(
    async (message: string) => {
      setIsStreaming(true);
      setError(null);
      setStreamingMessage({ role: "assistant", content: "" });

      queryClient.setQueryData(["messages", chatId], (old: unknown) => {
        const prev = Array.isArray(old) ? old : [];
        return [
          ...prev,
          {
            id: `local-${Date.now()}`,
            chatId,
            role: "user",
            content: message,
            createdAt: new Date(),
          },
        ];
      });

      try {
        const res = await fetch(`${SERVER_URL}/api/chat/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ chatId, message }),
        });

        if (!res.ok || !res.body) {
          // The route returns { error } as JSON for pre-stream failures
          // (unknown model, bad request) — surface that instead of a bare
          // status code whenever it's available.
          const body = await res.json().catch(() => null);
          const detail =
            typeof body?.error === "string"
              ? body.error
              : (body?.error?.formErrors?.[0] ?? `Request failed (${res.status}).`);
          throw new Error(detail);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let full = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          setStreamingMessage({ role: "assistant", content: full });
        }

        if (!full.trim()) {
          throw new Error("Model returned no visible text.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong while streaming.");
      } finally {
        setIsStreaming(false);
        await queryClient.invalidateQueries({ queryKey: ["messages", chatId] });
        setStreamingMessage(null);
      }
    },
    [chatId, queryClient],
  );

  return { sendMessage, streamingMessage, isStreaming, error };
}
