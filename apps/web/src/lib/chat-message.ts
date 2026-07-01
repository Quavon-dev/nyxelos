export type ChatAttachmentKind = "text" | "image" | "pdf";

export interface ChatAttachment {
	name: string;
	kind: ChatAttachmentKind;
	mimeType: string;
	content: string;
}

export interface ChatMessageEnvelope {
	text: string;
	attachments: ChatAttachment[];
}

export function parseChatMessageContent(
	content: string,
): ChatMessageEnvelope | null {
	try {
		const parsed = JSON.parse(content) as Partial<ChatMessageEnvelope> | null;
		if (
			!parsed ||
			typeof parsed !== "object" ||
			typeof parsed.text !== "string" ||
			!Array.isArray(parsed.attachments)
		) {
			return null;
		}

		const attachments = parsed.attachments.filter(
			(attachment): attachment is ChatAttachment =>
				Boolean(
					attachment &&
						typeof attachment === "object" &&
						typeof attachment.name === "string" &&
						typeof attachment.kind === "string" &&
						typeof attachment.mimeType === "string" &&
						typeof attachment.content === "string" &&
						(attachment.kind === "text" ||
							attachment.kind === "image" ||
							attachment.kind === "pdf"),
				),
		);

		if (attachments.length === 0) return null;
		return { text: parsed.text, attachments };
	} catch {
		return null;
	}
}

export function serializeChatMessageContent(
	text: string,
	attachments: ChatAttachment[],
): string {
	if (attachments.length === 0) return text;
	return JSON.stringify({
		text,
		attachments,
	});
}

export function summarizeChatMessageForModel(content: string): string {
	const parsed = parseChatMessageContent(content);
	if (!parsed) return content;

	const attachmentSummary = parsed.attachments
		.map((attachment) => {
			const label =
				attachment.kind === "image"
					? "Image"
					: attachment.kind === "pdf"
						? "PDF"
						: "File";
			return `${label}: ${attachment.name} (${attachment.mimeType || "unknown mime"})`;
		})
		.join("\n");

	const parts = [parsed.text.trim(), attachmentSummary]
		.filter((part) => part.length > 0)
		.join("\n\n");
	return parts || "Attached file";
}
