import { describe, expect, it } from "bun:test";
import { encodeSseDataEvent } from "./chat-stream-sse";

describe("chat stream SSE helpers", () => {
	it("encodes a single line as one SSE data event", () => {
		expect(encodeSseDataEvent("Hallo")).toBe("data: Hallo\n\n");
	});

	it("encodes multiline text as a single SSE event with multiple data lines", () => {
		expect(encodeSseDataEvent("Hallo\nWelt")).toBe(
			"data: Hallo\ndata: Welt\n\n",
		);
	});
});
