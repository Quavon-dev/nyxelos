import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { rateLimitMiddleware } from "./rate-limit";

function buildApp(max: number) {
  const app = new Hono();
  app.use(
    "*",
    rateLimitMiddleware({ windowMs: 60_000, max, keyPrefix: `test-${crypto.randomUUID()}` }),
  );
  app.get("/", (c) => c.json({ ok: true }));
  return app;
}

describe("rateLimitMiddleware", () => {
  test("allows requests up to the configured max", async () => {
    const app = buildApp(3);
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/", { headers: { "x-forwarded-for": "1.2.3.4" } });
      expect(res.status).toBe(200);
    }
  });

  test("returns 429 once the max is exceeded within the window", async () => {
    const app = buildApp(2);
    const headers = { "x-forwarded-for": "5.6.7.8" };
    await app.request("/", { headers });
    await app.request("/", { headers });
    const res = await app.request("/", { headers });
    expect(res.status).toBe(429);
  });

  test("tracks distinct callers independently", async () => {
    const app = buildApp(1);
    const resA1 = await app.request("/", { headers: { "x-forwarded-for": "9.9.9.9" } });
    const resB1 = await app.request("/", { headers: { "x-forwarded-for": "8.8.8.8" } });
    expect(resA1.status).toBe(200);
    expect(resB1.status).toBe(200);
    const resA2 = await app.request("/", { headers: { "x-forwarded-for": "9.9.9.9" } });
    expect(resA2.status).toBe(429);
  });
});
