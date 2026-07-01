"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { ChatInput } from "@/components/chat/chat-input";
import { MessageList } from "@/components/chat/message-list";
import { trpcClient } from "@/lib/trpc";
import { useChatStream } from "@/lib/use-chat-stream";

export default function ChatPage() {
  const params = useParams<{ chatId: string }>();
  const chatId = params.chatId;

  const messagesQuery = useQuery({
    queryKey: ["messages", chatId],
    queryFn: () => trpcClient.chats.messages.query({ chatId }),
  });

  const { sendMessage, streamingMessage, isStreaming } = useChatStream(chatId);

  // 3.5rem matches the app header's fixed height (h-14) — the shell no
  // longer gives this page the full viewport, just what's left below it.
  return (
    <div className="mx-auto flex h-[calc(100svh-3.5rem)] max-w-2xl flex-col p-4">
      <MessageList messages={messagesQuery.data ?? []} streamingMessage={streamingMessage} />
      <ChatInput onSend={sendMessage} disabled={isStreaming} />
    </div>
  );
}
