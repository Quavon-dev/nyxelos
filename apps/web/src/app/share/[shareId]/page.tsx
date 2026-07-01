"use client";

import { useQuery } from "@tanstack/react-query";
import { MessageSquareOff } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { MessageBubble } from "@/components/chat/message-bubble";
import { CenteredLoader } from "@/components/loading";
import { trpcClient } from "@/lib/trpc";

/** A public, read-only view of a chat someone shared via the sidebar's
 * "Share" action. No auth check — sharing is opt-in per chat and the token
 * in the URL (chat.shareId) is the only thing gating access, same model as
 * most "share link" features. */
export default function SharedChatPage() {
  const params = useParams<{ shareId: string }>();
  const shareId = params.shareId;

  const sharedQuery = useQuery({
    queryKey: ["chats", "getShared", shareId],
    queryFn: () => trpcClient.chats.getShared.query({ shareId }),
    enabled: Boolean(shareId),
  });

  if (sharedQuery.isLoading) {
    return <CenteredLoader label="Loading shared chat…" />;
  }

  if (!sharedQuery.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <MessageSquareOff className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          This link is no longer active — the chat may have stopped being shared.
        </p>
        <Link href="/" className="text-sm text-primary underline underline-offset-4">
          Go home
        </Link>
      </div>
    );
  }

  const { chat, messages } = sharedQuery.data;

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 overflow-y-auto p-6">
      <div className="space-y-1 border-b pb-4">
        <p className="text-xs text-muted-foreground">Shared chat · read-only</p>
        <h1 className="text-xl font-semibold">{chat.title || "Untitled chat"}</h1>
      </div>
      <div className="flex flex-col gap-3">
        {messages
          .filter((message) => message.role === "user" || message.role === "assistant")
          .map((message) => (
            <MessageBubble key={message.id} sender={message.role} content={message.content} />
          ))}
      </div>
    </div>
  );
}
