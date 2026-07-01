import { describe, expect, it } from "bun:test";
import { extractSseData } from "./chat-stream-parser";

describe("chat stream parser", () => {
	it("extracts complete SSE data events and keeps partial frames buffered", () => {
		const first = extractSseData("data: Hal");
		expect(first).toEqual({ remaining: "data: Hal", text: "" });

		const second = extractSseData(`${first.remaining}lo\n\ndata: Welt\n\n`);
		expect(second).toEqual({ remaining: "", text: "HalloWelt" });
	});

	it("supports multiline SSE events", () => {
		expect(extractSseData("data: Hallo\ndata: Welt\n\n")).toEqual({
			remaining: "",
			text: "Hallo\nWelt",
		});
	});
});
