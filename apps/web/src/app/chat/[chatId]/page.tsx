"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	AttachedFile,
	ChatToolSelection,
} from "@/components/chat/chat-composer-toolbar";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatTopBar } from "@/components/chat/chat-top-bar";
import { MessageList } from "@/components/chat/message-list";
import { parseAgentActivity } from "@/lib/chat-agent-activity";
import { parseAssistantContent } from "@/lib/chat-prompts";
import { type ChatToolMode, trpcClient } from "@/lib/trpc";
import { useChatStream } from "@/lib/use-chat-stream";
import { useInstallation } from "@/lib/use-installation";

function getLastAssistantContent(
	messages: Array<{ role: string; content: string }>,
) {
	const lastMessage = messages.at(-1);
	if (lastMessage?.role !== "assistant") return null;

	// Strip the trailing ```nyxel-activity block (see chat-agent-activity.ts)
	// before this text is ever shown verbatim — e.g. the "Nyxel asked: …"
	// banner below — otherwise the raw reasoning/tool-call JSON leaks into it.
	const content = parseAgentActivity(lastMessage.content).body.trim();
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

	// Durable tasks created from this chat via the workspace_task_create
	// management tool — task.sourceChatId is set server-side (see
	// management-tools.ts), so this is a real link rather than text-parsing.
	const tasksQuery = useQuery({
		queryKey: ["tasks", workspaceId, "all"],
		queryFn: () => trpcClient.tasks.list.query({ workspaceId: workspaceId ?? "" }),
		enabled: Boolean(workspaceId),
		refetchInterval: 8_000,
	});
	const agentsForTasksQuery = useQuery({
		queryKey: ["agents", workspaceId],
		queryFn: () => trpcClient.agents.list.query({ workspaceId: workspaceId ?? "" }),
		enabled: Boolean(workspaceId),
	});
	const chatTasks = (tasksQuery.data ?? [])
		.filter((t) => t.sourceChatId === chatId)
		.map((t) => ({
			id: t.id,
			title: t.title,
			status: t.status,
			priority: t.priority,
			assignedAgentName:
				agentsForTasksQuery.data?.find((a) => a.id === t.assignedAgentId)?.name ?? null,
			createdAt: t.createdAt,
		}));

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
	const toolsQuery = useQuery({
		queryKey: ["tools", "list", workspaceId],
		queryFn: () =>
			trpcClient.tools.list.query({ workspaceId: workspaceId ?? "" }),
		enabled: Boolean(workspaceId),
	});
	const mcpServersQuery = useQuery({
		queryKey: ["mcpServers", workspaceId],
		queryFn: () =>
			trpcClient.mcpServers.list.query({ workspaceId: workspaceId ?? "" }),
		enabled: Boolean(workspaceId),
	});
	const modelsQuery = useQuery({
		queryKey: ["models", "list", workspaceId],
		queryFn: () => trpcClient.models.list.query({ workspaceId }),
		enabled: Boolean(workspaceId),
	});

	// "Nachdenken" (extended thinking) — remembered across chats so the person
	// doesn't have to re-enable their preferred mode on every new thread.
	const [reasoningEnabled, setReasoningEnabled] = useState(false);
	useEffect(() => {
		setReasoningEnabled(localStorage.getItem("nyxel:reasoning") === "1");
	}, []);
	const handleReasoningChange = useCallback((enabled: boolean) => {
		setReasoningEnabled(enabled);
		localStorage.setItem("nyxel:reasoning", enabled ? "1" : "0");
	}, []);

	const { sendMessage, editMessage, regenerate, streamingMessage, isStreaming, error } =
		useChatStream(chatId, { reasoning: reasoningEnabled });

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
	const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
	const initializedToolsRef = useRef(false);
	// Id of the one-off "Chat — custom tools" agent this chat already owns, if
	// any — once forked, every later toolbar tweak updates that same agent in
	// place instead of forking a new one, otherwise every checkbox click in
	// the toolbar (chat-composer-toolbar.tsx fires onChange per click) left
	// behind an abandoned agent row forever. Safe to mutate in place because
	// chats.setAgent always points a chat at a freshly forked agent no other
	// chat shares — see updateChatAgent's doc comment in packages/db.
	const forkedAgentIdRef = useRef<string | null>(null);

	// "Edit" on a past user turn (message-bubble.tsx's inline editor) rewrites
	// that message in place and drops everything that followed it, then
	// regenerates from there — see editMessageId handling in chat-stream.ts.
	const handleEditMessage = useCallback(
		async (messageId: string, text: string) => {
			await editMessage(messageId, text);
			queryClient.invalidateQueries({ queryKey: ["approvals", workspaceId] });
		},
		[editMessage, queryClient, workspaceId],
	);

	// "Regenerate" (message-actions.tsx) drops the stale last assistant reply
	// and asks for a fresh one to the existing last user turn in place — see
	// the `regenerate` flag in chat-stream.ts.
	const handleRegenerate = useCallback(async () => {
		await regenerate();
		queryClient.invalidateQueries({ queryKey: ["approvals", workspaceId] });
	}, [regenerate, queryClient, workspaceId]);

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
			if (agent.name === "Chat — custom tools") {
				forkedAgentIdRef.current = agent.id;
			}
			setToolSelection({
				skillIds: agent.skillIds,
				toolIds: agent.toolIds,
				mcpServerIds: agent.mcpServerIds,
				mcpToolFilter: agent.mcpToolFilter,
			});
		}
	}, [agentQuery.data]);

	// Mid-conversation tool/model changes can't safely mutate the chat's
	// existing agent (it may be a shared "Auto assistant" reused elsewhere), so
	// instead this forks a fresh one-off agent reflecting the new selection and
	// re-points the chat at it via chats.setAgent. The next sendMessage call
	// resolves the agent from the chat row server-side, so this takes effect
	// immediately without touching useChatStream.
	const forkAgent = useMutation({
		mutationFn: async ({
			toolSelection: next,
			modelId,
		}: {
			toolSelection: ChatToolSelection;
			modelId: string;
		}) => {
			if (!workspaceId || !chat) throw new Error("Chat isn't loaded yet.");

			if (forkedAgentIdRef.current) {
				return trpcClient.agents.update.mutate({
					id: forkedAgentIdRef.current,
					modelId,
					skillIds: next.skillIds,
					toolIds: next.toolIds,
					mcpServerIds: next.mcpServerIds,
					mcpToolFilter: next.mcpToolFilter,
				});
			}

			const agent = await trpcClient.agents.create.mutate({
				workspaceId,
				name: "Chat — custom tools",
				modelId,
				autonomyLevel: "assisted",
				skillIds: next.skillIds,
				toolIds: next.toolIds,
				mcpServerIds: next.mcpServerIds,
				mcpToolFilter: next.mcpToolFilter,
				autoAttachWorkspaceTools: false,
			});
			await trpcClient.chats.setAgent.mutate({ chatId, agentId: agent.id });
			forkedAgentIdRef.current = agent.id;
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

	const duplicateChat = useMutation({
		mutationFn: () => trpcClient.chats.duplicate.mutate({ chatId }),
		onSuccess: (duplicated) => {
			queryClient.invalidateQueries({ queryKey: ["chats", workspaceId] });
			router.push(`/chat/${duplicated.id}`);
		},
	});

	const pinChat = useMutation({
		mutationFn: (pinned: boolean) =>
			trpcClient.chats.setPinned.mutate({ chatId, pinned }),
		onSuccess: (updated) => {
			queryClient.setQueryData(
				["chats", "list", workspaceId],
				(old: typeof chatsQuery.data) =>
					old?.map((c) => (c.id === chatId ? updated : c)),
			);
		},
	});

	const shareChat = useMutation({
		mutationFn: () => trpcClient.chats.share.mutate({ chatId }),
		onSuccess: (shared) => {
			queryClient.setQueryData(
				["chats", "list", workspaceId],
				(old: typeof chatsQuery.data) =>
					old?.map((c) => (c.id === chatId ? shared : c)),
			);
			if (shared.shareId && typeof window !== "undefined") {
				navigator.clipboard
					?.writeText(`${window.location.origin}/share/${shared.shareId}`)
					.catch(() => {
						// Clipboard access can be denied by the browser — the chat is
						// still shared and reachable from the sidebar's share dialog.
					});
			}
		},
	});

	const updateToolMode = useMutation({
		mutationFn: (nextMode: ChatToolMode) => {
			if (!chat) throw new Error("Chat isn't loaded yet.");
			const nextPolicy =
				nextMode === "auto"
					? {
							mode: "auto" as const,
							approveFileWrites: false,
							approveFileDeletes: false,
							approveCustomCode: false,
							approveMcpTools: false,
						}
					: { ...chat.toolPolicy, mode: nextMode };
			return trpcClient.chats.setToolPolicy.mutate({
				chatId,
				toolMode: nextMode,
				toolPolicy: nextPolicy,
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

	const currentModelId = agentQuery.data?.modelId ?? chat?.modelId;

	// Shared with handleModelChange below — resetting tool selection to
	// "default" still pins a concrete agent (rather than reverting to the
	// shared auto-assistant) so the fork is a snapshot of today's workspace
	// defaults — it just won't pick up new skills/servers added to the
	// workspace later in this same conversation.
	function defaultToolSelection(): ChatToolSelection {
		return {
			skillIds: (skillsQuery.data ?? []).map((s) => s.id),
			toolIds: (toolsQuery.data ?? []).filter((t) => t.enabled).map((t) => t.id),
			mcpServerIds: (mcpServersQuery.data ?? [])
				.filter((s) => s.enabled)
				.map((s) => s.id),
			mcpToolFilter: null,
		};
	}

	function handleToolSelectionChange(next: ChatToolSelection | null) {
		setToolSelection(next);
		if (!currentModelId) return;
		forkAgent.mutate({
			toolSelection: next ?? defaultToolSelection(),
			modelId: currentModelId,
		});
	}

	function handleModelChange(nextModelId: string) {
		if (nextModelId === currentModelId) return;
		forkAgent.mutate({
			toolSelection: toolSelection ?? defaultToolSelection(),
			modelId: nextModelId,
		});
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
		<div className="flex h-full flex-col">
			<div className="px-4 pt-3">
				<ChatTopBar
					models={modelsQuery.data ?? []}
					modelId={currentModelId}
					onModelChange={handleModelChange}
					onNewChat={() => router.push("/chat")}
					onDuplicate={() => duplicateChat.mutate()}
					onShare={() => shareChat.mutate()}
					onTogglePin={() => chat && pinChat.mutate(!chat.pinnedAt)}
					pinned={Boolean(chat?.pinnedAt)}
				/>
			</div>
			<div className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col p-4 pt-0">
				<MessageList
					messages={messagesQuery.data ?? []}
					streamingMessage={streamingMessage}
					approvals={chatApprovals}
					tasks={chatTasks}
					workspaceId={workspaceId}
					actingApprovalId={actingApprovalId}
					onApproveApproval={(id) => approveApproval.mutate(id)}
					onRejectApproval={(id) => rejectApproval.mutate(id)}
					onEditMessage={handleEditMessage}
					onRegenerate={handleRegenerate}
				/>
				{(error || forkAgent.isError || updateToolMode.isError) && (
					<p className="mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
						{error ??
							(forkAgent.error as Error | undefined)?.message ??
							(updateToolMode.error as Error | undefined)?.message}
					</p>
				)}
				<ChatInput
					onSend={sendMessageAndCheckApprovals}
					disabled={isStreaming}
					workspaceId={workspaceId}
					modelId={agentQuery.data?.modelId ?? chat?.modelId}
					toolSelection={toolSelection}
					onToolSelectionChange={handleToolSelectionChange}
					toolMode={chat?.toolPolicy.mode ?? "default"}
					onToolModeChange={(next) => updateToolMode.mutate(next)}
					attachedFile={attachedFile}
					onAttachedFileChange={setAttachedFile}
					messages={messagesQuery.data ?? []}
					assistantQuestion={pendingQuestion}
					assistantPrompt={pendingPrompt}
					reasoningEnabled={reasoningEnabled}
					onReasoningChange={handleReasoningChange}
				/>
			</div>
		</div>
	);
}
