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

  // Phase 0: use the first detected model. Per-chat model selection (stored
  // on the chat record already) is a follow-up UI affordance.
  const modelsQuery = useQuery({
    queryKey: ["models", "list"],
    queryFn: () => trpcClient.models.list.query(),
  });
  const modelId = modelsQuery.data?.[0]?.id ?? "";

  const { sendMessage, streamingMessage, isStreaming } = useChatStream(chatId, modelId);

  return (
    <div className="mx-auto flex h-screen max-w-2xl flex-col p-4">
      <MessageList messages={messagesQuery.data ?? []} streamingMessage={streamingMessage} />
      <ChatInput onSend={sendMessage} disabled={isStreaming || !modelId} />
    </div>
  );
}
