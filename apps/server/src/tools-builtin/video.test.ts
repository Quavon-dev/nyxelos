import { describe, expect, it } from "bun:test";
import type { ToolRecord } from "@nyxel/db";
import { buildGenerateVideoTool } from "./video";

function record(overrides: Partial<ToolRecord> = {}): ToolRecord {
	return {
		id: "tool-1",
		workspaceId: "workspace-1",
		name: "Generate video",
		description: "Generate a short video from a text prompt.",
		kind: "generate_video",
		config: {},
		sensitive: true,
		enabled: true,
		builtin: true,
		createdAt: new Date(),
		...overrides,
	};
}

describe("buildGenerateVideoTool", () => {
	it("carries the tool record's id/name/description/sensitive through unchanged", () => {
		const tool = buildGenerateVideoTool(record());
		expect(tool.id).toBe("tool-1");
		expect(tool.name).toBe("Generate video");
		expect(tool.sensitive).toBe(true);
	});

	it("requires a non-empty prompt", () => {
		const tool = buildGenerateVideoTool(record());
		expect(() => tool.inputSchema.parse({ prompt: "" })).toThrow();
		expect(tool.inputSchema.parse({ prompt: "a cat on a skateboard" })).toEqual({
			prompt: "a cat on a skateboard",
		});
	});

	it("accepts 'auto' and known model ids, rejecting anything else", () => {
		const tool = buildGenerateVideoTool(record());
		expect(() =>
			tool.inputSchema.parse({ prompt: "x", model: "auto" }),
		).not.toThrow();
		expect(() =>
			tool.inputSchema.parse({ prompt: "x", model: "sora-2-pro" }),
		).not.toThrow();
		expect(() =>
			tool.inputSchema.parse({ prompt: "x", model: "gpt-image-1" }),
		).toThrow();
	});

	it("declares no network/filesystem permissions (it calls the OpenAI API directly)", () => {
		const tool = buildGenerateVideoTool(record());
		expect(tool.permissions).toEqual({ network: [], filesystem: [] });
	});
});
