import { describe, expect, it } from "bun:test";
import { extractSseEvents } from "./chat-stream-parser";

function frame(event: unknown): string {
	return `data: ${JSON.stringify(event)}\n\n`;
}

describe("chat stream parser", () => {
	it("extracts a complete event frame and keeps a partial frame buffered", () => {
		const full = frame({ type: "text", text: "Hallo" });
		const partial = full.slice(0, -4); // drop the trailing `o"}\n\n`
		const first = extractSseEvents(partial);
		expect(first).toEqual({ remaining: partial, events: [] });

		const second = extractSseEvents(first.remaining + full.slice(-4));
		expect(second.remaining).toBe("");
		expect(second.events).toEqual([{ type: "text", text: "Hallo" }]);
	});

	it("extracts multiple queued event frames in order", () => {
		const buffer =
			frame({ type: "reasoning", text: "Thinking…" }) +
			frame({ type: "tool-call", id: "call_1", name: "workspace_file_read", input: { path: "a.ts" } }) +
			frame({ type: "tool-result", id: "call_1", name: "workspace_file_read", output: { content: "x" } }) +
			frame({ type: "text", text: "Hallo Welt" });

		expect(extractSseEvents(buffer)).toEqual({
			remaining: "",
			events: [
				{ type: "reasoning", text: "Thinking…" },
				{ type: "tool-call", id: "call_1", name: "workspace_file_read", input: { path: "a.ts" } },
				{ type: "tool-result", id: "call_1", name: "workspace_file_read", output: { content: "x" } },
				{ type: "text", text: "Hallo Welt" },
			],
		});
	});

	it("drops malformed or unknown frames instead of throwing", () => {
		const buffer = `data: not json\n\n${frame({ type: "nonsense" })}${frame({ type: "text", text: "ok" })}`;
		expect(extractSseEvents(buffer)).toEqual({
			remaining: "",
			events: [{ type: "text", text: "ok" }],
		});
	});
});
