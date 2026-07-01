import { Sparkles, User } from "lucide-react";
import { useState } from "react";
import type { AgentActivityStep } from "@/lib/chat-agent-activity";
import { parseAgentActivity } from "@/lib/chat-agent-activity";
import { parseChatMessageContent, serializeChatMessageContent } from "@/lib/chat-message";
import { parseAssistantContent } from "@/lib/chat-prompts";
import { AgentActivity, TypingIndicator } from "./agent-activity";
import { MarkdownContent } from "./markdown-content";
import { MessageActions } from "./message-actions";
import { MultiSelectPromptCard } from "./multi-select-prompt";

/** Document-style turn — avatar + name header above full-width content, no
 * chat-bubble background. Matches a Gemini/ChatGPT-style transcript rather
 * than a messaging-app thread, which reads better once replies are long,
 * markdown-heavy answers instead of short back-and-forth lines. */
export function MessageBubble({
	sender,
	content,
	streaming = false,
	reasoning,
	steps,
	onEditSubmit,
	onRegenerate,
}: {
	sender: string;
	content: string;
	streaming?: boolean;
	/** Live reasoning text while streaming — for a persisted history message,
	 * this is instead recovered from the trailing ```nyxel-activity block. */
	reasoning?: string;
	/** Live tool-call steps while streaming — same history note as above. */
	steps?: AgentActivityStep[];
	/** Rewrites this user turn's content in place — see message-list.tsx's
	 * onEditMessage, which persists this via chat-stream.ts's editMessageId
	 * and drops every turn that followed. */
	onEditSubmit?: (content: string) => void;
	onRegenerate?: () => void;
}) {
	const isUser = sender === "user";
	const [isEditing, setIsEditing] = useState(false);
	const [draft, setDraft] = useState("");
	// Strip the trailing ```nyxel-activity block first so parseAssistantContent
	// (and its plain-text multiselect fallback heuristic) never scans the raw
	// reasoning/tool-call JSON — it's a single escaped-newline JSON line, but
	// there's no reason to let it anywhere near text-sniffing logic.
	const historyActivity = !isUser && !streaming ? parseAgentActivity(content) : null;
	const contentWithoutActivity = historyActivity?.body ?? content;
	const parsed = !isUser && !streaming ? parseAssistantContent(contentWithoutActivity) : null;
	const userAttachment = isUser ? parseChatMessageContent(content) : null;
	const body = parsed?.body ?? contentWithoutActivity;
	const activityReasoning = streaming ? reasoning : historyActivity?.activity?.reasoning;
	const activitySteps = streaming ? (steps ?? []) : (historyActivity?.activity?.steps ?? []);
	const copyText = isUser ? (userAttachment?.text ?? content) : body;

	function startEditing() {
		setDraft(userAttachment?.text ?? content);
		setIsEditing(true);
	}

	function submitEdit() {
		const text = draft.trim();
		if (!text) return;
		const outgoing = userAttachment
			? serializeChatMessageContent(text, userAttachment.attachments)
			: text;
		onEditSubmit?.(outgoing);
		setIsEditing(false);
	}

	function cancelEdit() {
		setIsEditing(false);
	}

	return (
		<div className="flex gap-3">
			<div
				className={
					isUser
						? "flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
						: "flex size-7 shrink-0 items-center justify-center rounded-full text-primary-foreground"
				}
				style={
					isUser
						? undefined
						: {
								backgroundImage:
									"linear-gradient(135deg, var(--primary), var(--chart-2))",
							}
				}
			>
				{isUser ? <User className="size-3.5" /> : <Sparkles className="size-3.5" />}
			</div>

			<div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
				<p className="text-sm font-semibold leading-none">
					{isUser ? "You" : "Nyxel"}
				</p>

				{!isUser && (activityReasoning || activitySteps.length > 0) && (
					<AgentActivity reasoning={activityReasoning} steps={activitySteps} />
				)}

				<div className="text-[15px] leading-relaxed text-foreground">
					{isUser && isEditing ? (
						<div className="space-y-2">
							<textarea
								value={draft}
								onChange={(e) => setDraft(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault();
										submitEdit();
									}
									if (e.key === "Escape") cancelEdit();
								}}
								rows={3}
								// biome-ignore lint/a11y/noAutofocus: opening the editor is the user's explicit click on "Bearbeiten" — focus belongs here.
								autoFocus
								className="w-full resize-none rounded-lg border border-input bg-background p-2 text-[15px] leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-ring"
							/>
							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={submitEdit}
									className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
								>
									Speichern
								</button>
								<button
									type="button"
									onClick={cancelEdit}
									className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
								>
									Abbrechen
								</button>
							</div>
						</div>
					) : parsed?.prompt ? (
						<div className="space-y-2">
							{body && <MarkdownContent content={body} />}
							<MultiSelectPromptCard prompt={parsed.prompt} mode="preview" />
						</div>
					) : streaming && !isUser ? (
						content.trim() ? (
							<div className="whitespace-pre-wrap break-words">{content}</div>
						) : (
							<TypingIndicator />
						)
					) : userAttachment ? (
						<div className="space-y-2">
							{userAttachment.text.trim() && (
								<div className="whitespace-pre-wrap">{userAttachment.text}</div>
							)}
							<div className="space-y-2">
								{userAttachment.attachments.map((attachment) => (
									<div
										key={`${attachment.name}-${attachment.kind}`}
										className="overflow-hidden rounded-xl border border-border/70 bg-background/70"
									>
										<div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
											<span className="truncate font-medium text-foreground">
												{attachment.name}
											</span>
											<span className="shrink-0 uppercase">
												{attachment.kind}
											</span>
										</div>
										{attachment.kind === "image" ? (
											<img
												src={attachment.content}
												alt={attachment.name}
												className="max-h-80 w-full object-contain"
											/>
										) : attachment.kind === "pdf" ? (
											<iframe
												title={attachment.name}
												src={attachment.content}
												className="h-80 w-full border-0 bg-background"
											/>
										) : (
											<pre className="max-h-80 overflow-auto whitespace-pre-wrap px-3 py-2 text-xs leading-relaxed">
												{attachment.content}
											</pre>
										)}
									</div>
								))}
							</div>
						</div>
					) : isUser ? (
						<div className="whitespace-pre-wrap">{content}</div>
					) : (
						<MarkdownContent content={body} />
					)}
				</div>

				{!streaming && !isEditing && (
					<MessageActions
						text={copyText}
						isUser={isUser}
						onEdit={onEditSubmit ? startEditing : undefined}
						onRegenerate={onRegenerate}
					/>
				)}
			</div>
		</div>
	);
}
