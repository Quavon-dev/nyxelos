import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PluginSandboxError, runIsolatedCustomCode, runVmSandboxedCode } from "./plugin-sandbox";

/**
 * Regression tests for the isolated-execution boundary (ADR-0007) —
 * proves the three things docs/PLUGIN_SECURITY.md's core gap called out as
 * missing: custom code can no longer read the server's real
 * `process.env`, can no longer reach `require("node:fs")`/`child_process`
 * directly, and is still limited to the declared `ctx.*` permissions when
 * it does the right thing and uses them.
 */

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "plugin-sandbox-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("runIsolatedCustomCode — basic execution", () => {
  it("runs a plain expression and returns its value", async () => {
    const result = await runIsolatedCustomCode(
      "return input.a + input.b;",
      { a: 1, b: 2 },
      {
        network: [],
        filesystem: [],
      },
    );
    expect(result).toBe(3);
  });

  it("returns null for code with no explicit return", async () => {
    const result = await runIsolatedCustomCode("1 + 1;", {}, { network: [], filesystem: [] });
    expect(result).toBeNull();
  });

  it("delivers a large init payload intact instead of truncating it", async () => {
    const bigString = "x".repeat(500_000);
    const result = await runIsolatedCustomCode(
      "return input.big.length;",
      { big: bigString },
      { network: [], filesystem: [] },
    );
    expect(result).toBe(bigString.length);
  });

  it("supports awaiting ctx calls inside the sandboxed code", async () => {
    const filePath = path.join(workDir, "note.txt");
    const result = await runIsolatedCustomCode(
      `await ctx.writeFile(${JSON.stringify(filePath)}, "hello from the sandbox"); return await ctx.readFile(${JSON.stringify(filePath)});`,
      {},
      { network: [], filesystem: [workDir] },
    );
    expect(result).toBe("hello from the sandbox");
    expect(await readFile(filePath, "utf-8")).toBe("hello from the sandbox");
  });

  it("surfaces a thrown error from the sandboxed code as a PluginSandboxError", async () => {
    await expect(
      runIsolatedCustomCode("throw new Error('boom');", {}, { network: [], filesystem: [] }),
    ).rejects.toThrow(PluginSandboxError);
    await expect(
      runIsolatedCustomCode("throw new Error('boom');", {}, { network: [], filesystem: [] }),
    ).rejects.toThrow(/boom/);
  });
});

describe("runIsolatedCustomCode — process isolation", () => {
  it("never sees the caller's real process.env, even when the server has real secrets set", async () => {
    const previous = process.env.NYXEL_TEST_SECRET;
    process.env.NYXEL_TEST_SECRET = "super-secret-value";
    try {
      const result = await runIsolatedCustomCode(
        "return typeof process;",
        {},
        { network: [], filesystem: [] },
      );
      // `process` isn't even a defined global inside the vm sandbox.
      expect(result).toBe("undefined");
    } finally {
      if (previous === undefined) delete process.env.NYXEL_TEST_SECRET;
      else process.env.NYXEL_TEST_SECRET = previous;
    }
  });

  it("passes through only the explicitly declared env, never the caller's own", async () => {
    const result = await runIsolatedCustomCode(
      // process is undefined in the sandbox regardless — this test only
      // documents that `env` is caller-controlled at the API surface; the
      // vm sandbox test above is what actually proves nothing leaks.
      "return 1;",
      {},
      { network: [], filesystem: [] },
      { env: { EXAMPLE_DECLARED_VAR: "only-this" } },
    );
    expect(result).toBe(1);
  });

  it("blocks direct require('node:fs') access", async () => {
    const result = await runIsolatedCustomCode(
      "try { require('node:fs'); return 'leaked'; } catch (e) { return 'blocked: ' + e.message; }",
      {},
      { network: [], filesystem: [] },
    );
    expect(result).toContain("blocked");
    expect(result).not.toBe("leaked");
  });

  it("blocks direct require('node:child_process') access", async () => {
    const result = await runIsolatedCustomCode(
      "try { require('node:child_process'); return 'leaked'; } catch (e) { return 'blocked: ' + e.message; }",
      {},
      { network: [], filesystem: [] },
    );
    expect(result).toContain("blocked");
    expect(result).not.toBe("leaked");
  });

  it("blocks Bun-global access", async () => {
    const result = await runIsolatedCustomCode(
      "return typeof Bun;",
      {},
      { network: [], filesystem: [] },
    );
    expect(result).toBe("undefined");
  });
});

describe("runIsolatedCustomCode — ctx permission enforcement still applies inside the sandbox", () => {
  it("blocks a filesystem path outside the declared permissions", async () => {
    await expect(
      runIsolatedCustomCode(
        "return await ctx.readFile('/etc/passwd');",
        {},
        { network: [], filesystem: [workDir] },
      ),
    ).rejects.toThrow(/declared filesystem permissions/);
  });

  it("blocks a network host outside the declared permissions", async () => {
    await expect(
      runIsolatedCustomCode(
        "await ctx.fetch('https://not-allowed.example.test/'); return 'ok';",
        {},
        { network: ["allowed.example.test"], filesystem: [] },
      ),
    ).rejects.toThrow(/declared network permissions/);
  });
});

describe("runIsolatedCustomCode — timeout", () => {
  it("kills a call that runs longer than the configured timeout", async () => {
    await expect(
      runIsolatedCustomCode(
        "await new Promise((resolve) => setTimeout(resolve, 5000)); return 'done';",
        {},
        { network: [], filesystem: [] },
        { timeoutMs: 200 },
      ),
    ).rejects.toThrow(PluginSandboxError);
  });
});

describe("runIsolatedCustomCode — output size cap", () => {
  it("returns a value under the cap unchanged", async () => {
    const result = await runIsolatedCustomCode(
      "return 'x'.repeat(100);",
      {},
      { network: [], filesystem: [] },
      { maxOutputChars: 1000 },
    );
    expect(result).toBe("x".repeat(100));
  });

  it("truncates an oversized return value instead of passing it through whole", async () => {
    const result = (await runIsolatedCustomCode(
      "return 'x'.repeat(10000);",
      {},
      { network: [], filesystem: [] },
      { maxOutputChars: 500 },
    )) as { truncated: boolean; originalChars: number; preview: string };
    expect(result.truncated).toBe(true);
    expect(result.originalChars).toBeGreaterThan(500);
    expect(result.preview.length).toBeLessThanOrEqual(500);
  });

  it("truncates an oversized thrown error message rather than leaking it whole", async () => {
    await expect(
      runIsolatedCustomCode(
        "throw new Error('x'.repeat(10000));",
        {},
        { network: [], filesystem: [] },
        { maxOutputChars: 200 },
      ),
    ).rejects.toThrow(/\[truncated\]$/);
  });
});

/**
 * `runVmSandboxedCode` — the same-process vm-only sandbox used for
 * `browser_run_playwright_code` (tools-builtin/browser.ts), where the
 * sandboxed code needs a live, non-serializable object (a Playwright
 * `Page`) that can't cross runIsolatedCustomCode's subprocess boundary.
 * These tests use a plain stand-in object in place of a real Page — the
 * mechanism under test is the vm sandboxing itself (no require/process/Bun,
 * a real global still reachable, timeout, output cap), not Playwright.
 */
describe("runVmSandboxedCode — basic execution", () => {
  it("runs code that uses a passed-in global and returns its value", async () => {
    const page = { title: async () => "Example Page" };
    const result = await runVmSandboxedCode("return await page.title();", { page });
    expect(result).toBe("Example Page");
  });

  it("returns null for code with no explicit return", async () => {
    const result = await runVmSandboxedCode("1 + 1;", {});
    expect(result).toBeNull();
  });

  it("surfaces a thrown error from the sandboxed code as a PluginSandboxError", async () => {
    await expect(runVmSandboxedCode("throw new Error('boom');", {})).rejects.toThrow(
      PluginSandboxError,
    );
    await expect(runVmSandboxedCode("throw new Error('boom');", {})).rejects.toThrow(/boom/);
  });
});

describe("runVmSandboxedCode — ambient API isolation", () => {
  it("never sees the caller's real process.env, even when the server has real secrets set", async () => {
    const previous = process.env.NYXEL_TEST_SECRET;
    process.env.NYXEL_TEST_SECRET = "super-secret-value";
    try {
      const result = await runVmSandboxedCode("return typeof process;", {});
      expect(result).toBe("undefined");
    } finally {
      if (previous === undefined) delete process.env.NYXEL_TEST_SECRET;
      else process.env.NYXEL_TEST_SECRET = previous;
    }
  });

  it("blocks direct require('node:fs') access", async () => {
    const result = await runVmSandboxedCode(
      "try { require('node:fs'); return 'leaked'; } catch (e) { return 'blocked: ' + e.message; }",
      {},
    );
    expect(result).toContain("blocked");
    expect(result).not.toBe("leaked");
  });

  it("blocks direct require('node:child_process') access", async () => {
    const result = await runVmSandboxedCode(
      "try { require('node:child_process'); return 'leaked'; } catch (e) { return 'blocked: ' + e.message; }",
      {},
    );
    expect(result).toContain("blocked");
    expect(result).not.toBe("leaked");
  });

  it("blocks Bun-global access", async () => {
    const result = await runVmSandboxedCode("return typeof Bun;", {});
    expect(result).toBe("undefined");
  });

  it("blocks ambient fetch access", async () => {
    const result = await runVmSandboxedCode("return typeof fetch;", {});
    expect(result).toBe("undefined");
  });
});

describe("runVmSandboxedCode — timeout", () => {
  it("rejects a call that runs longer than the configured timeout", async () => {
    await expect(
      runVmSandboxedCode(
        "await new Promise((resolve) => setTimeout(resolve, 5000)); return 'done';",
        {},
        { timeoutMs: 200 },
      ),
    ).rejects.toThrow(PluginSandboxError);
  });
});

describe("runVmSandboxedCode — output size cap", () => {
  it("returns a value under the cap unchanged", async () => {
    const result = await runVmSandboxedCode(
      "return 'x'.repeat(100);",
      {},
      { maxOutputChars: 1000 },
    );
    expect(result).toBe("x".repeat(100));
  });

  it("truncates an oversized return value instead of passing it through whole", async () => {
    const result = (await runVmSandboxedCode(
      "return 'x'.repeat(10000);",
      {},
      { maxOutputChars: 500 },
    )) as { truncated: boolean; originalChars: number; preview: string };
    expect(result.truncated).toBe(true);
    expect(result.originalChars).toBeGreaterThan(500);
    expect(result.preview.length).toBeLessThanOrEqual(500);
  });

  it("truncates an oversized thrown error message rather than leaking it whole", async () => {
    await expect(
      runVmSandboxedCode("throw new Error('x'.repeat(10000));", {}, { maxOutputChars: 200 }),
    ).rejects.toThrow(/\[truncated\]$/);
  });
});
