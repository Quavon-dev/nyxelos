import { describe, expect, it } from "bun:test";
import type { ToolRecord } from "@nyxel/db";
import { createSkillContext } from "@nyxel/skills-sdk";
import { buildBrowserNavigateTool, buildBrowserRunPlaywrightCodeTool } from "./browser";

/**
 * Regression tests for `browser_run_playwright_code`'s isolation boundary —
 * proves the sandboxed code (a) still gets real access to the live `page`
 * it was handed and (b) cannot reach `process.env`, `require`, or the `Bun`
 * global the way the previous raw `new Function(...)` implementation could.
 * Launches a real (pre-installed) headless Chromium — see plugin-sandbox.
 * test.ts for mechanism-level tests of the underlying vm sandbox itself
 * using a plain stand-in object instead of a real page.
 */

function record(overrides: Partial<ToolRecord> = {}): ToolRecord {
  return {
    id: "tool-1",
    workspaceId: "workspace-1",
    name: "Run Playwright code",
    description: "Run arbitrary Playwright code against a live page.",
    kind: "browser_run_playwright_code",
    config: {},
    sensitive: true,
    enabled: true,
    builtin: true,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("buildBrowserRunPlaywrightCodeTool — sandboxed execution", () => {
  it("runs code against the real page and returns its result", async () => {
    const navigate = buildBrowserNavigateTool(record());
    await navigate.run(
      { url: "data:text/html,<title>Sandbox Test</title>", pageId: "sandbox-exec" },
      createSkillContext(navigate.permissions),
    );

    const tool = buildBrowserRunPlaywrightCodeTool(record());
    const result = await tool.run(
      { code: "return await page.title();", pageId: "sandbox-exec" },
      createSkillContext(tool.permissions),
    );

    expect(result).toBe("Sandbox Test");
  }, 20_000);

  it("blocks process.env / require / Bun access from the sandboxed code", async () => {
    const navigate = buildBrowserNavigateTool(record());
    await navigate.run(
      { url: "data:text/html,<title>Isolation Test</title>", pageId: "sandbox-isolation" },
      createSkillContext(navigate.permissions),
    );
    const tool = buildBrowserRunPlaywrightCodeTool(record());
    const ctx = createSkillContext(tool.permissions);

    const previous = process.env.NYXEL_TEST_SECRET;
    process.env.NYXEL_TEST_SECRET = "super-secret-value";
    try {
      const envResult = await tool.run(
        { code: "return typeof process;", pageId: "sandbox-isolation" },
        ctx,
      );
      expect(envResult).toBe("undefined");
    } finally {
      if (previous === undefined) delete process.env.NYXEL_TEST_SECRET;
      else process.env.NYXEL_TEST_SECRET = previous;
    }

    const requireResult = await tool.run(
      {
        code: "try { require('node:fs'); return 'leaked'; } catch (e) { return 'blocked: ' + e.message; }",
        pageId: "sandbox-isolation",
      },
      ctx,
    );
    expect(requireResult).toContain("blocked");
    expect(requireResult).not.toBe("leaked");

    const bunResult = await tool.run(
      { code: "return typeof Bun;", pageId: "sandbox-isolation" },
      ctx,
    );
    expect(bunResult).toBe("undefined");

    // Still has real, intended access to the page it was handed, despite
    // everything above being blocked — the sandbox narrows the ambient
    // scope, it doesn't also take away the one thing this tool exists to
    // give the model.
    const titleResult = await tool.run(
      { code: "return await page.title();", pageId: "sandbox-isolation" },
      ctx,
    );
    expect(titleResult).toBe("Isolation Test");
  }, 20_000);

  it("surfaces a thrown error from the sandboxed code as a structured error, not a crash", async () => {
    const navigate = buildBrowserNavigateTool(record());
    await navigate.run(
      { url: "data:text/html,<title>Error Test</title>", pageId: "sandbox-error" },
      createSkillContext(navigate.permissions),
    );
    const tool = buildBrowserRunPlaywrightCodeTool(record());

    await expect(
      tool.run(
        { code: "throw new Error('deliberate failure');", pageId: "sandbox-error" },
        createSkillContext(tool.permissions),
      ),
    ).rejects.toThrow(/deliberate failure/);
  }, 20_000);
});
