import { getDb } from "@nyxel/db";
import { streamChat } from "@nyxel/model-providers";
import type { Hono } from "hono";
import { z } from "zod";
import { resolveAgentRuntimeConfig } from "../auto-agent";
import { getKnowledgeBaseContextForPrompt } from "../knowledge-base";
import { getInstalledProvidersForWorkspace } from "../models";
import { buildToolsForAgent } from "../tools";

const bodySchema = z.object({
	chatId: z.string(),
	message: z.string().min(1),
});

const CHAT_FOLLOW_UP_GUIDANCE = [
	"When the request is underspecified or you need a missing detail to respond correctly, ask one concise follow-up question instead of guessing.",
	"Keep the question short and specific so the user can answer it directly in the next message.",
	'If the user needs to choose more than one option, respond with a single fenced code block tagged `nyxel-multiselect` that contains strict JSON in this shape: {"kind":"multi_select","question":"...","options":[{"id":"stable-id","label":"Display label"}]}. Keep any surrounding prose minimal.',
].join(" ");

const STREAM_HEADERS = {
	"Content-Type": "text/plain; charset=utf-8",
	"Cache-Control": "no-cache, no-transform",
	Connection: "keep-alive",
	"X-Accel-Buffering": "no",
};

function isClosedStreamControllerError(err: unknown): boolean {
	return (
		err instanceof Error &&
		"code" in err &&
		err.code === "ERR_INVALID_STATE" &&
		err.message.includes("Controller is already closed")
	);
}

/**
 * POST /api/chat/stream — persists the user message, resolves the system
 * prompt and tool set for this chat (workspace custom instructions, plus —
 * if the chat is bound to an agent — the agent's own system prompt and its
 * assigned skills/MCP tools, plus the workspace's auto-injected knowledge-base
 * context — see ADR-0013), streams the model's reply token by token (see
 * ARCHITECTURE.md sections 6, 8, 9, and 14), then persists the full assistant
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

		const [workspace, storedAgent] = await Promise.all([
			db.getWorkspace(chat.workspaceId),
			chat.agentId ? db.getAgent(chat.agentId) : Promise.resolve(null),
		]);
		const agent = storedAgent
			? await resolveAgentRuntimeConfig(storedAgent)
			: null;
		const knowledgeBaseContext = await getKnowledgeBaseContextForPrompt(
			chat.workspaceId,
		);

		const systemPrompt =
			[
				workspace?.customInstructions,
				agent?.systemPrompt,
				CHAT_FOLLOW_UP_GUIDANCE,
				knowledgeBaseContext,
			]
				.filter(Boolean)
				.join("\n\n") || undefined;
		const tools = agent
			? await buildToolsForAgent(agent, { chatId })
			: undefined;
		const modelId = agent?.modelId ?? chat.modelId;
		const installedProviders = await getInstalledProvidersForWorkspace(
			chat.workspaceId,
		);

		await db.addMessage({ chatId, role: "user", content: message });
		const history = await db.listMessages(chatId);

		// resolveModel() (called synchronously inside streamChat) throws for an
		// unknown/misconfigured model id — e.g. a stale chat.modelId pointing at
		// a local model that's no longer running. Without this guard that throw
		// would escape as an opaque, stack-trace-dumping 500 instead of a clean
		// JSON error the UI can display.
		let finalizedText = "";
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
				onFinish: ({ text }) => {
					finalizedText = text;
				},
				onError: ({ error }) => {
					console.error(
						`Model stream failed mid-response for chat ${chatId}:`,
						error,
					);
				},
			});
		} catch (err) {
			const messageText =
				err instanceof Error ? err.message : "Failed to start model stream.";
			return c.json({ error: messageText }, 502);
		}

		const encoder = new TextEncoder();
		let clientDisconnected = false;
		const stream = new ReadableStream<Uint8Array>({
			async start(controller) {
				let streamedText = "";
				try {
					for await (const chunk of result.textStream) {
						streamedText += chunk;
						if (!clientDisconnected) {
							controller.enqueue(encoder.encode(chunk));
						}
					}

					const assistantText = finalizedText.trim()
						? finalizedText
						: streamedText;

					if (
						!clientDisconnected &&
						assistantText &&
						assistantText !== streamedText
					) {
						const missingSuffix = assistantText.startsWith(streamedText)
							? assistantText.slice(streamedText.length)
							: assistantText;
						if (missingSuffix) {
							controller.enqueue(encoder.encode(missingSuffix));
						}
					}

					if (assistantText.trim()) {
						try {
							await db.addMessage({
								chatId,
								role: "assistant",
								content: assistantText,
							});
						} catch (err) {
							console.error(
								`Failed to persist assistant message for chat ${chatId}:`,
								err,
							);
						}
					}
					if (!clientDisconnected) {
						controller.close();
					}
				} catch (err) {
					if (clientDisconnected || isClosedStreamControllerError(err)) {
						return;
					}

					const messageText =
						err instanceof Error
							? err.message
							: "Model stream failed mid-response.";
					console.error(
						`Model stream failed mid-response for chat ${chatId}:`,
						err,
					);
					controller.enqueue(
						encoder.encode(`\n\n[stream error] ${messageText}`),
					);
					controller.close();
				}
			},
			cancel() {
				clientDisconnected = true;
			},
		});

		return new Response(stream, { headers: STREAM_HEADERS });
	});
}
