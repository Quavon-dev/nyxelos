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
 */
export function useChatStream(chatId: string, modelId: string) {
  const [streamingMessage, setStreamingMessage] = useState<StreamingMessage | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const queryClient = useQueryClient();

  const sendMessage = useCallback(
    async (message: string) => {
      setIsStreaming(true);
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
          body: JSON.stringify({ chatId, modelId, message }),
        });

        if (!res.ok || !res.body) {
          throw new Error(`Chat stream failed: ${res.status}`);
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
      } finally {
        setIsStreaming(false);
        setStreamingMessage(null);
        await queryClient.invalidateQueries({ queryKey: ["messages", chatId] });
      }
    },
    [chatId, modelId, queryClient],
  );

  return { sendMessage, streamingMessage, isStreaming };
}
