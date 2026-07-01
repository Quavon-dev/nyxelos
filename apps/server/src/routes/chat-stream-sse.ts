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
