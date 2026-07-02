"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { AgentActivityStep } from "./chat-agent-activity";
import { extractSseEvents } from "./chat-stream-parser";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";

const EMPTY_ASSISTANT_RESPONSE =
  "I couldn't produce a visible response just now. Please try again or rephrase your request.";

export interface StreamingMessage {
  role: "assistant";
  content: string;
  /** Accumulated "thinking" text (reasoning-delta events), if the model emits any. */
  reasoning: string;
  /** Tool calls made this turn, in call order — output/error fill in once the
   * matching tool-result/tool-error event arrives. */
  steps: AgentActivityStep[];
}

/**
 * Consumes the SSE stream from POST /api/chat/stream — a sequence of JSON
 * ChatStreamEvent frames (text/reasoning/tool-call/tool-result/tool-error;
 * see chat-stream-parser.ts) — and keeps it in local state while streaming,
 * then invalidates the TanStack Query messages cache once the server has
 * persisted the final assistant message. See ARCHITECTURE.md section 14
 * (Streaming Architecture).
 *
 * The model is resolved server-side from `agent.modelId ?? chat.modelId`
 * (see apps/server/src/routes/chat-stream.ts) — this hook only ever needs
 * the chat id.
 */
export function useChatStream(
  chatId: string,
  options?: {
    /** Request extended thinking/reasoning from the model for every turn
     * sent through this hook — see the `reasoning` flag in chat-stream.ts. */
    reasoning?: boolean;
  },
) {
  const [streamingMessage, setStreamingMessage] = useState<StreamingMessage | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const reasoningEnabled = options?.reasoning ?? false;

  const runTurn = useCallback(
    async (body: { message?: string; editMessageId?: string; regenerate?: boolean }) => {
      setIsStreaming(true);
      setError(null);
      setStreamingMessage({ role: "assistant", content: "", reasoning: "", steps: [] });

      // A GET for this same key can already be in flight (e.g. the page's
      // initial mount fetch) and would otherwise resolve after this
      // optimistic write and silently overwrite it with pre-send data —
      // cancel it first so only writes from here on can win.
      await queryClient.cancelQueries({ queryKey: ["messages", chatId] });

      queryClient.setQueryData(["messages", chatId], (old: unknown) => {
        const prev = Array.isArray(old) ? old : [];
        if (body.editMessageId) {
          // Mirror the server's edit: rewrite the target message in place
          // and drop every turn that followed it (its stale reply included).
          const index = prev.findIndex((m: { id: string }) => m.id === body.editMessageId);
          if (index === -1) return prev;
          const edited = { ...prev[index], content: body.message };
          return [...prev.slice(0, index), edited];
        }
        if (body.regenerate) {
          // Mirror the server's regenerate: drop the stale last assistant
          // reply instead of appending a duplicate user turn.
          const last = prev.at(-1);
          return last?.role === "assistant" ? prev.slice(0, -1) : prev;
        }
        return [
          ...prev,
          {
            id: `local-${Date.now()}`,
            chatId,
            role: "user",
            content: body.message,
            createdAt: new Date(),
          },
        ];
      });

      try {
        const res = await fetch(`${SERVER_URL}/api/chat/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            chatId,
            ...(reasoningEnabled ? { reasoning: true } : {}),
            ...body,
          }),
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
        let reasoning = "";
        const steps: AgentActivityStep[] = [];
        const stepIndexById = new Map<string, number>();
        let buffer = "";

        function applyEvents(events: ReturnType<typeof extractSseEvents>["events"]) {
          for (const event of events) {
            switch (event.type) {
              case "text":
                full += event.text;
                break;
              case "reasoning":
                reasoning += event.text;
                break;
              case "tool-call":
                stepIndexById.set(event.id, steps.length);
                steps.push({ id: event.id, name: event.name, input: event.input });
                break;
              case "tool-result": {
                const index = stepIndexById.get(event.id);
                const step = index === undefined ? undefined : steps[index];
                if (step) steps[index as number] = { ...step, output: event.output };
                break;
              }
              case "tool-error": {
                const index = stepIndexById.get(event.id);
                const step = index === undefined ? undefined : steps[index];
                if (step) steps[index as number] = { ...step, error: event.error };
                break;
              }
            }
          }
        }

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = extractSseEvents(buffer);
          buffer = parsed.remaining;
          if (parsed.events.length > 0) {
            applyEvents(parsed.events);
            setStreamingMessage({
              role: "assistant",
              content: full,
              reasoning,
              steps: [...steps],
            });
          }
        }

        buffer += decoder.decode();
        applyEvents(extractSseEvents(buffer).events);
        const visibleResponse = full.trim() ? full : EMPTY_ASSISTANT_RESPONSE;
        setStreamingMessage({
          role: "assistant",
          content: visibleResponse,
          reasoning,
          steps: [...steps],
        });

        // Write the finished reply straight into the cache instead of
        // waiting on a follow-up GET to show it — that round-trip can be
        // slow or queued behind the still-open SSE connection, which left
        // the UI stuck on the streaming placeholder until a manual reload.
        // (The persisted row's activity block arrives once the background
        // invalidate below resolves; this optimistic row is text-only.)
        await queryClient.cancelQueries({ queryKey: ["messages", chatId] });
        queryClient.setQueryData(["messages", chatId], (old: unknown) => {
          const prev = Array.isArray(old) ? old : [];
          return [
            ...prev,
            {
              id: `local-${Date.now()}-assistant`,
              chatId,
              role: "assistant",
              content: visibleResponse,
              createdAt: new Date(),
            },
          ];
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong while streaming.");
      } finally {
        setIsStreaming(false);
        setStreamingMessage(null);
        // Reconcile with the server's persisted rows (real ids/timestamps,
        // any server-side edits) in the background — not awaited, so a slow
        // or stalled refetch can no longer hold the UI on the placeholder.
        queryClient.invalidateQueries({ queryKey: ["messages", chatId] });
      }
    },
    [chatId, queryClient, reasoningEnabled],
  );

  const sendMessage = useCallback((message: string) => runTurn({ message }), [runTurn]);
  const editMessage = useCallback(
    (messageId: string, message: string) => runTurn({ editMessageId: messageId, message }),
    [runTurn],
  );
  const regenerate = useCallback(() => runTurn({ regenerate: true }), [runTurn]);

  return { sendMessage, editMessage, regenerate, streamingMessage, isStreaming, error };
}
