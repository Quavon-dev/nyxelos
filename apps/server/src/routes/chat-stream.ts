import { getDb } from "@nyxel/db";
import { streamChat } from "@nyxel/model-providers";
import type { Hono } from "hono";
import { z } from "zod";

const bodySchema = z.object({
  chatId: z.string(),
  modelId: z.string(),
  message: z.string().min(1),
  systemPrompt: z.string().optional(),
});

/**
 * POST /api/chat/stream — the Phase 0 vertical slice: persist the user
 * message, stream the model's reply token by token (see ARCHITECTURE.md
 * section 14), then persist the full assistant reply once streaming ends.
 * This is a plain fetch-friendly streaming response rather than a tRPC
 * subscription, per the streaming architecture decision.
 */
export function registerChatStreamRoute(app: Hono) {
  app.post("/api/chat/stream", async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const { chatId, modelId, message, systemPrompt } = parsed.data;
    const db = getDb();

    await db.addMessage({ chatId, role: "user", content: message });
    const history = await db.listMessages(chatId);

    const result = streamChat({
      modelId,
      systemPrompt,
      messages: history.map((m) => ({
        role: m.role === "tool" ? "assistant" : m.role,
        content: m.content,
      })),
    });

    Promise.resolve(result.text)
      .then((full) => db.addMessage({ chatId, role: "assistant", content: full }))
      .catch((err: unknown) => {
        console.error("Failed to persist assistant message", err);
      });

    return result.toTextStreamResponse();
  });
}
