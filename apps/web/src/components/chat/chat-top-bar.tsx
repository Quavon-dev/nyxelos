"use client";

import { Check, ChevronDown, Copy, Pin, PinOff, Plus, Search, Share2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModelAvatar } from "@/lib/model-provider-icons";

export interface ChatTopBarModel {
	id: string;
	label: string;
	provider?: string;
	providerLabel?: string;
}

function IconButton({
	onClick,
	label,
	children,
	active,
}: {
	onClick: () => void;
	label: string;
	children: React.ReactNode;
	active?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			className={`flex size-8 shrink-0 items-center justify-center rounded-full transition-colors ${
				active
					? "text-primary hover:bg-primary/10"
					: "text-muted-foreground hover:bg-muted hover:text-foreground"
			}`}
		>
			{children}
		</button>
	);
}

/** Slim per-thread bar pinned above the composer/timeline — model switcher on
 * the left (à la Gemini/ChatGPT's top-left model pill), thread actions on the
 * right. Distinct from AppHeader, which is the app-wide chrome. */
export function ChatTopBar({
	models,
	modelId,
	onModelChange,
	onNewChat,
	onDuplicate,
	onShare,
	onTogglePin,
	pinned,
}: {
	models: ChatTopBarModel[];
	modelId: string | undefined;
	onModelChange: (modelId: string) => void;
	onNewChat?: () => void;
	onDuplicate?: () => void;
	onShare?: () => void;
	onTogglePin?: () => void;
	pinned?: boolean;
}) {
	const activeModel = models.find((m) => m.id === modelId);
	const [search, setSearch] = useState("");
	const searchInputRef = useRef<HTMLInputElement>(null);

	const filteredModels = useMemo(() => {
		const query = search.trim().toLowerCase();
		if (!query) return models;
		return models.filter((m) =>
			`${m.label} ${m.provider ?? ""} ${m.providerLabel ?? ""}`.toLowerCase().includes(query),
		);
	}, [models, search]);

	return (
		<div className="flex h-12 shrink-0 items-center justify-between gap-2">
			<DropdownMenu onOpenChange={(open) => !open && setSearch("")}>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						title={activeModel?.label ?? "Select model"}
						className="flex min-w-0 items-center gap-1.5 rounded-full py-1.5 pl-1.5 pr-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
					>
						<ModelAvatar model={activeModel ?? { id: "", label: "Select model" }} />
						<span className="truncate">{activeModel?.label ?? "Select model"}</span>
						<ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="start"
					className="w-72"
					onOpenAutoFocus={(e) => {
						e.preventDefault();
						searchInputRef.current?.focus();
					}}
				>
					<div className="sticky top-0 -mx-1 -mt-1 mb-1 flex items-center gap-1.5 border-b bg-popover px-2 py-1.5">
						<Search className="size-3.5 shrink-0 text-muted-foreground" />
						<input
							ref={searchInputRef}
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							onKeyDown={(e) => {
								if (e.key !== "Escape") e.stopPropagation();
							}}
							placeholder="Search models…"
							className="w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
						/>
					</div>
					{filteredModels.length === 0 && (
						<div className="px-2 py-1.5 text-xs text-muted-foreground">
							{models.length === 0 ? "No models configured." : "No models match your search."}
						</div>
					)}
					{filteredModels.map((m) => (
						<DropdownMenuItem
							key={m.id}
							title={m.label}
							onSelect={() => onModelChange(m.id)}
						>
							<ModelAvatar model={m} className="size-4" />
							<span className="truncate">{m.label}</span>
							{m.id === modelId && <Check className="ml-auto size-3.5 shrink-0" />}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>

			<div className="flex shrink-0 items-center gap-0.5">
				{onTogglePin && (
					<IconButton
						onClick={onTogglePin}
						active={pinned}
						label={pinned ? "Unpin chat" : "Pin chat"}
					>
						{pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
					</IconButton>
				)}
				{onDuplicate && (
					<IconButton onClick={onDuplicate} label="Duplicate chat">
						<Copy className="size-4" />
					</IconButton>
				)}
				{onShare && (
					<IconButton onClick={onShare} label="Share chat">
						<Share2 className="size-4" />
					</IconButton>
				)}
				{onNewChat && (
					<IconButton onClick={onNewChat} label="New chat">
						<Plus className="size-4" />
					</IconButton>
				)}
			</div>
		</div>
	);
}
