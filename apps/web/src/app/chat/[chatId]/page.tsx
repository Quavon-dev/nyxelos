"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { AttachedFile, ChatToolSelection } from "@/components/chat/chat-composer-toolbar";
import { ChatInput } from "@/components/chat/chat-input";
import { MessageList } from "@/components/chat/message-list";
import { trpcClient } from "@/lib/trpc";
import { useChatStream } from "@/lib/use-chat-stream";
import { useInstallation } from "@/lib/use-installation";

export default function ChatPage() {
  const params = useParams<{ chatId: string }>();
  const chatId = params.chatId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const draft = searchParams.get("draft");
  const sentDraftRef = useRef(false);
  const queryClient = useQueryClient();

  const installationQuery = useInstallation();
  const workspaceId = installationQuery.data?.record?.primaryWorkspaceId;

  const messagesQuery = useQuery({
    queryKey: ["messages", chatId],
    queryFn: () => trpcClient.chats.messages.query({ chatId }),
  });
  const chatsQuery = useQuery({
    queryKey: ["chats", "list", workspaceId],
    queryFn: () => trpcClient.chats.list.query({ workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
  });
  const chat = chatsQuery.data?.find((c) => c.id === chatId);

  const agentQuery = useQuery({
    queryKey: ["agents", "get", chat?.agentId],
    queryFn: () => trpcClient.agents.get.query({ id: chat!.agentId! }),
    enabled: Boolean(chat?.agentId),
  });
  const skillsQuery = useQuery({
    queryKey: ["skills", "list", workspaceId],
    queryFn: () => trpcClient.skills.list.query({ workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
  });
  const mcpServersQuery = useQuery({
    queryKey: ["mcpServers", workspaceId],
    queryFn: () => trpcClient.mcpServers.list.query({ workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
  });

  const { sendMessage, streamingMessage, isStreaming, error } = useChatStream(chatId);

  const [toolSelection, setToolSelection] = useState<ChatToolSelection | null>(null);
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const initializedToolsRef = useRef(false);

  // Seed the toolbar's displayed selection from the chat's current agent,
  // once. "Auto assistant …" agents represent live workspace defaults (shown
  // as null/"everything"); any other agent is a prior custom selection made
  // from this same toolbar and should be reflected as-is.
  useEffect(() => {
    if (initializedToolsRef.current || !agentQuery.data) return;
    initializedToolsRef.current = true;
    const agent = agentQuery.data;
    if (agent.name.startsWith("Auto assistant ")) {
      setToolSelection(null);
    } else {
      setToolSelection({
        skillsEnabled: agent.skillIds.length > 0,
        mcpServerIds: agent.mcpServerIds,
        mcpToolFilter: agent.mcpToolFilter,
      });
    }
  }, [agentQuery.data]);

  // Mid-conversation tool changes can't safely mutate the chat's existing
  // agent (it may be a shared "Auto assistant" reused elsewhere), so instead
  // this forks a fresh one-off agent reflecting the new selection and
  // re-points the chat at it via chats.setAgent. The next sendMessage call
  // resolves the agent from the chat row server-side, so this takes effect
  // immediately without touching useChatStream.
  const forkAgent = useMutation({
    mutationFn: async (next: ChatToolSelection) => {
      if (!workspaceId || !chat) throw new Error("Chat isn't loaded yet.");
      const agent = await trpcClient.agents.create.mutate({
        workspaceId,
        name: "Chat — custom tools",
        modelId: chat.modelId,
        autonomyLevel: "assisted",
        skillIds: next.skillsEnabled ? (skillsQuery.data ?? []).map((s) => s.id) : [],
        mcpServerIds: next.mcpServerIds,
        mcpToolFilter: next.mcpToolFilter,
        autoAttachWorkspaceTools: false,
      });
      await trpcClient.chats.setAgent.mutate({ chatId, agentId: agent.id });
      return agent;
    },
    onSuccess: (agent) => {
      queryClient.setQueryData(["chats", "list", workspaceId], (old: typeof chatsQuery.data) =>
        old?.map((c) => (c.id === chatId ? { ...c, agentId: agent.id } : c)),
      );
    },
  });

  function handleToolSelectionChange(next: ChatToolSelection | null) {
    setToolSelection(next);
    // Resetting to "default" still pins a concrete agent (rather than
    // reverting to the shared auto-assistant) so the fork is a snapshot of
    // today's workspace defaults — it just won't pick up new skills/servers
    // added to the workspace later in this same conversation.
    const toFork: ChatToolSelection = next ?? {
      skillsEnabled: true,
      mcpServerIds: (mcpServersQuery.data ?? []).filter((s) => s.enabled).map((s) => s.id),
      mcpToolFilter: null,
    };
    forkAgent.mutate(toFork);
  }

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
      {(error || forkAgent.isError) && (
        <p className="mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error ?? (forkAgent.error as Error).message}
        </p>
      )}
      <ChatInput
        onSend={sendMessage}
        disabled={isStreaming}
        workspaceId={workspaceId}
        toolSelection={toolSelection}
        onToolSelectionChange={handleToolSelectionChange}
        attachedFile={attachedFile}
        onAttachedFileChange={setAttachedFile}
        messages={messagesQuery.data ?? []}
      />
    </div>
  );
}
