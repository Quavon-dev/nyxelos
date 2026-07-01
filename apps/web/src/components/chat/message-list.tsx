"use client";

import { useEffect, useRef } from "react";
import { parseChatMessageContent } from "@/lib/chat-message";
import type { StreamingMessage } from "@/lib/use-chat-stream";
import { ChatApprovalCard, type ChatApprovalItem } from "./chat-approval-card";
import { ChatTaskCard, type ChatTaskItem } from "./chat-task-card";
import { MessageBubble } from "./message-bubble";

interface Message {
  id: string;
  role: string;
  content: string;
  createdAt?: string | Date;
}

export interface ChatApproval extends ChatApprovalItem {
  createdAt: string | Date;
}

export interface ChatTask extends ChatTaskItem {
  createdAt: string | Date;
}

function toTime(value: string | Date | undefined) {
  if (!value) return 0;
  return new Date(value).getTime();
}

export function MessageList({
  messages,
  streamingMessage,
  approvals = [],
  tasks = [],
  workspaceId,
  actingApprovalId = null,
  onApproveApproval,
  onRejectApproval,
  onEditMessage,
  onRegenerate,
}: {
  messages: Message[];
  streamingMessage: StreamingMessage | null;
  /** Pending/resolved tool-call approvals for this chat, shown inline right
   * where the model paused for them — see ChatApprovalCard. */
  approvals?: ChatApproval[];
  /** Durable tasks created from this chat (task.sourceChatId), shown inline
   * where the model created them — see ChatTaskCard. */
  tasks?: ChatTask[];
  /** Needed to link task/approval cards to their workspace pages. */
  workspaceId?: string;
  actingApprovalId?: string | null;
  onApproveApproval?: (id: string) => void;
  onRejectApproval?: (id: string) => void;
  /** Populates the composer with a prior user turn's text — only offered on
   * the latest user message (see the "edit" action in message-actions.tsx). */
  onEditMessage?: (content: string) => void;
  /** Resends the latest user turn — only offered on the latest assistant
   * reply, and only once no new turn is already streaming. */
  onRegenerate?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastUserMessageId = [...messages].reverse().find((m) => m.role === "user")?.id;
  const lastAssistantMessageId = [...messages]
    .reverse()
    .find((m) => m.role === "assistant")?.id;

  // Messages, approvals, and tasks are separate queries (chats.messages vs.
  // approvals.list vs. tasks.list), so they're merged into one timeline here
  // by createdAt rather than the model ever mentioning them in message content.
  const timeline = [
    ...messages.map((m) => ({ kind: "message" as const, at: toTime(m.createdAt), message: m })),
    ...approvals.map((a) => ({ kind: "approval" as const, at: toTime(a.createdAt), approval: a })),
    ...tasks.map((t) => ({ kind: "task" as const, at: toTime(t.createdAt), task: t })),
  ].sort((a, b) => a.at - b.at);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }, [streamingMessage?.content, timeline.length]);

  return (
    <div ref={containerRef} className="flex-1 space-y-6 overflow-y-auto py-4">
      {timeline.map((item) => {
        if (item.kind === "message") {
          const isLastUser =
            item.message.role === "user" && item.message.id === lastUserMessageId;
          const isLastAssistant =
            item.message.role === "assistant" &&
            item.message.id === lastAssistantMessageId;
          return (
            <MessageBubble
              key={item.message.id}
              sender={item.message.role}
              content={item.message.content}
              onEdit={
                isLastUser && onEditMessage
                  ? () =>
                      onEditMessage(
                        parseChatMessageContent(item.message.content)?.text ??
                          item.message.content,
                      )
                  : undefined
              }
              onRegenerate={
                isLastAssistant && onRegenerate && !streamingMessage
                  ? onRegenerate
                  : undefined
              }
            />
          );
        }
        if (item.kind === "approval") {
          return (
            <ChatApprovalCard
              key={item.approval.id}
              approval={item.approval}
              workspaceId={workspaceId}
              isActing={actingApprovalId === item.approval.id}
              onApprove={() => onApproveApproval?.(item.approval.id)}
              onReject={() => onRejectApproval?.(item.approval.id)}
            />
          );
        }
        return workspaceId ? (
          <ChatTaskCard key={item.task.id} task={item.task} workspaceId={workspaceId} />
        ) : null;
      })}
      {streamingMessage && (
        <MessageBubble
          sender="assistant"
          content={streamingMessage.content || "…"}
          streaming
          reasoning={streamingMessage.reasoning}
          steps={streamingMessage.steps}
        />
      )}
    </div>
  );
}
