export interface ChatStreamTextEvent {
	type: "text";
	text: string;
}

export interface ChatStreamReasoningEvent {
	type: "reasoning";
	text: string;
}

export interface ChatStreamToolCallEvent {
	type: "tool-call";
	id: string;
	name: string;
	input: unknown;
}

export interface ChatStreamToolResultEvent {
	type: "tool-result";
	id: string;
	name: string;
	output: unknown;
}

export interface ChatStreamToolErrorEvent {
	type: "tool-error";
	id: string;
	name: string;
	error: string;
}

/** Mirrors the server's ChatStreamEvent union in
 * apps/server/src/routes/chat-stream-sse.ts. */
export type ChatStreamEvent =
	| ChatStreamTextEvent
	| ChatStreamReasoningEvent
	| ChatStreamToolCallEvent
	| ChatStreamToolResultEvent
	| ChatStreamToolErrorEvent;

function isChatStreamEvent(value: unknown): value is ChatStreamEvent {
	if (!value || typeof value !== "object") return false;
	const type = (value as Record<string, unknown>).type;
	return (
		type === "text" ||
		type === "reasoning" ||
		type === "tool-call" ||
		type === "tool-result" ||
		type === "tool-error"
	);
}

/**
 * Splits a buffered SSE byte stream into complete `data:` frames. Each frame
 * holds one JSON-encoded ChatStreamEvent (see encodeSseEvent server-side) —
 * JSON.stringify never emits a literal newline, so a frame is always exactly
 * one `data:` line. Malformed/partial frames are dropped rather than
 * thrown — a truncated frame at the end of a network read is expected, not
 * corrupt.
 */
export function extractSseEvents(buffer: string): {
	remaining: string;
	events: ChatStreamEvent[];
} {
	let remaining = buffer;
	const events: ChatStreamEvent[] = [];

	for (;;) {
		const separatorIndex = remaining.indexOf("\n\n");
		if (separatorIndex === -1) break;

		const frame = remaining.slice(0, separatorIndex);
		remaining = remaining.slice(separatorIndex + 2);

		const data = frame
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice("data:".length).replace(/^ /, ""))
			.join("\n");

		if (!data) continue;

		try {
			const parsed = JSON.parse(data);
			if (isChatStreamEvent(parsed)) events.push(parsed);
		} catch {
			// Ignore a malformed frame rather than aborting the whole stream.
		}
	}

	return { remaining, events };
}
