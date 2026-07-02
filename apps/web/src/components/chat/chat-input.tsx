"use client";

import { ArrowUp, Loader2 } from "lucide-react";
import { type DragEvent, useEffect, useRef, useState } from "react";
import {
	AttachmentPreviewCard,
	type AttachedFile,
	ChatComposerToolbar,
	type ChatToolSelection,
} from "@/components/chat/chat-composer-toolbar";
import { filesFromClipboard, useAttachmentStaging } from "@/components/chat/attachment-utils";
import { Textarea } from "@/components/ui/textarea";
import { serializeChatMessageContent } from "@/lib/chat-message";
import type { MultiSelectPrompt } from "@/lib/chat-prompts";
import type { ChatToolMode } from "@/lib/trpc";
import { cn } from "@/lib/utils";
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
	toolMode,
	onToolModeChange,
	attachedFiles,
	onAttachedFilesChange,
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
	toolMode: ChatToolMode;
	onToolModeChange: (next: ChatToolMode) => void;
	attachedFiles: AttachedFile[];
	onAttachedFilesChange: (files: AttachedFile[]) => void;
	messages: MessageLike[];
	assistantQuestion: string | null;
	assistantPrompt: MultiSelectPrompt | null;
}) {
	const [value, setValue] = useState("");
	const [isDragging, setIsDragging] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const { addFiles } = useAttachmentStaging(attachedFiles, onAttachedFilesChange, workspaceId);
	const promptKey = assistantPrompt
		? `${assistantPrompt.question}:${assistantPrompt.options.map((option) => option.id).join(",")}`
		: "none";

	useEffect(() => {
		if (promptKey !== "none") setValue("");
	}, [promptKey]);

	// Attachments are stored inline as a structured envelope so the chat can
	// render them later without needing a separate upload backend yet.
	function submitMessage(rawText: string) {
		if (disabled) return;
		const answerText = rawText.trim();
		if (!answerText && attachedFiles.length === 0) return;

		const outgoing =
			attachedFiles.length > 0
				? serializeChatMessageContent(answerText, attachedFiles)
				: answerText;

		onSend(outgoing);
		setValue("");
		onAttachedFilesChange([]);
	}

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		submitMessage(value);
	}

	function handleDrop(e: DragEvent<HTMLFormElement>) {
		e.preventDefault();
		setIsDragging(false);
		if (e.dataTransfer.files.length > 0) void addFiles(e.dataTransfer.files);
	}

	const placeholder = assistantPrompt
		? "Eigene Antwort schreiben…"
		: assistantQuestion
			? "Answer the question…"
			: "Message Nyxel…";

	return (
		<form
			onSubmit={handleSubmit}
			className="pt-4"
			onDragOver={(e) => {
				e.preventDefault();
				setIsDragging(true);
			}}
			onDragLeave={() => setIsDragging(false)}
			onDrop={handleDrop}
		>
			<div
				className={cn(
					"space-y-1 rounded-2xl border bg-card p-2 shadow-sm transition-colors",
					isDragging && "border-primary bg-primary/5",
				)}
			>
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
				{attachedFiles.length > 0 && (
					<div className="flex flex-wrap gap-2 px-1 pt-1">
						{attachedFiles.map((file) => (
							<AttachmentPreviewCard
								key={file.id}
								file={file}
								onRemove={() =>
									onAttachedFilesChange(attachedFiles.filter((f) => f.id !== file.id))
								}
								onBroken={() =>
									onAttachedFilesChange(
										attachedFiles.map((f) => (f.id === file.id ? { ...f, broken: true } : f)),
									)
								}
							/>
						))}
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
					onPaste={(e) => {
						const files = filesFromClipboard(e.clipboardData);
						if (files.length === 0) return;
						e.preventDefault();
						void addFiles(files);
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
							toolMode={toolMode}
							onToolModeChange={onToolModeChange}
							attachedFiles={attachedFiles}
							onAttachedFilesChange={onAttachedFilesChange}
							onVoiceResult={(text) =>
								submitMessage(value ? `${value} ${text}` : text)
							}
							messages={messages}
						/>
					</div>
					<button
						type="submit"
						disabled={
							disabled ||
							(!value.trim() && attachedFiles.length === 0)
						}
						aria-label={disabled ? "Nyxel arbeitet…" : "Senden"}
						className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-40"
					>
						{disabled ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<ArrowUp className="size-4" />
						)}
					</button>
				</div>
			</div>
		</form>
	);
}
