"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	AttachedFile,
	ChatToolSelection,
} from "@/components/chat/chat-composer-toolbar";
import { ChatInput } from "@/components/chat/chat-input";
import { MessageList } from "@/components/chat/message-list";
import { parseAssistantContent } from "@/lib/chat-prompts";
import {
	type ChatToolPolicy,
	DEFAULT_CHAT_TOOL_POLICY,
	trpcClient,
} from "@/lib/trpc";
import { useChatStream } from "@/lib/use-chat-stream";
import { useInstallation } from "@/lib/use-installation";

function getLastAssistantContent(
	messages: Array<{ role: string; content: string }>,
) {
	const lastMessage = messages.at(-1);
	if (lastMessage?.role !== "assistant") return null;

	const content = lastMessage.content.trim();
	return content || null;
}

function getPendingAssistantQuestion(
	messages: Array<{ role: string; content: string }>,
) {
	const content = getLastAssistantContent(messages);
	if (!content) return null;

	const parsed = parseAssistantContent(content);
	if (parsed.prompt) return null;

	return /[?؟]\s*$/.test(content) ||
		content.includes("?") ||
		content.includes("Could you") ||
		content.includes("Bitte")
		? content
		: null;
}

function getPendingAssistantPrompt(
	messages: Array<{ role: string; content: string }>,
) {
	const content = getLastAssistantContent(messages);
	if (!content) return null;

	const parsed = parseAssistantContent(content);
	return parsed.prompt;
}

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
		queryFn: () =>
			trpcClient.chats.list.query({ workspaceId: workspaceId ?? "" }),
		enabled: Boolean(workspaceId),
	});
	const chat = chatsQuery.data?.find((c) => c.id === chatId);
	const pendingQuestion = getPendingAssistantQuestion(messagesQuery.data ?? []);
	const pendingPrompt = getPendingAssistantPrompt(messagesQuery.data ?? []);

	// Tool calls needing a human decision (see ADR-0009) are a separate
	// approvals.list query, not part of the message content — filtered here to
	// this chat and merged into the timeline by MessageList so the person can
	// approve/reject right where the model paused, instead of having to visit
	// the workspace's Approvals page.
	const approvalsQuery = useQuery({
		queryKey: ["approvals", workspaceId, "all"],
		queryFn: () =>
			trpcClient.approvals.list.query({ workspaceId: workspaceId ?? "" }),
		enabled: Boolean(workspaceId),
		refetchInterval: 4_000,
	});
	const chatApprovals = (approvalsQuery.data ?? []).filter(
		(a) => a.chatId === chatId,
	);

	const [actingApprovalId, setActingApprovalId] = useState<string | null>(null);
	const invalidateApprovals = () => {
		queryClient.invalidateQueries({ queryKey: ["approvals", workspaceId] });
		queryClient.invalidateQueries({ queryKey: ["auditLog", workspaceId] });
	};
	const approveApproval = useMutation({
		mutationFn: (id: string) => trpcClient.approvals.approve.mutate({ id }),
		onMutate: (id: string) => setActingApprovalId(id),
		onSuccess: invalidateApprovals,
		onSettled: () => setActingApprovalId(null),
	});
	const rejectApproval = useMutation({
		mutationFn: (id: string) => trpcClient.approvals.reject.mutate({ id }),
		onMutate: (id: string) => setActingApprovalId(id),
		onSuccess: invalidateApprovals,
		onSettled: () => setActingApprovalId(null),
	});

	const agentQuery = useQuery({
		queryKey: ["agents", "get", chat?.agentId],
		queryFn: () => trpcClient.agents.get.query({ id: chat?.agentId ?? "" }),
		enabled: Boolean(chat?.agentId),
	});
	const skillsQuery = useQuery({
		queryKey: ["skills", "list", workspaceId],
		queryFn: () =>
			trpcClient.skills.list.query({ workspaceId: workspaceId ?? "" }),
		enabled: Boolean(workspaceId),
	});
	const mcpServersQuery = useQuery({
		queryKey: ["mcpServers", workspaceId],
		queryFn: () =>
			trpcClient.mcpServers.list.query({ workspaceId: workspaceId ?? "" }),
		enabled: Boolean(workspaceId),
	});

	const { sendMessage, streamingMessage, isStreaming, error } =
		useChatStream(chatId);

	// A tool call that needs approval is created server-side mid-stream, before
	// the assistant's final text is flushed — refetch right after the turn
	// finishes instead of waiting for approvalsQuery's 4s poll.
	const sendMessageAndCheckApprovals = useCallback(
		async (message: string) => {
			await sendMessage(message);
			queryClient.invalidateQueries({ queryKey: ["approvals", workspaceId] });
		},
		[sendMessage, queryClient, workspaceId],
	);

	const [toolSelection, setToolSelection] = useState<ChatToolSelection | null>(
		null,
	);
	const [chatToolPolicy, setChatToolPolicy] = useState<ChatToolPolicy>(
		DEFAULT_CHAT_TOOL_POLICY,
	);
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

	useEffect(() => {
		if (!chat) return;
		setChatToolPolicy(chat.toolPolicy);
	}, [chat]);

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
				skillIds: next.skillsEnabled
					? (skillsQuery.data ?? []).map((s) => s.id)
					: [],
				mcpServerIds: next.mcpServerIds,
				mcpToolFilter: next.mcpToolFilter,
				autoAttachWorkspaceTools: false,
			});
			await trpcClient.chats.setAgent.mutate({ chatId, agentId: agent.id });
			return agent;
		},
		onSuccess: (agent) => {
			queryClient.setQueryData(
				["chats", "list", workspaceId],
				(old: typeof chatsQuery.data) =>
					old?.map((c) => (c.id === chatId ? { ...c, agentId: agent.id } : c)),
			);
		},
	});

	const updateChatToolPolicy = useMutation({
		mutationFn: async (next: ChatToolPolicy) => {
			if (!chat) throw new Error("Chat isn't loaded yet.");
			return trpcClient.chats.setToolPolicy.mutate({
				chatId,
				toolMode: next.mode,
				toolPolicy: next,
			});
		},
		onSuccess: (updated) => {
			queryClient.setQueryData(
				["chats", "list", workspaceId],
				(old: typeof chatsQuery.data) =>
					old?.map((c) => (c.id === chatId ? updated : c)),
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
			mcpServerIds: (mcpServersQuery.data ?? [])
				.filter((s) => s.enabled)
				.map((s) => s.id),
			mcpToolFilter: null,
		};
		forkAgent.mutate(toFork);
	}

	function handleChatToolPolicyChange(next: ChatToolPolicy) {
		setChatToolPolicy(next);
		updateChatToolPolicy.mutate(next);
	}

	// A chat created from the landing page's composer arrives here with its
	// first message tucked into ?draft= — send it once, then drop the param
	// from the URL so refreshing doesn't resend it.
	useEffect(() => {
		const sessionDraft =
			typeof window !== "undefined"
				? window.sessionStorage.getItem(`nyxel:chat-draft:${chatId}`)
				: null;
		const nextDraft = draft ?? sessionDraft;
		if (nextDraft && !sentDraftRef.current) {
			sentDraftRef.current = true;
			sendMessageAndCheckApprovals(nextDraft);
			window.sessionStorage.removeItem(`nyxel:chat-draft:${chatId}`);
			router.replace(`/chat/${chatId}`);
		}
	}, [draft, chatId, router, sendMessageAndCheckApprovals]);

	return (
		<div className="mx-auto flex h-full max-w-3xl flex-col p-4">
			{chat?.workingDirectory && (
				<div className="mb-3 rounded-xl border border-dashed px-3 py-2 text-sm text-muted-foreground">
					<span className="font-medium text-foreground">
						Working directory:
					</span>{" "}
					{chat.workingDirectory}
				</div>
			)}
			<MessageList
				messages={messagesQuery.data ?? []}
				streamingMessage={streamingMessage}
				approvals={chatApprovals}
				actingApprovalId={actingApprovalId}
				onApproveApproval={(id) => approveApproval.mutate(id)}
				onRejectApproval={(id) => rejectApproval.mutate(id)}
			/>
			{(error || forkAgent.isError || updateChatToolPolicy.isError) && (
				<p className="mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
					{error ??
						(forkAgent.error as Error | undefined)?.message ??
						(updateChatToolPolicy.error as Error | undefined)?.message}
				</p>
			)}
			<ChatInput
				onSend={sendMessageAndCheckApprovals}
				disabled={isStreaming}
				workspaceId={workspaceId}
				toolSelection={toolSelection}
				onToolSelectionChange={handleToolSelectionChange}
				chatToolPolicy={chatToolPolicy}
				onChatToolPolicyChange={handleChatToolPolicyChange}
				attachedFile={attachedFile}
				onAttachedFileChange={setAttachedFile}
				messages={messagesQuery.data ?? []}
				assistantQuestion={pendingQuestion}
				assistantPrompt={pendingPrompt}
			/>
		</div>
	);
}
