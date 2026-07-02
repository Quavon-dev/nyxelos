import { describe, expect, it } from "bun:test";
import type { ToolRecord } from "@nyxel/db";
import { buildEditVideoTool } from "./video-edit";

function record(overrides: Partial<ToolRecord> = {}): ToolRecord {
	return {
		id: "tool-2",
		workspaceId: "workspace-1",
		name: "Edit video",
		description: "Edit a video already in the library.",
		kind: "edit_video",
		config: {},
		sensitive: true,
		enabled: true,
		builtin: true,
		createdAt: new Date(),
		...overrides,
	};
}

describe("buildEditVideoTool", () => {
	it("requires a known operation", () => {
		const tool = buildEditVideoTool(record());
		expect(() => tool.inputSchema.parse({ operation: "rotate", libraryFileId: "f1" })).toThrow();
		expect(() =>
			tool.inputSchema.parse({ operation: "trim", libraryFileId: "f1" }),
		).not.toThrow();
	});

	it("allows libraryFileId and libraryFileIds to both be omitted at the schema level (operation-specific requirements are enforced by editVideo/validateEditInput)", () => {
		const tool = buildEditVideoTool(record());
		expect(() => tool.inputSchema.parse({ operation: "concat" })).not.toThrow();
	});

	it("parses every numeric knob as optional numbers", () => {
		const tool = buildEditVideoTool(record());
		const parsed = tool.inputSchema.parse({
			operation: "speed",
			libraryFileId: "f1",
			speed: 2,
			startSeconds: 1,
			endSeconds: 5,
			volume: 0.5,
			timestampSeconds: 3,
			fps: 12,
		});
		expect(parsed).toMatchObject({ speed: 2, startSeconds: 1, endSeconds: 5, volume: 0.5 });
	});
});
