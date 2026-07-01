"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	type AttachedFile,
	ChatComposerToolbar,
	type ChatToolSelection,
} from "@/components/chat/chat-composer-toolbar";
import { Textarea } from "@/components/ui/textarea";
import { serializeChatMessageContent } from "@/lib/chat-message";
import type { MultiSelectPrompt } from "@/lib/chat-prompts";
import type { ChatToolPolicy } from "@/lib/trpc";
import { MultiSelectPromptCard } from "./multi-select-prompt";

interface MessageLike {
	role: string;
	content: string;
}

export function ChatInput({
	onSend,
	disabled,
	workspaceId,
	modelId,
	toolSelection,
	onToolSelectionChange,
	chatToolPolicy,
	onChatToolPolicyChange,
	attachedFile,
	onAttachedFileChange,
	messages,
	assistantQuestion,
	assistantPrompt,
}: {
	onSend: (message: string) => void;
	disabled?: boolean;
	workspaceId: string | undefined;
	modelId?: string;
	toolSelection: ChatToolSelection | null;
	onToolSelectionChange: (next: ChatToolSelection | null) => void;
	chatToolPolicy: ChatToolPolicy;
	onChatToolPolicyChange: (next: ChatToolPolicy) => void;
	attachedFile: AttachedFile | null;
	onAttachedFileChange: (file: AttachedFile | null) => void;
	messages: MessageLike[];
	assistantQuestion: string | null;
	assistantPrompt: MultiSelectPrompt | null;
}) {
	const [value, setValue] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const promptKey = assistantPrompt
		? `${assistantPrompt.question}:${assistantPrompt.options.map((option) => option.id).join(",")}`
		: "none";

	useEffect(() => {
		if (promptKey !== "none") setValue("");
	}, [promptKey]);

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (disabled) return;

		if (!value.trim() && !attachedFile) return;

		// Attachments are stored inline as a structured envelope so the chat can
		// render them later without needing a separate upload backend yet.
		const answerText = value.trim();

		const outgoing = attachedFile
			? serializeChatMessageContent(answerText, [attachedFile])
			: answerText;

		onSend(outgoing);
		setValue("");
		onAttachedFileChange(null);
	}

	const placeholder = assistantPrompt
		? "Eigene Antwort schreiben…"
		: assistantQuestion
			? "Answer the question…"
			: "Message Nyxel…";

	return (
		<form onSubmit={handleSubmit} className="pt-4">
			<div className="space-y-1 rounded-2xl border bg-card p-2 shadow-sm">
				{assistantPrompt && (
					<MultiSelectPromptCard
						prompt={assistantPrompt}
						mode="interactive"
						onPickOption={(_, label) => {
							setValue(label);
							requestAnimationFrame(() => textareaRef.current?.focus());
						}}
						onChooseCustomAnswer={() =>
							requestAnimationFrame(() => textareaRef.current?.focus())
						}
						note="Waehl einen Vorschlag oder tippe unten eine eigene Antwort."
					/>
				)}
				{!assistantPrompt && assistantQuestion && (
					<div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
						Nyxel asked:{" "}
						<span className="text-foreground">{assistantQuestion}</span>
					</div>
				)}
				<Textarea
					ref={textareaRef}
					value={value}
					onChange={(e) => setValue(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							handleSubmit(e);
						}
					}}
					placeholder={placeholder}
					disabled={disabled}
					rows={assistantPrompt ? 3 : 1}
					className="max-h-40 min-h-9 resize-none border-0 p-1.5 shadow-none focus-visible:ring-0"
				/>
				<div className="flex items-center gap-2 px-0.5">
					<div className="min-w-0 flex-1">
						<ChatComposerToolbar
							mode="compact"
							workspaceId={workspaceId}
							modelId={modelId}
							toolSelection={toolSelection}
							onToolSelectionChange={onToolSelectionChange}
							chatToolPolicy={chatToolPolicy}
							onChatToolPolicyChange={onChatToolPolicyChange}
							attachedFile={attachedFile}
							onAttachedFileChange={onAttachedFileChange}
							onVoiceResult={(text) =>
								setValue((prev) => (prev ? `${prev} ${text}` : text))
							}
							messages={messages}
						/>
					</div>
					<button
						type="submit"
						disabled={
							disabled ||
							(!value.trim() && !attachedFile)
						}
						className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-40"
					>
						<ArrowUp className="size-4" />
					</button>
				</div>
			</div>
		</form>
	);
}
