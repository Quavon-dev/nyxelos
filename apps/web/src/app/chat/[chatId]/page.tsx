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

  return (
    <div className="mx-auto flex h-screen max-w-2xl flex-col p-4">
      <MessageList messages={messagesQuery.data ?? []} streamingMessage={streamingMessage} />
      <ChatInput onSend={sendMessage} disabled={isStreaming} />
    </div>
  );
}
