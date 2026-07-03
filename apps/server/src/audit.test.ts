import { describe, expect, test } from "bun:test";
import { sanitizeForAudit } from "./audit";

describe("sanitizeForAudit", () => {
  test("passes through undefined/null unchanged", () => {
    expect(sanitizeForAudit(undefined)).toBeUndefined();
    expect(sanitizeForAudit(null)).toBeNull();
  });

  test("redacts top-level secret-shaped keys, case-insensitively", () => {
    const sanitized = sanitizeForAudit({
      apiKey: "sk-live-abc",
      ApiKey: "sk-live-def",
      API_KEY: "sk-live-ghi",
      token: "tok-live",
      accessToken: "at-live",
      refreshToken: "rt-live",
      Authorization: "Bearer xyz",
      password: "hunter2",
      secret: "shh",
      cookie: "session=abc",
      label: "keep me",
    }) as Record<string, unknown>;

    expect(sanitized.apiKey).toBe("[REDACTED]");
    expect(sanitized.ApiKey).toBe("[REDACTED]");
    expect(sanitized.API_KEY).toBe("[REDACTED]");
    expect(sanitized.token).toBe("[REDACTED]");
    expect(sanitized.accessToken).toBe("[REDACTED]");
    expect(sanitized.refreshToken).toBe("[REDACTED]");
    expect(sanitized.Authorization).toBe("[REDACTED]");
    expect(sanitized.password).toBe("[REDACTED]");
    expect(sanitized.secret).toBe("[REDACTED]");
    expect(sanitized.cookie).toBe("[REDACTED]");
    expect(sanitized.label).toBe("keep me");
  });

  test("redacts secret-shaped keys nested arbitrarily deep", () => {
    const sanitized = sanitizeForAudit({
      request: {
        headers: { authorization: "Bearer live-token" },
        body: {
          nested: [{ config: { apiKey: "sk-live-nested" } }, { safe: "ok" }],
        },
      },
    }) as {
      request: {
        headers: { authorization: string };
        body: { nested: [{ config: { apiKey: string } }, { safe: string }] };
      };
    };

    expect(sanitized.request.headers.authorization).toBe("[REDACTED]");
    expect(sanitized.request.body.nested[0].config.apiKey).toBe("[REDACTED]");
    expect(sanitized.request.body.nested[1].safe).toBe("ok");
  });

  test("does not redact non-secret keys or mutate primitives/arrays", () => {
    const sanitized = sanitizeForAudit({
      count: 3,
      items: ["a", "b", "c"],
      nested: { ok: true },
    });
    expect(sanitized).toEqual({ count: 3, items: ["a", "b", "c"], nested: { ok: true } });
  });

  test("caps serialized size and marks the result truncated", () => {
    const huge = { blob: "x".repeat(50_000) };
    const sanitized = sanitizeForAudit(huge) as {
      truncated: boolean;
      originalChars: number;
      preview: string;
    };
    expect(sanitized.truncated).toBe(true);
    expect(sanitized.originalChars).toBeGreaterThan(20_000);
    expect(sanitized.preview.length).toBe(20_000);
  });

  test("leaves small values under the size cap untouched", () => {
    const small = { blob: "x".repeat(100) };
    const sanitized = sanitizeForAudit(small);
    expect(sanitized).toEqual(small);
  });

  test("redacts secrets even inside a value that also gets truncated", () => {
    const huge = { apiKey: "sk-live-secret", blob: "x".repeat(50_000) };
    const sanitized = sanitizeForAudit(huge) as { preview: string };
    expect(sanitized.preview).not.toContain("sk-live-secret");
  });
});
