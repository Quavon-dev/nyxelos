import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolRecord } from "@nyxel/db";
import { createSkillContext } from "@nyxel/skills-sdk";
import { buildTextSearchTool } from "./search";

function record(overrides: Partial<ToolRecord> = {}): ToolRecord {
  return {
    id: "tool-1",
    workspaceId: "workspace-1",
    name: "Text search",
    description: "Search file contents.",
    kind: "text_search",
    config: {},
    sensitive: false,
    enabled: true,
    builtin: true,
    createdAt: new Date(),
    ...overrides,
  };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nyxel-search-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("buildTextSearchTool aggregate output cap", () => {
  it("returns every match untruncated when well under the output byte budget", async () => {
    await writeFile(join(dir, "small.txt"), "needle appears once here\n", "utf8");
    const tool = buildTextSearchTool(record({ config: { allowedDirs: [dir] } }));

    const result = await tool.run(
      { query: "needle", roots: [dir], maxResults: 100 },
      createSkillContext(tool.permissions),
    );

    expect(result.matches).toHaveLength(1);
    expect(result.truncated).toBe(false);
  });

  it("stops adding matches and marks the result truncated once the aggregate byte budget is hit", async () => {
    // Each matching line is ~300 chars (capped) plus JSON overhead, so a
    // few hundred matches comfortably blow past the 50,000-byte budget.
    const line = `needle ${"a".repeat(290)}`;
    const content = Array.from({ length: 400 }, () => line).join("\n");
    await writeFile(join(dir, "big.txt"), content, "utf8");
    const tool = buildTextSearchTool(record({ config: { allowedDirs: [dir] } }));

    const result = await tool.run(
      { query: "needle", roots: [dir], maxResults: 500 },
      createSkillContext(tool.permissions),
    );

    expect(result.truncated).toBe(true);
    expect(result.matches.length).toBeLessThan(400);
    const totalBytes = result.matches.reduce(
      (sum: number, match: unknown) => sum + JSON.stringify(match).length,
      0,
    );
    expect(totalBytes).toBeLessThanOrEqual(50_000);
  });
});
