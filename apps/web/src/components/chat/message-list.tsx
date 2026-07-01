import type { StreamingMessage } from "@/lib/use-chat-stream";
import { MessageBubble } from "./message-bubble";

interface Message {
  id: string;
  role: string;
  content: string;
}

export function MessageList({
  messages,
  streamingMessage,
}: {
  messages: Message[];
  streamingMessage: StreamingMessage | null;
}) {
  return (
    <div className="flex-1 space-y-3 overflow-y-auto py-4">
      {messages.map((m) => (
        <MessageBubble key={m.id} sender={m.role} content={m.content} />
      ))}
      {streamingMessage && (
        <MessageBubble sender="assistant" content={streamingMessage.content || "…"} />
      )}
    </div>
  );
}
