"use client";

import { useQuery } from "@tanstack/react-query";
import {
	Blocks,
	Bot,
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
	Rocket,
	Settings2,
	ShieldCheck,
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
import type { ChatAttachment } from "@/lib/chat-message";
import {
	type ChatToolMode,
	type McpToolListResult,
	trpcClient,
} from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ToolsAndSkillsPicker } from "./tools-and-skills-picker";

const CHAT_MODES = ["default", "automatic", "auto"] as const;

const CHAT_MODE_LABEL: Record<ChatToolMode, string> = {
	default: "Default",
	automatic: "Auto Tools",
	auto: "AUTO",
};

const CHAT_MODE_COPY: Record<
	ChatToolMode,
	{ title: string; description: string; icon: typeof Bot }
> = {
	default: {
		title: "Default",
		description: "Sensitive tools wait for approval before running.",
		icon: ShieldCheck,
	},
	automatic: {
		title: "Automatic Tool Usage",
		description: "Plans and uses tools directly, unless a guardrail applies.",
		icon: Bot,
	},
	auto: {
		title: "AUTO",
		description: "Fully autonomous — acts immediately, no guardrails.",
		icon: Rocket,
	},
};

export interface ChatToolSelection {
	/** Explicit per-item selection — see ToolsAndSkillsPicker. Replaced the
	 * earlier coarse skillsEnabled/toolsEnabled booleans once there were
	 * enough categorized tools that "all or nothing" stopped being useful. */
	skillIds: string[];
	toolIds: string[];
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
	modelId,
	mode,
	toolSelection,
	onToolSelectionChange,
	toolMode,
	onToolModeChange,
	attachedFile,
	onAttachedFileChange,
	onVoiceResult,
	messages = [],
	showContextWindow = true,
}: {
	workspaceId: string | undefined;
	/** The model this chat/agent will actually send to — used to look up
	 * attachment capabilities so the composer can show whether an image/PDF
	 * will be sent natively or via server-side extraction fallback. */
	modelId?: string;
	mode: "full" | "compact";
	toolSelection: ChatToolSelection | null;
	onToolSelectionChange: (next: ChatToolSelection | null) => void;
	toolMode: ChatToolMode;
	onToolModeChange: (next: ChatToolMode) => void;
	attachedFile: AttachedFile | null;
	onAttachedFileChange: (file: AttachedFile | null) => void;
	onVoiceResult: (text: string) => void;
	messages?: MessageLike[];
	/** Context window usage only means something once a chat actually has
	 * messages — the pre-chat composer (app/chat/page.tsx) has no thread yet,
	 * so it stays hidden there and only appears inside an actual chat. */
	showContextWindow?: boolean;
}) {
	const attachmentCapabilitiesQuery = useQuery({
		queryKey: ["models", "capabilities", workspaceId, modelId],
		queryFn: () =>
			trpcClient.models.capabilities.query({ workspaceId: workspaceId as string, modelId: modelId as string }),
		enabled:
			Boolean(workspaceId) &&
			Boolean(modelId) &&
			(attachedFile?.kind === "image" || attachedFile?.kind === "pdf"),
	});
	const attachmentCapabilityCopy = (() => {
		if (!attachedFile || attachedFile.kind === "text") return null;
		const caps = attachmentCapabilitiesQuery.data;
		if (!caps) return null;
		if (attachedFile.kind === "image") {
			return caps.nativeImageInput
				? "Processed natively by the selected model"
				: "Native vision unavailable; sent as metadata fallback";
		}
		return caps.nativeDocumentInput
			? "Processed natively by the selected model"
			: "Converted to extracted text before sending";
	})();

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
	const [toolsPickerOpen, setToolsPickerOpen] = useState(false);
	const [artifactsPinned, setArtifactsPinned] = useState(false);

	const mcpServersQuery = useQuery({
		queryKey: ["mcpServers", workspaceId],
		queryFn: () =>
			trpcClient.mcpServers.list.query({ workspaceId: workspaceId! }),
		enabled: Boolean(workspaceId),
	});
	const mcpToolsQuery = useQuery({
		queryKey: ["mcpServers", "listTools", expandedServerId],
		queryFn: () =>
			trpcClient.mcpServers.listTools.query({ id: expandedServerId! }),
		enabled: Boolean(expandedServerId),
	});
	const skillsQuery = useQuery({
		queryKey: ["skills", "list", workspaceId],
		queryFn: () => trpcClient.skills.list.query({ workspaceId: workspaceId! }),
		enabled: Boolean(workspaceId),
	});
	const workspaceToolsQuery = useQuery({
		queryKey: ["tools", "list", workspaceId],
		queryFn: () => trpcClient.tools.list.query({ workspaceId: workspaceId! }),
		enabled: Boolean(workspaceId),
	});

	useEffect(() => {
		function handleMessage(event: MessageEvent) {
			if (event.origin !== window.location.origin) return;
			if (event.data?.type !== "nyxel:mcp-auth-complete") return;
			if (event.data.serverId !== expandedServerId) return;
			void mcpToolsQuery.refetch();
		}

		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, [expandedServerId, mcpToolsQuery]);

	const servers = mcpServersQuery.data ?? [];
	const toolsResult = mcpToolsQuery.data;
	const availableTools =
		toolsResult?.status === "ready" ? toolsResult.tools : [];
	const authPrompt = getAuthPrompt(toolsResult);
	const invalidConfigMessage = getInvalidConfigMessage(toolsResult);
	const effective: ChatToolSelection = toolSelection ?? {
		skillIds: (skillsQuery.data ?? []).map((s) => s.id),
		toolIds: (workspaceToolsQuery.data ?? [])
			.filter((t) => t.enabled)
			.map((t) => t.id),
		mcpServerIds: servers.filter((s) => s.enabled).map((s) => s.id),
		mcpToolFilter: null,
	};
	const toolsAndSkillsCustomized = toolSelection !== null;
	const toolsAndSkillsSummary = toolsAndSkillsCustomized
		? `${effective.skillIds.length + effective.toolIds.length} selected`
		: "Skills & Tools";
	const mcpCustomized = toolSelection !== null;

	function commit(patch: Partial<ChatToolSelection>) {
		onToolSelectionChange({ ...effective, ...patch });
	}

	// Lets the mode popover be driven like a numbered menu: while it's open,
	// pressing 1/2/3 picks the matching mode and closes it — mirrors the
	// Claude Code CLI's own permission-mode switcher.
	useEffect(() => {
		if (!modeOpen) return;
		function handleKeyDown(event: KeyboardEvent) {
			const index = Number(event.key) - 1;
			if (!Number.isInteger(index) || index < 0 || index >= CHAT_MODES.length)
				return;
			const modeValue = CHAT_MODES[index];
			if (!modeValue) return;
			event.preventDefault();
			onToolModeChange(modeValue);
			setModeOpen(false);
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [modeOpen, onToolModeChange]);

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
			file.type === "application/pdf" ||
			file.name.toLowerCase().endsWith(".pdf");
		reader.onerror = () => {
			onAttachedFileChange(null);
		};
		reader.onload = () => {
			onAttachedFileChange({
				name: file.name,
				kind: isImage ? "image" : isPdf ? "pdf" : "text",
				mimeType:
					file.type ||
					(isImage ? "image/*" : isPdf ? "application/pdf" : "text/plain"),
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
							<DropdownMenuItem
								onSelect={(event) => {
									event.preventDefault();
									setToolsPickerOpen(true);
								}}
							>
								<Sparkles className="size-4" />
								Skills &amp; Tools ({toolsAndSkillsSummary})
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
									onSelect={(event) => {
										event.preventDefault();
										setToolsPickerOpen(true);
									}}
								>
									<Sparkles className="size-4" />
									Skills &amp; Tools
									{toolsAndSkillsCustomized && (
										<Check className="ml-auto size-3.5" />
									)}
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
						{attachmentCapabilityCopy && (
							<span
								className="shrink-0 rounded-full border border-transparent bg-muted px-2.5 py-1 text-[11px] text-muted-foreground"
								title={attachmentCapabilityCopy}
							>
								{attachmentCapabilityCopy}
							</span>
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

			{/* Rendered outside the overflow-x-auto pill row (above) on purpose: that
			 * row scrolls its contents off-screen once the other pills (File search,
			 * Skills, Artifacts) don't fit, which was silently hiding this selector
			 * with no visible affordance that it still existed. Keeping it in its
			 * own shrink-0 slot guarantees it's always reachable. Guardrail switches
			 * live in workspace settings — this picks only which mode this chat
			 * uses; the guardrail values underneath come from the workspace default. */}
			<Popover open={modeOpen} onOpenChange={setModeOpen}>
				<PopoverTrigger asChild>
					<button
						type="button"
						className={cn(pillClass(toolMode !== "default"), "shrink-0")}
					>
						{(() => {
							const ModeIcon = CHAT_MODE_COPY[toolMode].icon;
							return <ModeIcon className="size-3.5" />;
						})()}
						{CHAT_MODE_LABEL[toolMode]}
						<ChevronDown className="size-3 opacity-60" />
					</button>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-80">
					<p className="px-1 pb-2 text-xs font-medium text-muted-foreground">
						Mode
					</p>
					<div className="space-y-1">
						{CHAT_MODES.map((modeValue) => {
							const selected = toolMode === modeValue;
							const option = CHAT_MODE_COPY[modeValue];
							return (
								<button
									key={modeValue}
									type="button"
									onClick={() => {
										onToolModeChange(modeValue);
										setModeOpen(false);
									}}
									className={cn(
										"flex w-full items-start gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors",
										selected ? "bg-primary/10" : "hover:bg-muted/60",
									)}
								>
									<div
										className={cn(
											"flex size-7 shrink-0 items-center justify-center rounded-md",
											selected
												? "bg-primary/15 text-primary"
												: "bg-muted text-muted-foreground",
										)}
									>
										<option.icon className="size-3.5" />
									</div>
									<div className="min-w-0 flex-1 pt-0.5">
										<p className="text-sm font-medium">{option.title}</p>
										<p className="mt-0.5 text-xs text-muted-foreground">
											{option.description}
										</p>
									</div>
									{selected && (
										<Check className="mt-1.5 size-3.5 shrink-0 text-primary" />
									)}
								</button>
							);
						})}
					</div>
					<p className="mt-3 border-t px-1 pt-3 text-xs text-muted-foreground">
						Approval guardrails for this workspace are set in{" "}
						<strong className="text-foreground">
							Workspace settings → Approvals
						</strong>
						.
					</p>
				</PopoverContent>
			</Popover>

			<Popover open={toolsPickerOpen} onOpenChange={setToolsPickerOpen}>
				<PopoverTrigger asChild>
					<button
						type="button"
						className={cn(pillClass(toolsAndSkillsCustomized), "shrink-0")}
					>
						<Sparkles className="size-3.5" />
						{toolsAndSkillsSummary}
						<ChevronDown className="size-3 opacity-60" />
					</button>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-80">
					<div className="flex items-center justify-between">
						<p className="font-medium">Skills &amp; tools for this chat</p>
						{toolsAndSkillsCustomized && (
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
						By default this chat can use every skill and enabled tool in the
						workspace. Narrow it down here if this conversation should only
						reach a subset.
					</p>
					<ToolsAndSkillsPicker
						workspaceId={workspaceId}
						value={{ skillIds: effective.skillIds, toolIds: effective.toolIds }}
						onChange={(next) => commit(next)}
					/>
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
											{mcpToolsQuery.isLoading && (
												<p className="text-xs text-muted-foreground">
													Loading tools…
												</p>
											)}
											{mcpToolsQuery.isError && (
												<p className="text-xs text-destructive">
													{(mcpToolsQuery.error as Error).message}
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
				{mode === "compact" && showContextWindow && (
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
