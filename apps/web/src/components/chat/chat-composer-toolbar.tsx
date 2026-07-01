"use client";

import { useQuery } from "@tanstack/react-query";
import {
	Bot,
	Blocks,
	Check,
	ChevronDown,
	ChevronRight,
	CircleDashed,
	Copy,
	Download,
	FileText,
	Image,
	Mic,
	MicOff,
	Paperclip,
	Plug,
	Settings2,
	Sparkles,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type { ChatAttachment } from "@/lib/chat-message";
import {
	type ChatToolMode,
	type ChatToolPolicy,
	type McpToolListResult,
	trpcClient,
} from "@/lib/trpc";
import { cn } from "@/lib/utils";

export interface ChatToolSelection {
	/** true = every skill in the workspace catalog is available (default);
	 * false = none. Simple on/off, matching the Skills pill's plain toggle. */
	skillsEnabled: boolean;
	mcpServerIds: string[];
	/** Entries shaped "serverId::toolName"; null means every tool from every
	 * server in mcpServerIds. */
	mcpToolFilter: string[] | null;
}

export interface AttachedFile {
	name: string;
	kind: ChatAttachment["kind"];
	mimeType: string;
	content: string;
}

interface MessageLike {
	role: string;
	content: string;
}

const CHAT_MODE_LABEL: Record<ChatToolMode, string> = {
	default: "Default",
	automatic: "Auto Tools",
	auto: "AUTO",
};

const CHAT_MODE_COPY: Record<ChatToolMode, { title: string; description: string }> = {
	default: {
		title: "Default",
		description: "Sensitive tools wait for approval and the assistant may ask before acting.",
	},
	automatic: {
		title: "Automatic Tool Usage",
		description:
			"The assistant plans and gathers context on its own, then uses tools directly unless a guardrail still requires approval.",
	},
	auto: {
		title: "AUTO",
		description:
			"No confirmation questions. The assistant plans, gathers context, and acts directly unless a configured guardrail sends that action to approval.",
	},
};

/** Pulls fenced code blocks out of assistant replies — the closest thing
 * this app has to "artifacts" without a real generated-file/canvas backend. */
function extractArtifacts(messages: MessageLike[]) {
	const pattern = /```(\w+)?\n([\s\S]*?)```/g;
	const artifacts: { id: string; language: string; code: string }[] = [];
	messages
		.filter((m) => m.role === "assistant")
		.forEach((m, messageIndex) => {
			let match = pattern.exec(m.content);
			let blockIndex = 0;
			while (match !== null) {
				artifacts.push({
					id: `${messageIndex}-${blockIndex}`,
					language: match[1] || "text",
					code: match[2]?.trim() ?? "",
				});
				blockIndex++;
				match = pattern.exec(m.content);
			}
		});
	return artifacts;
}

/** Rough token estimate (≈4 characters/token) — there's no real tokenizer
 * wired up client-side, so this is explicitly labeled as an estimate rather
 * than presented as an exact count. */
function estimateTokens(text: string) {
	return Math.max(1, Math.ceil(text.length / 4));
}

function extensionForLanguage(language: string) {
	const map: Record<string, string> = {
		ts: "ts",
		tsx: "tsx",
		js: "js",
		jsx: "jsx",
		python: "py",
		py: "py",
		bash: "sh",
		sh: "sh",
		json: "json",
		html: "html",
		css: "css",
		sql: "sql",
	};
	return map[language.toLowerCase()] ?? "txt";
}

function pillClass(active: boolean) {
	return cn(
		"flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
		active
			? "border-transparent bg-primary/15 text-primary hover:bg-primary/20"
			: "text-muted-foreground hover:bg-muted hover:text-foreground",
	);
}

function openAuthorizationWindow(authorizationUrl: string) {
	const popup = window.open(authorizationUrl, "_blank", "noopener,noreferrer");
	if (!popup) {
		window.location.href = authorizationUrl;
	}
}

function getAuthPrompt(result: McpToolListResult | undefined) {
	if (!result || result.status !== "auth_required") return null;
	return {
		message: result.message,
		authorizationUrl: result.authorizationUrl,
	};
}

function getInvalidConfigMessage(result: McpToolListResult | undefined) {
	if (!result || result.status !== "invalid_config") return null;
	return result.message;
}

export function ChatComposerToolbar({
	workspaceId,
	mode,
	toolSelection,
	onToolSelectionChange,
	chatToolPolicy,
	onChatToolPolicyChange,
	attachedFile,
	onAttachedFileChange,
	onVoiceResult,
	messages = [],
}: {
	workspaceId: string | undefined;
	mode: "full" | "compact";
	toolSelection: ChatToolSelection | null;
	onToolSelectionChange: (next: ChatToolSelection | null) => void;
	chatToolPolicy: ChatToolPolicy;
	onChatToolPolicyChange: (next: ChatToolPolicy) => void;
	attachedFile: AttachedFile | null;
	onAttachedFileChange: (file: AttachedFile | null) => void;
	onVoiceResult: (text: string) => void;
	messages?: MessageLike[];
}) {
	const [modeOpen, setModeOpen] = useState(false);
	const [mcpOpen, setMcpOpen] = useState(false);
	const [artifactsOpen, setArtifactsOpen] = useState(false);
	const [contextOpen, setContextOpen] = useState(false);
	const [expandedServerId, setExpandedServerId] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// Compact mode (in-thread) keeps the composer clean by default — Skills
	// and Artifacts only take up space in the row once the user has actually
	// reached for them via the settings menu below. Attachments show up
	// automatically once a file is attached, so they need no separate flag.
	// MCP Server always stays visible: it's the one control that must remain
	// reachable so tool changes mid-conversation are never buried in a menu.
	const [skillsPinned, setSkillsPinned] = useState(false);
	const [artifactsPinned, setArtifactsPinned] = useState(false);
	const initialPinRef = useRef(false);
	useEffect(() => {
		if (initialPinRef.current || !toolSelection) return;
		initialPinRef.current = true;
		// A chat that was previously customized to disable skills has a real,
		// non-default state worth surfacing immediately rather than hiding it.
		if (!toolSelection.skillsEnabled) setSkillsPinned(true);
	}, [toolSelection]);

	const mcpServersQuery = useQuery({
		queryKey: ["mcpServers", workspaceId],
		queryFn: () =>
			trpcClient.mcpServers.list.query({ workspaceId: workspaceId! }),
		enabled: Boolean(workspaceId),
	});
	const toolsQuery = useQuery({
		queryKey: ["mcpServers", "listTools", expandedServerId],
		queryFn: () =>
			trpcClient.mcpServers.listTools.query({ id: expandedServerId! }),
		enabled: Boolean(expandedServerId),
	});

	useEffect(() => {
		function handleMessage(event: MessageEvent) {
			if (event.origin !== window.location.origin) return;
			if (event.data?.type !== "nyxel:mcp-auth-complete") return;
			if (event.data.serverId !== expandedServerId) return;
			void toolsQuery.refetch();
		}

		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, [expandedServerId, toolsQuery]);

	const servers = mcpServersQuery.data ?? [];
	const toolsResult = toolsQuery.data;
	const availableTools =
		toolsResult?.status === "ready" ? toolsResult.tools : [];
	const authPrompt = getAuthPrompt(toolsResult);
	const invalidConfigMessage = getInvalidConfigMessage(toolsResult);
	const effective: ChatToolSelection = toolSelection ?? {
		skillsEnabled: true,
		mcpServerIds: servers.filter((s) => s.enabled).map((s) => s.id),
		mcpToolFilter: null,
	};
	const guardrailsLocked = chatToolPolicy.mode === "default";
	const skillsActive = effective.skillsEnabled;
	const mcpCustomized = toolSelection !== null;
	const modeLabel = CHAT_MODE_LABEL[chatToolPolicy.mode];

	function commit(patch: Partial<ChatToolSelection>) {
		onToolSelectionChange({ ...effective, ...patch });
	}

	function toggleSkills() {
		commit({ skillsEnabled: !effective.skillsEnabled });
	}

	function updateChatToolPolicy(patch: Partial<ChatToolPolicy>) {
		onChatToolPolicyChange({ ...chatToolPolicy, ...patch });
	}

	function toggleServer(serverId: string) {
		const next = effective.mcpServerIds.includes(serverId)
			? effective.mcpServerIds.filter((id) => id !== serverId)
			: [...effective.mcpServerIds, serverId];
		commit({ mcpServerIds: next });
	}

	function isToolChecked(serverId: string, toolName: string) {
		if (!effective.mcpToolFilter) return true;
		const touchesServer = effective.mcpToolFilter.some((e) =>
			e.startsWith(`${serverId}::`),
		);
		if (!touchesServer) return true;
		return effective.mcpToolFilter.includes(`${serverId}::${toolName}`);
	}

	function toggleTool(
		serverId: string,
		toolName: string,
		allToolNames: string[],
	) {
		const key = `${serverId}::${toolName}`;
		const currentForServer =
			effective.mcpToolFilter?.filter((e) => e.startsWith(`${serverId}::`)) ??
			allToolNames.map((n) => `${serverId}::${n}`);
		const otherServers = (effective.mcpToolFilter ?? []).filter(
			(e) => !e.startsWith(`${serverId}::`),
		);
		const nextForServer = currentForServer.includes(key)
			? currentForServer.filter((e) => e !== key)
			: [...currentForServer, key];
		commit({ mcpToolFilter: [...otherServers, ...nextForServer] });
	}

	function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		e.target.value = "";
		if (!file) return;
		const reader = new FileReader();
		const isImage = file.type.startsWith("image/");
		const isPdf =
			file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
		reader.onerror = () => {
			onAttachedFileChange(null);
		};
		reader.onload = () => {
			onAttachedFileChange({
				name: file.name,
				kind: isImage ? "image" : isPdf ? "pdf" : "text",
				mimeType:
					file.type ||
					(isImage
						? "image/*"
						: isPdf
							? "application/pdf"
							: "text/plain"),
				content: String(reader.result ?? ""),
			});
		};
		if (isImage || isPdf) {
			reader.readAsDataURL(file);
		} else {
			reader.readAsText(file);
		}
	}

	const mcpSummary = mcpCustomized
		? `${effective.mcpServerIds.length} selected`
		: "MCP Server";

	const artifacts = useMemo(() => extractArtifacts(messages), [messages]);

	const contextStats = useMemo(() => {
		const input = messages
			.filter((m) => m.role === "user")
			.reduce((sum, m) => sum + estimateTokens(m.content), 0);
		const output = messages
			.filter((m) => m.role === "assistant")
			.reduce((sum, m) => sum + estimateTokens(m.content), 0);
		return { input, output, total: input + output };
	}, [messages]);

	const voice = useVoiceInput(onVoiceResult);

	return (
		<div className="flex items-center gap-1.5">
			<input
				ref={fileInputRef}
				type="file"
				accept="image/*,.pdf,.txt,.md,.json,.csv,.log,.ts,.tsx,.js,.jsx,.py,.yml,.yaml"
				className="hidden"
				onChange={handleFilePick}
			/>

			{/* Single-line, horizontally scrollable pill row — never wraps. Wrapping
			 * here previously made this box taller than its siblings (the model
			 * picker, the send button), and with items-center on the parent row
			 * that made those siblings look like they were floating at odd
			 * vertical offsets instead of sitting on one clean line. */}
			<div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden">
				{mode === "full" && (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								aria-label="More tool options"
							>
								<Settings2 className="size-4" />
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" className="w-56">
							<DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
								<Paperclip className="size-4" />
								Attachment{attachedFile ? ` — ${attachedFile.name}` : ""}
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={toggleSkills}>
								<Sparkles className="size-4" />
								Skills — {skillsActive ? "on" : "off"}
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => setArtifactsOpen(true)}>
								<Blocks className="size-4" />
								Artifacts ({artifacts.length})
							</DropdownMenuItem>
							<DropdownMenuItem
								onSelect={(event) => {
									// Radix closes the DropdownMenu and returns focus to its
									// trigger by default on select. That focus-return races
									// against the Popover mounting in the same tick, and the
									// Popover's outside-interaction detection can mistake it
									// for a dismiss click — opening and immediately closing
									// the MCP popover. preventDefault stops Radix's default
									// close/focus-return so only our own state change fires.
									event.preventDefault();
									setMcpOpen(true);
								}}
							>
								<Plug className="size-4" />
								MCP Server ({mcpSummary})
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				)}

				{mode === "compact" && (
					<>
						<button
							type="button"
							onClick={() =>
								attachedFile
									? onAttachedFileChange(null)
									: fileInputRef.current?.click()
							}
							className={cn(
								"flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
								attachedFile
									? "bg-primary/15 text-primary hover:bg-primary/20"
									: "text-muted-foreground hover:bg-muted hover:text-foreground",
							)}
							aria-label={
								attachedFile
									? `Remove attachment (${attachedFile.name})`
									: "Attach an image, PDF, or text file"
							}
							title={
								attachedFile
									? `Attached: ${attachedFile.name}`
									: "Attach an image, PDF, or text file"
							}
						>
							<Paperclip className="size-4" />
						</button>

						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
									aria-label="More tool options"
								>
									<Settings2 className="size-4" />
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start" className="w-56">
								<DropdownMenuItem
									onSelect={() => fileInputRef.current?.click()}
								>
									<Paperclip className="size-4" />
									Attachment
									{attachedFile && <Check className="ml-auto size-3.5" />}
								</DropdownMenuItem>
								<DropdownMenuItem
									onSelect={() => {
										setSkillsPinned(true);
										if (!effective.skillsEnabled)
											commit({ skillsEnabled: true });
									}}
								>
									<Sparkles className="size-4" />
									Skills
									{skillsPinned && <Check className="ml-auto size-3.5" />}
								</DropdownMenuItem>
								<DropdownMenuItem
									onSelect={() => setArtifactsPinned((v) => !v)}
								>
									<Blocks className="size-4" />
									Artifacts
									{artifactsPinned && <Check className="ml-auto size-3.5" />}
								</DropdownMenuItem>
								<DropdownMenuItem
									onSelect={(event) => {
										// See the "full" mode MCP DropdownMenuItem above: without
										// preventDefault, Radix's default menu-close/focus-return
										// races the Popover's outside-interaction detection and
										// the popover closes itself right after opening.
										event.preventDefault();
										setMcpOpen(true);
									}}
								>
									<Plug className="size-4" />
									MCP Server
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>

						{attachedFile && (
							<button
								type="button"
								onClick={() => onAttachedFileChange(null)}
								className={pillClass(true)}
								title="Remove attachment"
							>
								{attachedFile.kind === "image" ? (
									<Image className="size-3.5" />
								) : attachedFile.kind === "pdf" ? (
									<FileText className="size-3.5" />
								) : (
									<Paperclip className="size-3.5" />
								)}
								{attachedFile.name}
								<X className="size-3 opacity-70" />
							</button>
						)}

						{skillsPinned && (
							<button
								type="button"
								onClick={() =>
									commit({ skillsEnabled: !effective.skillsEnabled })
								}
								className={pillClass(skillsActive)}
							>
								<Sparkles className="size-3.5" />
								Skills
							</button>
						)}

						{artifactsPinned && (
							<Popover open={artifactsOpen} onOpenChange={setArtifactsOpen}>
								<PopoverTrigger asChild>
									<button
										type="button"
										className={pillClass(artifacts.length > 0)}
									>
										<Blocks className="size-3.5" />
										Artifacts
										<Badge variant="outline" className="h-4 px-1.5 text-[10px]">
											{artifacts.length}
										</Badge>
										<ChevronDown className="size-3 opacity-60" />
									</button>
								</PopoverTrigger>
								<PopoverContent align="start" className="w-80">
									<ArtifactsList artifacts={artifacts} />
								</PopoverContent>
							</Popover>
						)}
					</>
				)}

				{mode === "full" && (
					<>
						<button
							type="button"
							onClick={() =>
								attachedFile
									? onAttachedFileChange(null)
									: fileInputRef.current?.click()
							}
							className={pillClass(Boolean(attachedFile))}
							title={
								attachedFile
									? "Remove attachment"
									: "Attach an image, PDF, or text file"
							}
						>
							{attachedFile?.kind === "image" ? (
								<Image className="size-3.5" />
							) : attachedFile?.kind === "pdf" ? (
								<FileText className="size-3.5" />
							) : (
								<Paperclip className="size-3.5" />
							)}
							{attachedFile ? attachedFile.name : "Attachment"}
							{attachedFile && <X className="size-3 opacity-70" />}
						</button>

						<button
							type="button"
							onClick={toggleSkills}
							className={pillClass(skillsActive)}
						>
							<Sparkles className="size-3.5" />
							Skills
						</button>

						<Popover open={artifactsOpen} onOpenChange={setArtifactsOpen}>
							<PopoverTrigger asChild>
								<button
									type="button"
									className={pillClass(artifacts.length > 0)}
								>
									<Blocks className="size-3.5" />
									Artifacts
									<Badge variant="outline" className="h-4 px-1.5 text-[10px]">
										{artifacts.length}
									</Badge>
									<ChevronDown className="size-3 opacity-60" />
								</button>
							</PopoverTrigger>
							<PopoverContent align="start" className="w-80">
								<ArtifactsList artifacts={artifacts} />
							</PopoverContent>
						</Popover>
					</>
				)}
			</div>

			{/* Rendered outside the overflow-x-auto pill row (above) on purpose:
			 * that row scrolls its contents off-screen once the other pills (File
			 * search, Skills, Artifacts) don't fit, which was silently hiding the
			 * MCP server selector with no visible affordance that it still
			 * existed. Keeping it in its own shrink-0 slot guarantees it's always
			 * reachable, matching the "always stays visible" intent already noted
			 * above for compact mode. */}
			<Popover open={modeOpen} onOpenChange={setModeOpen}>
				<PopoverTrigger asChild>
					<button
						type="button"
						className={cn(pillClass(chatToolPolicy.mode !== "default"), "shrink-0")}
					>
						<Bot className="size-3.5" />
						{modeLabel}
						<ChevronDown className="size-3 opacity-60" />
					</button>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-96 space-y-4">
					<div className="space-y-1">
						<p className="font-medium">Chat execution mode</p>
						<p className="text-xs text-muted-foreground">
							Choose how independently this chat should plan, gather context, and use tools.
						</p>
					</div>
					<div className="space-y-2">
						{(["default", "automatic", "auto"] as const).map((modeValue) => {
							const selected = chatToolPolicy.mode === modeValue;
							const option = CHAT_MODE_COPY[modeValue];
							return (
								<button
									key={modeValue}
									type="button"
									onClick={() => updateChatToolPolicy({ mode: modeValue })}
									className={cn(
										"w-full rounded-lg border px-3 py-2 text-left transition-colors",
										selected ? "border-primary bg-primary/5" : "hover:bg-muted/60",
									)}
								>
									<div className="flex items-center gap-2 text-sm font-medium">
										<span>{option.title}</span>
										{selected && <Check className="size-3.5 text-primary" />}
									</div>
									<p className="mt-1 text-xs text-muted-foreground">{option.description}</p>
								</button>
							);
						})}
					</div>
					<div className="space-y-3 border-t pt-3">
						<div className="space-y-1">
							<p className="text-sm font-medium">Approval guardrails</p>
							<p className="text-xs text-muted-foreground">
								Default mode always approves every sensitive action first. In Automatic Tool Usage and AUTO, these switches decide what still goes through Approvals.
							</p>
						</div>
						<div className="space-y-2">
							<div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
								<div>
									<p className="text-sm font-medium">Approve file writes</p>
									<p className="text-xs text-muted-foreground">Creating or editing files still waits for approval.</p>
								</div>
								<Switch
									checked={chatToolPolicy.approveFileWrites}
									disabled={guardrailsLocked}
									onCheckedChange={(checked) => updateChatToolPolicy({ approveFileWrites: checked })}
								/>
							</div>
							<div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
								<div>
									<p className="text-sm font-medium">Approve file deletions</p>
									<p className="text-xs text-muted-foreground">Deleting files still waits for approval.</p>
								</div>
								<Switch
									checked={chatToolPolicy.approveFileDeletes}
									disabled={guardrailsLocked}
									onCheckedChange={(checked) => updateChatToolPolicy({ approveFileDeletes: checked })}
								/>
							</div>
							<div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
								<div>
									<p className="text-sm font-medium">Approve custom code</p>
									<p className="text-xs text-muted-foreground">Custom-code skills still wait for approval.</p>
								</div>
								<Switch
									checked={chatToolPolicy.approveCustomCode}
									disabled={guardrailsLocked}
									onCheckedChange={(checked) => updateChatToolPolicy({ approveCustomCode: checked })}
								/>
							</div>
							<div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
								<div>
									<p className="text-sm font-medium">Approve MCP tools</p>
									<p className="text-xs text-muted-foreground">Third-party MCP tool calls still wait for approval.</p>
								</div>
								<Switch
									checked={chatToolPolicy.approveMcpTools}
									disabled={guardrailsLocked}
									onCheckedChange={(checked) => updateChatToolPolicy({ approveMcpTools: checked })}
								/>
							</div>
						</div>
					</div>
				</PopoverContent>
			</Popover>

			<Popover open={mcpOpen} onOpenChange={setMcpOpen}>
				<PopoverTrigger asChild>
					<button
						type="button"
						className={cn(pillClass(mcpCustomized), "shrink-0")}
					>
						<Plug className="size-3.5" />
						{mcpSummary}
						<ChevronDown className="size-3 opacity-60" />
					</button>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-80">
					<div className="flex items-center justify-between">
						<p className="font-medium">MCP servers for this chat</p>
						{mcpCustomized && (
							<button
								type="button"
								onClick={() => onToolSelectionChange(null)}
								className="text-xs text-muted-foreground underline-offset-2 hover:underline"
							>
								Reset
							</button>
						)}
					</div>
					<p className="-mt-2 mb-2 text-xs text-muted-foreground">
						By default this chat can reach every connected server. Uncheck any
						it shouldn't use.
					</p>
					<div className="max-h-72 space-y-1 overflow-y-auto">
						{servers.length === 0 && (
							<p className="text-xs text-muted-foreground">
								No MCP servers configured yet.
							</p>
						)}
						{servers.map((server) => {
							const checked = effective.mcpServerIds.includes(server.id);
							const expanded = expandedServerId === server.id;
							return (
								<div key={server.id} className="rounded-md">
									<div className="flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-muted/60">
										<div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
											<Plug className="size-3.5 text-muted-foreground" />
										</div>
										<div className="flex flex-1 items-center gap-1.5 truncate">
											<span className="truncate text-sm font-medium">
												{server.name}
											</span>
											<span
												className={cn(
													"size-1.5 shrink-0 rounded-full",
													server.enabled
														? "bg-emerald-500"
														: "bg-muted-foreground/40",
												)}
											/>
										</div>
										{checked && (
											<button
												type="button"
												onClick={() =>
													setExpandedServerId(expanded ? null : server.id)
												}
												className="text-muted-foreground hover:text-foreground"
												aria-label="Choose individual tools"
											>
												{expanded ? (
													<ChevronDown className="size-3.5" />
												) : (
													<ChevronRight className="size-3.5" />
												)}
											</button>
										)}
										<Checkbox
											checked={checked}
											disabled={!server.enabled}
											onCheckedChange={() => toggleServer(server.id)}
										/>
									</div>
									{expanded && checked && (
										<div className="ml-9 space-y-1 border-l pl-3">
											{toolsQuery.isLoading && (
												<p className="text-xs text-muted-foreground">
													Loading tools…
												</p>
											)}
											{toolsQuery.isError && (
												<p className="text-xs text-destructive">
													{(toolsQuery.error as Error).message}
												</p>
											)}
											{authPrompt && (
												<div className="space-y-1.5 text-xs text-muted-foreground">
													<p>{authPrompt.message}</p>
													<button
														type="button"
														className="font-medium text-foreground underline underline-offset-2"
														onClick={() =>
															openAuthorizationWindow(
																authPrompt.authorizationUrl,
															)
														}
													>
														Sign in to load tools
													</button>
												</div>
											)}
											{invalidConfigMessage && (
												<p className="text-xs text-destructive">
													{invalidConfigMessage}
												</p>
											)}
											{toolsResult?.status === "ready" &&
												availableTools.length === 0 && (
													<p className="text-xs text-muted-foreground">
														No tools exposed.
													</p>
												)}
											{availableTools.map((mcpTool) => (
												<div
													key={mcpTool.name}
													className="flex items-center gap-2"
												>
													<Checkbox
														id={`${server.id}-${mcpTool.name}`}
														checked={isToolChecked(server.id, mcpTool.name)}
														onCheckedChange={() =>
															toggleTool(
																server.id,
																mcpTool.name,
																availableTools.map((t) => t.name),
															)
														}
													/>
													<Label
														htmlFor={`${server.id}-${mcpTool.name}`}
														className="flex-1 truncate font-mono text-xs font-normal"
													>
														{mcpTool.name}
													</Label>
												</div>
											))}
										</div>
									)}
								</div>
							);
						})}
					</div>
				</PopoverContent>
			</Popover>

			<div className="flex shrink-0 items-center gap-1">
				{mode === "compact" && (
					<Popover open={contextOpen} onOpenChange={setContextOpen}>
						<PopoverTrigger asChild>
							<button
								type="button"
								className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								aria-label="Context window usage"
								title="Context window usage"
							>
								<CircleDashed className="size-4" />
							</button>
						</PopoverTrigger>
						<PopoverContent align="end" className="w-64 space-y-2">
							<div className="flex items-center justify-between text-sm font-medium">
								<span>Context window</span>
								<span>{contextStats.total}</span>
							</div>
							<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
								<div className="h-full w-1/3 rounded-full bg-primary" />
							</div>
							<div className="flex items-center justify-between text-xs text-muted-foreground">
								<span>Input</span>
								<span>{contextStats.input}</span>
							</div>
							<div className="flex items-center justify-between text-xs text-muted-foreground">
								<span>Output</span>
								<span>{contextStats.output}</span>
							</div>
							<p className="text-xs text-muted-foreground">
								Context size unknown for this model.
							</p>
							<p className="text-xs italic text-muted-foreground">
								Estimated from message history (~4 characters per token).
							</p>
						</PopoverContent>
					</Popover>
				)}

				<button
					type="button"
					onClick={voice.toggle}
					disabled={!voice.supported}
					title={
						voice.supported
							? "Voice input"
							: "Voice input isn't supported in this browser"
					}
					className={cn(
						"flex size-8 items-center justify-center rounded-full transition-colors disabled:opacity-30",
						voice.listening
							? "bg-destructive/15 text-destructive"
							: "text-muted-foreground hover:bg-muted hover:text-foreground",
					)}
				>
					{voice.listening ? (
						<MicOff className="size-4" />
					) : (
						<Mic className="size-4" />
					)}
				</button>
			</div>
		</div>
	);
}

function ArtifactsList({
	artifacts,
}: {
	artifacts: { id: string; language: string; code: string }[];
}) {
	const [copiedId, setCopiedId] = useState<string | null>(null);

	function copy(id: string, code: string) {
		navigator.clipboard?.writeText(code).then(() => {
			setCopiedId(id);
			setTimeout(
				() => setCopiedId((current) => (current === id ? null : current)),
				1500,
			);
		});
	}

	function download(id: string, language: string, code: string) {
		const blob = new Blob([code], { type: "text/plain" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `artifact-${id}.${extensionForLanguage(language)}`;
		a.click();
		URL.revokeObjectURL(url);
	}

	if (artifacts.length === 0) {
		return (
			<p className="text-xs text-muted-foreground">
				No artifacts yet — code blocks in the assistant's replies show up here.
			</p>
		);
	}

	return (
		<div className="max-h-72 space-y-2 overflow-y-auto">
			{artifacts.map((artifact) => (
				<div key={artifact.id} className="space-y-1.5 rounded-md border p-2">
					<div className="flex items-center justify-between">
						<Badge variant="outline" className="font-mono text-[10px]">
							{artifact.language}
						</Badge>
						<div className="flex items-center gap-1">
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="size-6"
								onClick={() => copy(artifact.id, artifact.code)}
								aria-label="Copy"
							>
								{copiedId === artifact.id ? (
									<Check className="size-3.5" />
								) : (
									<Copy className="size-3.5" />
								)}
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="size-6"
								onClick={() =>
									download(artifact.id, artifact.language, artifact.code)
								}
								aria-label="Download"
							>
								<Download className="size-3.5" />
							</Button>
						</div>
					</div>
					<pre className="max-h-24 overflow-auto rounded bg-muted p-2 text-[11px] leading-snug">
						{artifact.code.slice(0, 400)}
					</pre>
				</div>
			))}
		</div>
	);
}

interface MinimalSpeechRecognition {
	lang: string;
	continuous: boolean;
	interimResults: boolean;
	onresult:
		| ((event: {
				results: ArrayLike<ArrayLike<{ transcript: string }>>;
		  }) => void)
		| null;
	onend: (() => void) | null;
	onerror: (() => void) | null;
	start(): void;
	stop(): void;
}

/** Thin wrapper over the browser's native SpeechRecognition API — no server
 * round-trip, so it degrades to a disabled button in browsers that don't
 * implement it (Firefox, most non-Chromium engines) instead of pretending
 * to work. */
function useVoiceInput(onResult: (text: string) => void) {
	const [listening, setListening] = useState(false);
	const recognitionRef = useRef<MinimalSpeechRecognition | null>(null);
	const [supported, setSupported] = useState(false);

	useEffect(() => {
		const Ctor =
			(
				window as unknown as {
					SpeechRecognition?: new () => MinimalSpeechRecognition;
				}
			).SpeechRecognition ??
			(
				window as unknown as {
					webkitSpeechRecognition?: new () => MinimalSpeechRecognition;
				}
			).webkitSpeechRecognition;
		setSupported(Boolean(Ctor));
	}, []);

	function toggle() {
		const Ctor =
			(
				window as unknown as {
					SpeechRecognition?: new () => MinimalSpeechRecognition;
				}
			).SpeechRecognition ??
			(
				window as unknown as {
					webkitSpeechRecognition?: new () => MinimalSpeechRecognition;
				}
			).webkitSpeechRecognition;
		if (!Ctor) return;

		if (listening) {
			recognitionRef.current?.stop();
			setListening(false);
			return;
		}

		const recognition = new Ctor();
		recognition.lang =
			typeof navigator !== "undefined" ? navigator.language : "en-US";
		recognition.continuous = false;
		recognition.interimResults = false;
		recognition.onresult = (event) => {
			const transcript = Array.from(event.results)
				.map((result) => result[0]?.transcript ?? "")
				.join(" ")
				.trim();
			if (transcript) onResult(transcript);
		};
		recognition.onend = () => setListening(false);
		recognition.onerror = () => setListening(false);
		recognitionRef.current = recognition;
		recognition.start();
		setListening(true);
	}

	return { listening, toggle, supported };
}
