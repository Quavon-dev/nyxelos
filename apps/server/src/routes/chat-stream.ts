import { getDb } from "@nyxel/db";
import {
  type ChatStreamUsage,
  estimateCostMicros,
  getModelCapabilities,
  streamChat,
} from "@nyxel/model-providers";
import type { Hono } from "hono";
import { z } from "zod";
import { prepareMessageContentForModel } from "../attachment-processing";
import { resolveAgentRuntimeConfig } from "../auto-agent";
import type { AgentActivityStep } from "../chat-agent-activity";
import {
  hasAgentActivity,
  serializeAgentActivity,
  stripAgentActivity,
} from "../chat-agent-activity";
import { summarizeChatMessageForModel } from "../chat-message";
import { getSessionUser } from "../hono-auth";
import { getKnowledgeBaseContextForPrompt, runDocsAgentForWorkspace } from "../knowledge-base";
import { computeMessageGenerationMetrics } from "../message-generation-metrics";
import { getInstalledProvidersForWorkspace } from "../models";
import { notifyWorkspaceOwner } from "../push";
import { buildToolsForAgent } from "../tools";
import { requireWorkspaceOwner } from "../trpc/workspace-guard";
import { composeSystemPrompt } from "../workspace-prompt";
import { buildStreamFailureResponse, ensureVisibleAssistantResponse } from "./chat-stream-response";
import { encodeSseEvent, SSE_HEADERS } from "./chat-stream-sse";

/** Everything persist-worthy about how one assistant turn was generated —
 * gathered over the life of the SSE loop, then flattened onto the message
 * row in persistAssistantMessage(). Powers the detailed statistics
 * dashboard (stats.overview). */
interface GenerationTelemetry {
  modelId: string;
  usage?: ChatStreamUsage;
  durationMs: number;
  thinkingMs: number | null;
}

const bodySchema = z.object({
  chatId: z.string(),
  message: z.string().min(1).optional(),
  /** Set when the client's "edit" action rewrites a past user turn in
   * place — updates that message's content, drops every turn that came
   * after it, then regenerates from there. Requires `message`. */
  editMessageId: z.string().optional(),
  /** Set when the client's "regenerate" action asks for a fresh reply to
   * the existing last user turn — drops the stale assistant reply instead
   * of appending a duplicate user turn. */
  regenerate: z.boolean().optional(),
  /** Client-side "Thinking" toggle — requests extended thinking/reasoning
   * from providers that support it (Anthropic thinking budget, OpenAI
   * reasoning effort); a harmless no-op everywhere else. */
  reasoning: z.boolean().optional(),
});

const CHAT_FOLLOW_UP_GUIDANCE = [
  "When the request is underspecified or you need a missing detail to respond correctly, ask one concise follow-up question instead of guessing.",
  "Reply with just that single question — one sentence, no preamble, no summary of what you found, no bullet lists of capabilities.",
  'When a choice is needed, respond with a single fenced code block tagged `nyxel-multiselect` that contains strict JSON in this shape: {"kind":"multi_select","question":"...","options":[{"id":"stable-id","label":"Display label"}]}. Provide exactly 3 concise suggestion options and keep any surrounding prose minimal; the client adds a custom-answer option automatically.',
].join(" ");

const CHAT_MODE_GUIDANCE = {
  default:
    "Ask for confirmation before any sensitive action. When information is missing, ask one concise follow-up question instead of guessing.",
  automatic:
    "Operate with automatic tool usage. Make a short internal plan, gather the missing local context with tools before asking the user, and carry out code and file changes directly when the path is clear. Only ask the user when a real product decision or a hard permission boundary blocks progress.",
  auto: "Operate as a fully autonomous agent. Never ask the user clarifying or scoping questions — if the request is underspecified, pick the most reasonable interpretation, use tools to gather whatever context you need, and proceed immediately with the full task. Only surface a blocker to the user when an approval policy hard-stops a specific tool call; in that case name the blocked action and continue all unblocked work. Do not ask for confirmation, permission, or clarification under any circumstances.",
} as const;

async function persistAssistantMessage(
  chatId: string,
  content: string,
  telemetry?: GenerationTelemetry,
) {
  const db = getDb();
  try {
    const metrics = computeMessageGenerationMetrics(content);
    const usage = telemetry?.usage;
    await db.addMessage({
      chatId,
      role: "assistant",
      content,
      modelId: telemetry?.modelId ?? null,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      reasoningTokens: usage?.reasoningTokens ?? null,
      cacheReadTokens: usage?.cacheReadTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
      costMicros: telemetry ? estimateCostMicros(telemetry.modelId, usage ?? {}) : null,
      durationMs: telemetry?.durationMs ?? null,
      thinkingMs: telemetry?.thinkingMs ?? null,
      lineCount: metrics.lineCount,
      codeLineCount: metrics.codeLineCount,
      codeBlockCount: metrics.codeBlockCount,
    });
  } catch (err) {
    console.error(`Failed to persist assistant message for chat ${chatId}:`, err);
  }
}

function triggerKnowledgeBaseSync(workspaceId: string) {
  runDocsAgentForWorkspace(workspaceId, "background").catch((err) => {
    console.error(`Knowledge-base sync failed for workspace ${workspaceId}:`, err);
  });
}

const CHAT_NOTIFICATION_PREVIEW_LENGTH = 120;

function chatNotificationPreview(text: string): string {
  const oneLine = text.trim().replace(/\s+/g, " ");
  return oneLine.length > CHAT_NOTIFICATION_PREVIEW_LENGTH
    ? `${oneLine.slice(0, CHAT_NOTIFICATION_PREVIEW_LENGTH)}…`
    : oneLine;
}

function isClosedStreamControllerError(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    err.code === "ERR_INVALID_STATE" &&
    err.message.includes("Controller is already closed")
  );
}

/**
 * POST /api/chat/stream — persists the user message (or, for `editMessageId`/
 * `regenerate`, rewrites/truncates history in place instead), resolves the
 * system prompt and tool set for this chat (workspace custom instructions, plus —
 * if the chat is bound to an agent — the agent's own system prompt and its
 * assigned skills/MCP tools, plus the workspace's auto-injected knowledge-base
 * context — see ADR-0013), streams the model's reply token by token (see
 * ARCHITECTURE.md sections 6, 8, 9, and 14), then persists the full assistant
 * reply once streaming ends. Plain fetch-friendly streaming response rather
 * than a tRPC subscription, per the streaming architecture decision.
 */
export function registerChatStreamRoute(app: Hono) {
  app.post("/api/chat/stream", async (c) => {
    const user = await getSessionUser(c);
    if (!user) return c.json({ error: "Sign in required." }, 401);

    const json = await c.req.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const { chatId, message, editMessageId, regenerate, reasoning } = parsed.data;
    if (!editMessageId && !regenerate && !message) {
      return c.json({ error: "message is required" }, 400);
    }
    const db = getDb();

    const chat = await db.getChat(chatId);
    if (!chat) return c.json({ error: `Unknown chat: ${chatId}` }, 404);
    try {
      await requireWorkspaceOwner(user.id, chat.workspaceId);
    } catch {
      return c.json({ error: "Not authorized for this chat." }, 403);
    }

    const [workspace, storedAgent] = await Promise.all([
      db.getWorkspace(chat.workspaceId),
      chat.agentId ? db.getAgent(chat.agentId) : Promise.resolve(null),
    ]);
    const agent = storedAgent ? await resolveAgentRuntimeConfig(storedAgent) : null;
    const knowledgeBaseContext = await getKnowledgeBaseContextForPrompt(chat.workspaceId);
    const modelId = agent?.modelId ?? chat.modelId;
    const modelParams = await db.getModelParameter(chat.workspaceId, modelId);

    const systemPrompt = composeSystemPrompt(
      workspace,
      agent?.systemPrompt,
      `Working directory: ${chat.workingDirectory}. Resolve relative file paths inside this directory.`,
      CHAT_MODE_GUIDANCE[chat.toolMode],
      chat.toolMode === "auto" ? null : CHAT_FOLLOW_UP_GUIDANCE,
      knowledgeBaseContext,
      modelParams?.customInstructions,
    );
    const installedProviders = await getInstalledProvidersForWorkspace(chat.workspaceId);
    // Some models (e.g. OpenRouter image-generation models like
    // google/gemini-3.1-flash-image) have no endpoint that supports tool
    // use at all — sending a tools array to them fails the request outright
    // with a 404 before any text streams back. Skip building/passing tools
    // for those instead of letting every turn fail.
    const modelCapabilities = await getModelCapabilities(modelId, installedProviders);
    const tools =
      agent && modelCapabilities.toolCalling
        ? await buildToolsForAgent(agent, {
            chatId,
            workingDirectory: chat.workingDirectory,
            chatToolPolicy: chat.toolPolicy,
          })
        : undefined;

    const priorHistory = await db.listMessages(chatId);

    if (editMessageId) {
      const target = priorHistory.find((m) => m.id === editMessageId);
      if (target?.role !== "user") {
        return c.json({ error: `Unknown user message: ${editMessageId}` }, 404);
      }
      // message is guaranteed by the guard above when editMessageId is set.
      await db.updateMessage(editMessageId, message as string);
      await db.deleteMessagesAfter(chatId, editMessageId);
    } else if (regenerate) {
      const lastAssistant = [...priorHistory].reverse().find((m) => m.role === "assistant");
      if (lastAssistant) await db.deleteMessage(lastAssistant.id);
    } else {
      await db.addMessage({ chatId, role: "user", content: message as string });
    }

    const history = await db.listMessages(chatId);
    const modelMessages = await Promise.all(
      history.map(async (entry) => ({
        role: entry.role === "tool" ? "assistant" : entry.role,
        content:
          entry.role === "user"
            ? ((await prepareMessageContentForModel({
                rawContent: entry.content,
                modelId,
                installedProviders,
              })) ?? summarizeChatMessageForModel(entry.content))
            : stripAgentActivity(entry.content),
      })),
    );

    // resolveModel() (called synchronously inside streamChat) throws for an
    // unknown/misconfigured model id — e.g. a stale chat.modelId pointing at
    // a local model that's no longer running. Without this guard that throw
    // would escape as an opaque, stack-trace-dumping 500 instead of a clean
    // JSON error the UI can display.
    let finalizedText = "";
    let finalizedUsage: ChatStreamUsage | undefined;
    let result: ReturnType<typeof streamChat>;
    try {
      result = streamChat({
        modelId,
        systemPrompt,
        installedProviders,
        tools,
        cwd: chat.workingDirectory ?? undefined,
        toolMode: chat.toolMode,
        reasoningEffort: reasoning ? (modelParams?.reasoningEffort ?? "medium") : undefined,
        maxOutputTokens: modelParams?.maxOutputTokens ?? undefined,
        temperature: modelParams?.temperature ?? undefined,
        topP: modelParams?.topP ?? undefined,
        frequencyPenalty: modelParams?.frequencyPenalty ?? undefined,
        presencePenalty: modelParams?.presencePenalty ?? undefined,
        stopSequences: modelParams?.stopSequences,
        messages: modelMessages,
        onFinish: ({ text, usage }) => {
          finalizedText = text;
          finalizedUsage = usage;
        },
        onError: ({ error }) => {
          console.error(`Model stream failed mid-response for chat ${chatId}:`, error);
        },
      });
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "Failed to start model stream.";
      return c.json({ error: messageText }, 502);
    }

    const encoder = new TextEncoder();
    let clientDisconnected = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const streamStartedAt = Date.now();
        let reasoningStartedAt: number | null = null;
        let reasoningEndedAt: number | null = null;
        let streamedText = "";
        let reasoningText = "";
        const steps: AgentActivityStep[] = [];
        const stepIndexByCallId = new Map<string, number>();

        function emit(event: Parameters<typeof encodeSseEvent>[0]) {
          if (clientDisconnected) return;
          controller.enqueue(encoder.encode(encodeSseEvent(event)));
        }

        function finalize(assistantText: string) {
          const activity = { reasoning: reasoningText || undefined, steps };
          return hasAgentActivity(activity)
            ? `${assistantText}\n\n${serializeAgentActivity(activity)}`
            : assistantText;
        }

        function telemetry(): GenerationTelemetry {
          return {
            modelId,
            usage: finalizedUsage,
            durationMs: Date.now() - streamStartedAt,
            thinkingMs:
              reasoningStartedAt !== null
                ? (reasoningEndedAt ?? Date.now()) - reasoningStartedAt
                : null,
          };
        }

        try {
          for await (const part of result.fullStream) {
            switch (part.type) {
              case "text-delta":
                if (reasoningStartedAt !== null && reasoningEndedAt === null) {
                  reasoningEndedAt = Date.now();
                }
                streamedText += part.text;
                emit({ type: "text", text: part.text });
                break;
              case "reasoning-delta":
                if (reasoningStartedAt === null) reasoningStartedAt = Date.now();
                reasoningText += part.text;
                emit({ type: "reasoning", text: part.text });
                break;
              case "tool-call":
                stepIndexByCallId.set(part.toolCallId, steps.length);
                steps.push({
                  id: part.toolCallId,
                  name: part.toolName,
                  input: part.input,
                });
                emit({
                  type: "tool-call",
                  id: part.toolCallId,
                  name: part.toolName,
                  input: part.input,
                });
                break;
              case "tool-result": {
                const index = stepIndexByCallId.get(part.toolCallId);
                const step = index === undefined ? undefined : steps[index];
                if (step) step.output = part.output;
                emit({
                  type: "tool-result",
                  id: part.toolCallId,
                  name: part.toolName,
                  output: part.output,
                });
                break;
              }
              case "tool-error": {
                const index = stepIndexByCallId.get(part.toolCallId);
                const step = index === undefined ? undefined : steps[index];
                const message =
                  part.error instanceof Error ? part.error.message : String(part.error);
                if (step) step.error = message;
                emit({
                  type: "tool-error",
                  id: part.toolCallId,
                  name: part.toolName,
                  error: message,
                });
                break;
              }
              case "error":
                // The AI SDK reports a mid-stream provider failure (rate
                // limit, insufficient credits, etc.) as an "error" stream
                // part rather than throwing — without this case it fell
                // into the silent default branch below, so the concrete
                // provider message (e.g. OpenRouter's 402 "requires more
                // credits") never reached the client, only this process's
                // console via onError. Throwing here routes it through the
                // same catch block that already turns a thrown error's
                // message into a visible assistant reply.
                throw part.error;
              default:
                break;
            }
          }

          const assistantText = ensureVisibleAssistantResponse(
            finalizedText.trim() ? finalizedText : streamedText,
          );

          if (assistantText && assistantText !== streamedText) {
            const missingSuffix = assistantText.startsWith(streamedText)
              ? assistantText.slice(streamedText.length)
              : assistantText;
            if (missingSuffix) emit({ type: "text", text: missingSuffix });
          }

          await persistAssistantMessage(chatId, finalize(assistantText), telemetry());
          triggerKnowledgeBaseSync(chat.workspaceId);
          await notifyWorkspaceOwner(chat.workspaceId, {
            title: chat.title,
            body: chatNotificationPreview(assistantText),
            url: `/chat/${chatId}`,
            tag: `chat-${chatId}`,
          });
          if (!clientDisconnected) {
            controller.close();
          }
        } catch (err) {
          if (clientDisconnected || isClosedStreamControllerError(err)) {
            return;
          }

          const messageText =
            err instanceof Error ? err.message : "Model stream failed mid-response.";
          const assistantText = buildStreamFailureResponse(streamedText, messageText);
          console.error(`Model stream failed mid-response for chat ${chatId}:`, err);
          await persistAssistantMessage(chatId, finalize(assistantText), telemetry());
          triggerKnowledgeBaseSync(chat.workspaceId);
          const missingSuffix = assistantText.startsWith(streamedText)
            ? assistantText.slice(streamedText.length)
            : assistantText;
          if (missingSuffix) emit({ type: "text", text: missingSuffix });
          controller.close();
        }
      },
      cancel() {
        clientDisconnected = true;
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  });
}
