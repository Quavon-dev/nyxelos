"use client";

import { Check, ChevronDown, Copy, Pin, PinOff, Plus, Share2 } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface ChatTopBarModel {
	id: string;
	label: string;
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

	return (
		<div className="flex h-12 shrink-0 items-center justify-between gap-2">
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						className="flex min-w-0 items-center gap-1.5 rounded-full py-1.5 pl-1.5 pr-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
					>
						<span
							className="flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-primary-foreground"
							style={{
								backgroundImage:
									"linear-gradient(135deg, var(--primary), var(--chart-2))",
							}}
						>
							N
						</span>
						<span className="truncate">{activeModel?.label ?? "Select model"}</span>
						<ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-56">
					{models.length === 0 && (
						<div className="px-2 py-1.5 text-xs text-muted-foreground">
							No models configured.
						</div>
					)}
					{models.map((m) => (
						<DropdownMenuItem key={m.id} onSelect={() => onModelChange(m.id)}>
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
