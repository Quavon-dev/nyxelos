import { getDb } from "@nyxel/db";
import { streamChat } from "@nyxel/model-providers";
import type { Hono } from "hono";
import { z } from "zod";
import { getInstalledProvidersForWorkspace } from "../models";
import { buildToolsForAgent } from "../tools";

const bodySchema = z.object({
  chatId: z.string(),
  message: z.string().min(1),
});

/**
 * POST /api/chat/stream — persists the user message, resolves the system
 * prompt and tool set for this chat (workspace custom instructions, plus —
 * if the chat is bound to an agent — the agent's own system prompt and its
 * assigned skills/MCP tools), streams the model's reply token by token (see
 * ARCHITECTURE.md sections 6, 8, and 14), then persists the full assistant
 * reply once streaming ends. Plain fetch-friendly streaming response rather
 * than a tRPC subscription, per the streaming architecture decision.
 */
export function registerChatStreamRoute(app: Hono) {
  app.post("/api/chat/stream", async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const { chatId, message } = parsed.data;
    const db = getDb();

    const chat = await db.getChat(chatId);
    if (!chat) return c.json({ error: `Unknown chat: ${chatId}` }, 404);

    const [workspace, agent] = await Promise.all([
      db.getWorkspace(chat.workspaceId),
      chat.agentId ? db.getAgent(chat.agentId) : Promise.resolve(null),
    ]);

    const systemPrompt =
      [workspace?.customInstructions, agent?.systemPrompt].filter(Boolean).join("\n\n") ||
      undefined;
    const tools = agent ? await buildToolsForAgent(agent, { chatId }) : undefined;
    const modelId = agent?.modelId ?? chat.modelId;
    const installedProviders = await getInstalledProvidersForWorkspace(chat.workspaceId);

    await db.addMessage({ chatId, role: "user", content: message });
    const history = await db.listMessages(chatId);

    // resolveModel() (called synchronously inside streamChat) throws for an
    // unknown/misconfigured model id — e.g. a stale chat.modelId pointing at
    // a local model that's no longer running. Without this guard that throw
    // would escape as an opaque, stack-trace-dumping 500 instead of a clean
    // JSON error the UI can display.
    let result: ReturnType<typeof streamChat>;
    try {
      result = streamChat({
        modelId,
        systemPrompt,
        installedProviders,
        tools,
        messages: history.map((m) => ({
          role: m.role === "tool" ? "assistant" : m.role,
          content: m.content,
        })),
      });
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "Failed to start model stream.";
      return c.json({ error: messageText }, 502);
    }

    Promise.resolve(result.text)
      .then((full) => db.addMessage({ chatId, role: "assistant", content: full }))
      .catch((err: unknown) => {
        console.error("Failed to persist assistant message", err);
      });

    return result.toTextStreamResponse();
  });
}
