"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { ChatInput } from "@/components/chat/chat-input";
import { MessageList } from "@/components/chat/message-list";
import { trpcClient } from "@/lib/trpc";
import { useChatStream } from "@/lib/use-chat-stream";

export default function ChatPage() {
  const params = useParams<{ chatId: string }>();
  const chatId = params.chatId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const draft = searchParams.get("draft");
  const sentDraftRef = useRef(false);

  const messagesQuery = useQuery({
    queryKey: ["messages", chatId],
    queryFn: () => trpcClient.chats.messages.query({ chatId }),
  });

  const { sendMessage, streamingMessage, isStreaming, error } = useChatStream(chatId);

  // A chat created from the landing page's composer arrives here with its
  // first message tucked into ?draft= — send it once, then drop the param
  // from the URL so refreshing doesn't resend it.
  useEffect(() => {
    if (draft && !sentDraftRef.current) {
      sentDraftRef.current = true;
      sendMessage(draft);
      router.replace(`/chat/${chatId}`);
    }
  }, [draft, chatId, sendMessage, router]);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col p-4">
      <MessageList messages={messagesQuery.data ?? []} streamingMessage={streamingMessage} />
      {error && (
        <p className="mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <ChatInput onSend={sendMessage} disabled={isStreaming} />
    </div>
  );
}
