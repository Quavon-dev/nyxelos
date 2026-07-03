import { describe, expect, it } from "bun:test";
import type { ToolRecord } from "@nyxel/db";
import { createSkillContext } from "@nyxel/skills-sdk";
import { buildTerminalOutputTool } from "./read";
import { buildTerminalRunTool, getTerminalSession } from "./terminal";

function record(overrides: Partial<ToolRecord> = {}): ToolRecord {
  return {
    id: "tool-1",
    workspaceId: "workspace-1",
    name: "Terminal output",
    description: "Read buffered terminal output.",
    kind: "terminal_output",
    config: {},
    sensitive: false,
    enabled: true,
    builtin: true,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("buildTerminalOutputTool output cap", () => {
  it("caps output to the same tail-slice budget terminal_run/task_run already apply", async () => {
    const runTool = buildTerminalRunTool(record({ kind: "terminal_run" }));
    const { execId } = await runTool.run(
      // Each line is 100 chars + newline; 200 lines comfortably exceeds the 8000-char cap.
      { command: `for i in $(seq 1 200); do printf '%0100d\\n' "$i"; done` },
      createSkillContext(runTool.permissions),
    );

    await Bun.sleep(500);
    const session = getTerminalSession(execId);
    if (!session) throw new Error("session not found");
    expect(session.output.length).toBeGreaterThan(8000);

    const outputTool = buildTerminalOutputTool(record());
    const result = await outputTool.run({ execId }, createSkillContext(outputTool.permissions));

    expect(result.output.length).toBeLessThanOrEqual(8000);
    expect(result.output).toBe(session.output.slice(-8000));
  });
});
