import { describe, expect, it } from "bun:test";
import {
	buildStreamFailureResponse,
	EMPTY_ASSISTANT_RESPONSE,
	ensureVisibleAssistantResponse,
} from "./chat-stream-response";

describe("chat stream response helpers", () => {
	it("returns the fallback when the model produces no visible text", () => {
		expect(ensureVisibleAssistantResponse("")).toBe(
			EMPTY_ASSISTANT_RESPONSE,
		);
		expect(ensureVisibleAssistantResponse("   \n\t  ")).toBe(
			EMPTY_ASSISTANT_RESPONSE,
		);
	});

	it("keeps visible model text unchanged", () => {
		expect(ensureVisibleAssistantResponse("Hello world")).toBe("Hello world");
	});

	it("prefers already streamed content on mid-stream failure", () => {
		expect(
			buildStreamFailureResponse("Partial answer", "provider disconnected"),
		).toBe("Partial answer");
	});

	it("builds a visible failure response when nothing was streamed", () => {
		expect(buildStreamFailureResponse("", "provider disconnected")).toBe(
			"I couldn't stream the full response. provider disconnected",
		);
	});
});