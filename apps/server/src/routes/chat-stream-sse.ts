export const SSE_HEADERS = {
	"Content-Type": "text/event-stream; charset=utf-8",
	"Cache-Control": "no-cache, no-transform",
	Connection: "keep-alive",
	"X-Accel-Buffering": "no",
} as const;

export function encodeSseDataEvent(text: string): string {
	return text
		.split(/\r?\n/)
		.map((line) => `data: ${line}`)
		.join("\n")
		.concat("\n\n");
}

/**
 * Structured events for POST /api/chat/stream — one JSON object per SSE
 * frame (see encodeSseEvent) instead of raw text chunks, so the client can
 * render the model's reasoning and tool calls live, not just the final text.
 * Mirrored on the client in chat-stream-parser.ts.
 */
export type ChatStreamEvent =
	| { type: "text"; text: string }
	| { type: "reasoning"; text: string }
	| { type: "tool-call"; id: string; name: string; input: unknown }
	| { type: "tool-result"; id: string; name: string; output: unknown }
	| { type: "tool-error"; id: string; name: string; error: string };

/** JSON.stringify never emits a literal newline, so each event is always a
 * single `data:` line — encodeSseDataEvent's line-splitting is a no-op here. */
export function encodeSseEvent(event: ChatStreamEvent): string {
	return encodeSseDataEvent(JSON.stringify(event));
}
