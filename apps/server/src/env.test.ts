import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { validateEnv } from "./env";

describe("validateEnv", () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    NYXEL_ENCRYPTION_KEY: process.env.NYXEL_ENCRYPTION_KEY,
  };

  beforeEach(() => {
    process.env.NODE_ENV = "production";
    process.env.BETTER_AUTH_SECRET = undefined;
    process.env.NYXEL_ENCRYPTION_KEY = undefined;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv.NODE_ENV;
    process.env.BETTER_AUTH_SECRET = originalEnv.BETTER_AUTH_SECRET;
    process.env.NYXEL_ENCRYPTION_KEY = originalEnv.NYXEL_ENCRYPTION_KEY;
  });

  test("is a no-op in development even with no secrets set", () => {
    process.env.NODE_ENV = "development";
    expect(() => validateEnv()).not.toThrow();
  });

  test("throws in production when every required secret is missing", () => {
    expect(() => validateEnv()).toThrow(/environment problem/);
  });

  test("reports both problems at once when both secrets are missing", () => {
    try {
      validateEnv();
      throw new Error("expected validateEnv to throw");
    } catch (error) {
      const message = String(error);
      expect(message).toContain("BETTER_AUTH_SECRET");
      expect(message).toContain("NYXEL_ENCRYPTION_KEY");
    }
  });

  test("throws when a secret is set to a known-weak placeholder", () => {
    process.env.BETTER_AUTH_SECRET = "dev-secret-change-me";
    process.env.NYXEL_ENCRYPTION_KEY = "kQ7z2mN9pXvB4wR8sT1yU6eL3cJ0hF5g";
    expect(() => validateEnv()).toThrow(/BETTER_AUTH_SECRET/);
  });

  test("passes when every required secret is real, long, and not a placeholder", () => {
    process.env.BETTER_AUTH_SECRET = "kQ7z2mN9pXvB4wR8sT1yU6eL3cJ0hF5g";
    process.env.NYXEL_ENCRYPTION_KEY = "aB3dE6gH9jK2mN5pQ8sT1vX4yZ7cF0iL";
    expect(() => validateEnv()).not.toThrow();
  });

  test("error message never includes the offending secret value", () => {
    process.env.BETTER_AUTH_SECRET = "dev-secret-change-me";
    process.env.NYXEL_ENCRYPTION_KEY = "aB3dE6gH9jK2mN5pQ8sT1vX4yZ7cF0iL";
    try {
      validateEnv();
      throw new Error("expected validateEnv to throw");
    } catch (error) {
      expect(String(error)).not.toContain("dev-secret-change-me");
    }
  });
});
