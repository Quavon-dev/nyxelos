import type { StreamingMessage } from "@/lib/use-chat-stream";
import { ChatApprovalCard, type ChatApprovalItem } from "./chat-approval-card";
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

function toTime(value: string | Date | undefined) {
  if (!value) return 0;
  return new Date(value).getTime();
}

export function MessageList({
  messages,
  streamingMessage,
  approvals = [],
  actingApprovalId = null,
  onApproveApproval,
  onRejectApproval,
}: {
  messages: Message[];
  streamingMessage: StreamingMessage | null;
  /** Pending/resolved tool-call approvals for this chat, shown inline right
   * where the model paused for them — see ChatApprovalCard. */
  approvals?: ChatApproval[];
  actingApprovalId?: string | null;
  onApproveApproval?: (id: string) => void;
  onRejectApproval?: (id: string) => void;
}) {
  // Messages and approvals are two separate queries (chats.messages vs.
  // approvals.list), so they're merged into one timeline here by createdAt
  // rather than the model ever mentioning approvals in message content.
  const timeline = [
    ...messages.map((m) => ({ kind: "message" as const, at: toTime(m.createdAt), message: m })),
    ...approvals.map((a) => ({ kind: "approval" as const, at: toTime(a.createdAt), approval: a })),
  ].sort((a, b) => a.at - b.at);

  return (
    <div className="flex-1 space-y-3 overflow-y-auto py-4">
      {timeline.map((item) =>
        item.kind === "message" ? (
          <MessageBubble
            key={item.message.id}
            sender={item.message.role}
            content={item.message.content}
          />
        ) : (
          <ChatApprovalCard
            key={item.approval.id}
            approval={item.approval}
            isActing={actingApprovalId === item.approval.id}
            onApprove={() => onApproveApproval?.(item.approval.id)}
            onReject={() => onRejectApproval?.(item.approval.id)}
          />
        ),
      )}
      {streamingMessage && (
        <MessageBubble sender="assistant" content={streamingMessage.content || "…"} />
      )}
    </div>
  );
}
