import type {
	ChatMessageContentPart,
	InstalledModelProvider,
	ModelCapabilities,
} from "@nyxel/model-providers";
import { getModelCapabilities } from "@nyxel/model-providers";
import {
	parseChatMessageContent,
	type ChatAttachment,
	type ChatMessageEnvelope,
} from "./chat-message";

function printableSnippetFromBytes(bytes: Uint8Array, maxLength = 20_000) {
	const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
	return text
		.replace(/[^\x09\x0A\x0D\x20-\x7E]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, maxLength);
}

function decodeDataUrl(dataUrl: string) {
	const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
	if (!match) return null;
	const mimeType = match[1] ?? "application/octet-stream";
	const encoded = match[2];
	if (!encoded) return null;
	const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
	return { mimeType, bytes };
}

function extractPdfFallbackText(attachment: ChatAttachment) {
	const decoded = decodeDataUrl(attachment.content);
	if (!decoded) {
		return `PDF attachment "${attachment.name}" could not be decoded for fallback text extraction.`;
	}
	const snippet = printableSnippetFromBytes(decoded.bytes);
	return [
		`PDF attachment: ${attachment.name}`,
		`Mime type: ${attachment.mimeType}`,
		`Approx bytes: ${decoded.bytes.byteLength}`,
		snippet ? `Extracted text snippet:\n${snippet}` : "No readable text extracted.",
	].join("\n");
}

function extractImageFallbackText(attachment: ChatAttachment) {
	const decoded = decodeDataUrl(attachment.content);
	const approxBytes = decoded?.bytes.byteLength ?? 0;
	return [
		`Image attachment: ${attachment.name}`,
		`Mime type: ${attachment.mimeType}`,
		approxBytes ? `Approx bytes: ${approxBytes}` : null,
		"Fallback mode does not have native vision support for this model, so only file metadata is available here.",
	]
		.filter(Boolean)
		.join("\n");
}

function prepareAttachmentParts(
	attachments: ChatAttachment[],
	capabilities: ModelCapabilities,
): ChatMessageContentPart[] {
	const parts: ChatMessageContentPart[] = [];
	for (const attachment of attachments) {
		if (attachment.kind === "text") {
			parts.push({
				type: "text",
				text: `Attached file "${attachment.name}":\n${attachment.content.slice(0, 20_000)}`,
			});
			continue;
		}
		if (attachment.kind === "image") {
			if (capabilities.nativeImageInput) {
				parts.push({
					type: "image",
					image: attachment.content,
					mediaType: attachment.mimeType,
				});
			} else {
				parts.push({ type: "text", text: extractImageFallbackText(attachment) });
			}
			continue;
		}
		if (attachment.kind === "pdf") {
			if (capabilities.nativeDocumentInput) {
				parts.push({
					type: "file",
					data: attachment.content,
					mediaType: attachment.mimeType,
					filename: attachment.name,
				});
			} else {
				parts.push({ type: "text", text: extractPdfFallbackText(attachment) });
			}
		}
	}
	return parts;
}

export async function prepareMessageContentForModel(input: {
	rawContent: string;
	modelId: string;
	installedProviders: InstalledModelProvider[];
}) {
	const parsed = parseChatMessageContent(input.rawContent);
	if (!parsed) return input.rawContent;

	const capabilities = await getModelCapabilities(input.modelId, input.installedProviders);
	const textPrefix = parsed.text.trim()
		? [{ type: "text" as const, text: parsed.text.trim() }]
		: [];
	return [
		...textPrefix,
		...prepareAttachmentParts(parsed.attachments, capabilities),
	] satisfies ChatMessageContentPart[];
}

export async function summarizeAttachmentCapabilities(input: {
	message: ChatMessageEnvelope | null;
	modelId: string;
	installedProviders: InstalledModelProvider[];
}) {
	if (!input.message) return null;
	const capabilities = await getModelCapabilities(input.modelId, input.installedProviders);
	return {
		nativeImageInput: capabilities.nativeImageInput,
		nativeDocumentInput: capabilities.nativeDocumentInput,
	};
}
