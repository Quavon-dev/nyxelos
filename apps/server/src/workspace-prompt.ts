import type { WorkspaceRecord } from "@nyxel/db";

/**
 * Single source of truth for how workspace-level custom instructions enter a
 * system prompt. Every prompt-construction path (chat streaming, task/agent
 * runtime, future callers) must call this instead of reading
 * `workspace.customInstructions` directly, so the instructions are always
 * applied and never silently dropped by a path that forgets to merge them in.
 */
export function composeSystemPrompt(
	workspace: WorkspaceRecord | null | undefined,
	...rest: (string | null | undefined)[]
): string | undefined {
	return (
		[workspace?.customInstructions, ...rest].filter(Boolean).join("\n\n") ||
		undefined
	);
}
