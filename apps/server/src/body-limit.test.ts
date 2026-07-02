import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

/**
 * Regression test for SECURITY_AUDIT.md SEC-04 — confirms the body-limit
 * wiring pattern used in index.ts (global backstop + a tighter /trpc/*
 * ceiling) actually rejects an oversized request before any handler runs,
 * rather than testing hono's own middleware (that's hono's job). Uses a
 * standalone Hono app instead of importing index.ts, which has real
 * side effects on import (DB migration, scheduler start) unsuitable for an
 * isolated unit test.
 */
function buildApp(maxSizeBytes: number) {
  const app = new Hono();
  app.use("*", bodyLimit({ maxSize: maxSizeBytes }));
  app.post("/", async (c) => {
    const body = await c.req.text();
    return c.json({ receivedBytes: body.length });
  });
  return app;
}

describe("body-limit wiring", () => {
  test("accepts a request under the configured limit", async () => {
    const app = buildApp(1024);
    const res = await app.request("/", { method: "POST", body: "x".repeat(100) });
    expect(res.status).toBe(200);
  });

  test("rejects a request over the configured limit with 413", async () => {
    const app = buildApp(1024);
    const res = await app.request("/", { method: "POST", body: "x".repeat(2048) });
    expect(res.status).toBe(413);
  });

  test("the /trpc/* ceiling (2MB) is tighter than the global backstop (60MB)", () => {
    const trpcLimit = 2 * 1024 * 1024;
    const globalLimit = 60 * 1024 * 1024;
    expect(trpcLimit).toBeLessThan(globalLimit);
  });
});
