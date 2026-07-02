import { describe, expect, it } from "bun:test";
import { streamClaudeCli } from "./cli";

/** A fake "claude" binary (any executable script works — `runCli` only cares
 * about stdout NDJSON lines and the exit code) that emits one assistant
 * text/tool_use turn, its tool_result, and then repeats that exact same pair
 * of lines once more before exiting — reproducing the CLI-side replay that
 * duplicated tool-call/tool-result events in the SSE stream. */
const FAKE_CLI_SCRIPT = `#!/usr/bin/env bash
cat <<'EOF'
{"type":"assistant","uuid":"a1","message":{"content":[{"type":"text","text":"Reading recent changes."},{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"git log"}}]}}
{"type":"user","uuid":"a2","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"abc123 fixed streaming"}]}}
{"type":"assistant","uuid":"a1","message":{"content":[{"type":"text","text":"Reading recent changes."},{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"git log"}}]}}
{"type":"user","uuid":"a2","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"abc123 fixed streaming"}]}}
{"type":"assistant","uuid":"a3","message":{"content":[{"type":"text","text":"Done."}]}}
EOF
`;

async function writeFakeCli(): Promise<string> {
	const path = `/tmp/fake-claude-cli-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`;
	await Bun.write(path, FAKE_CLI_SCRIPT);
	await Bun.$`chmod +x ${path}`.quiet();
	return path;
}

describe("streamClaudeCli", () => {
	it("drops a byte-identical NDJSON line replayed later in the stream instead of duplicating its parts", async () => {
		const binary = await writeFakeCli();
		try {
			const result = streamClaudeCli({
				binary,
				nativeModelId: "default",
				cwd: "/tmp",
				messages: [{ role: "user", content: "hi" }],
				permissionMode: "restricted",
			});

			const parts = [];
			for await (const part of result.fullStream) parts.push(part);

			const toolCalls = parts.filter((p) => p.type === "tool-call");
			const toolResults = parts.filter((p) => p.type === "tool-result");
			const readingTexts = parts.filter(
				(p) => p.type === "text-delta" && p.text.includes("Reading recent changes"),
			);

			expect(toolCalls).toHaveLength(1);
			expect(toolResults).toHaveLength(1);
			expect(readingTexts).toHaveLength(1);
		} finally {
			await Bun.$`rm -f ${binary}`.quiet();
		}
	});
});
