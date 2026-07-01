import { describe, expect, it } from "bun:test";
import type { ChatToolPolicy } from "@nyxel/db";
import { DEFAULT_CHAT_TOOL_POLICY } from "@nyxel/db";
import {
	buildChatScopedBuiltinSkill,
	shouldDeferToolForApproval,
} from "./tools";

function policy(overrides: Partial<ChatToolPolicy>): ChatToolPolicy {
	return {
		...DEFAULT_CHAT_TOOL_POLICY,
		...overrides,
		mode: overrides.mode ?? "automatic",
	};
}

describe("shouldDeferToolForApproval", () => {
	it("keeps default mode fully approval-gated for sensitive tools", () => {
		expect(
			shouldDeferToolForApproval(
				{ kind: "skill", sensitive: true, skillKind: "file_write" },
				DEFAULT_CHAT_TOOL_POLICY,
			),
		).toBe(true);
		expect(
			shouldDeferToolForApproval({ kind: "mcp" }, DEFAULT_CHAT_TOOL_POLICY),
		).toBe(true);
	});

	it("lets automatic mode run writes when that guardrail is disabled", () => {
		expect(
			shouldDeferToolForApproval(
				{ kind: "skill", sensitive: true, skillKind: "file_write" },
				policy({ approveFileWrites: false }),
			),
		).toBe(false);
	});

	it("still gates deletes when delete approval stays enabled", () => {
		expect(
			shouldDeferToolForApproval(
				{ kind: "skill", sensitive: true, skillKind: "file_delete" },
				policy({ approveFileDeletes: true }),
			),
		).toBe(true);
	});

	it("lets AUTO mode run MCP tools when the MCP guardrail is disabled", () => {
		expect(
			shouldDeferToolForApproval(
				{ kind: "mcp" },
				policy({ mode: "auto", approveMcpTools: false }),
			),
		).toBe(false);
	});

	it("binds workspace file tools to the current chat working directory", () => {
		const tool = buildChatScopedBuiltinSkill(
			"workspace_file_list",
			"/tmp/chat-root",
		);
		expect(tool?.permissions.filesystem).toEqual(["/tmp/chat-root"]);
	});

	it("exposes patch editing as a chat-scoped workspace tool", () => {
		const tool = buildChatScopedBuiltinSkill(
			"workspace_file_patch",
			"/tmp/chat-root",
		);
		expect(tool?.id).toBe("workspace_file_patch");
		expect(tool?.permissions.filesystem).toEqual(["/tmp/chat-root"]);
	});
});
