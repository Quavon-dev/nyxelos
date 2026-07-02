"use client";

import { Check, ChevronDown, PencilLine } from "lucide-react";
import type { MultiSelectPrompt } from "@/lib/chat-prompts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function MultiSelectPromptCard({
	prompt,
	mode,
	onPickOption,
	onChooseCustomAnswer,
	note,
}: {
	prompt: MultiSelectPrompt;
	mode: "interactive" | "preview";
	onPickOption?: (optionId: string, label: string) => void;
	onChooseCustomAnswer?: () => void;
	note?: string;
}) {
	const interactive = mode === "interactive";
	const customLabel = prompt.customLabel ?? "Write your own answer";

	if (!interactive) {
		return (
			<div className="rounded-2xl border border-primary/15 bg-primary/5 p-3 shadow-sm">
				<div className="space-y-2">
					<div className="space-y-1">
						<p className="text-sm font-medium leading-snug text-foreground">
							{prompt.question}
						</p>
						<p className="text-xs text-muted-foreground">
							Three suggestions and your own answer.
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						{prompt.options.map((option) => (
							<span
								key={option.id}
								className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-sm text-foreground"
							>
								<Check className="size-3.5 text-muted-foreground" />
								{option.label}
							</span>
						))}
						<span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border/70 bg-background/70 px-3 py-1.5 text-sm text-muted-foreground">
							<PencilLine className="size-3.5" />
							{customLabel}
						</span>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="rounded-2xl border border-primary/15 bg-primary/5 p-3 shadow-sm">
			<div className="space-y-3">
				<div className="space-y-1">
					<p className="text-sm font-medium leading-snug text-foreground">
						{prompt.question}
					</p>
					<p className="text-xs text-muted-foreground">
						Pick a suggestion or write your own answer.
					</p>
				</div>

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="outline"
							className="w-full justify-between"
							size="sm"
						>
							<span>Choose an answer</span>
							<ChevronDown className="size-4 opacity-60" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
						<DropdownMenuLabel>{prompt.question}</DropdownMenuLabel>
						{prompt.options.map((option) => (
							<DropdownMenuItem
								key={option.id}
								onSelect={() => onPickOption?.(option.id, option.label)}
							>
								<span className="flex items-center gap-2">
									<Check className="size-4 text-muted-foreground" />
									<span className="whitespace-normal">{option.label}</span>
								</span>
							</DropdownMenuItem>
						))}
						<DropdownMenuSeparator />
						<DropdownMenuItem onSelect={() => onChooseCustomAnswer?.()}>
							<span className="flex items-center gap-2">
								<PencilLine className="size-4 text-muted-foreground" />
								<span>{customLabel}</span>
							</span>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>

				{note && <p className="text-xs text-muted-foreground">{note}</p>}
			</div>
		</div>
	);
}
