"use client";

import { useEffect, useRef } from "react";
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
}) {
  const containerRef = useRef<HTMLDivElement>(null);

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
          return (
            <MessageBubble
              key={item.message.id}
              sender={item.message.role}
              content={item.message.content}
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
        />
      )}
    </div>
  );
}
