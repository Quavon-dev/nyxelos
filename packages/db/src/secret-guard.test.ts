import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { assertProductionSecret, isWeakSecretValue } from "./secret-guard";

describe("isWeakSecretValue", () => {
  test.each([
    "dev-secret-change-me",
    "change-me-in-production",
    "ChangeMe123",
    "my-example-secret",
    "this-is-a-test-value",
    "password1234567890",
  ])("flags %s as weak", (value) => {
    expect(isWeakSecretValue(value)).toBe(true);
  });

  test("does not flag a real random-looking secret", () => {
    expect(isWeakSecretValue("kQ7z2mN9pXvB4wR8sT1yU6eL3cJ0hF5g")).toBe(false);
  });
});

describe("assertProductionSecret", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  test("is a no-op outside production", () => {
    process.env.NODE_ENV = "development";
    expect(() => assertProductionSecret("TEST_SECRET", undefined)).not.toThrow();
  });

  test("throws when unset in production", () => {
    expect(() => assertProductionSecret("TEST_SECRET", undefined)).toThrow(/is not set/);
  });

  test("throws when set to a known-weak placeholder", () => {
    expect(() => assertProductionSecret("TEST_SECRET", "dev-secret-change-me")).toThrow(
      /known-insecure placeholder/,
    );
  });

  test("throws when too short", () => {
    expect(() => assertProductionSecret("TEST_SECRET", "abc123")).toThrow(/too short/);
  });

  test("accepts a real, long, non-placeholder secret", () => {
    expect(() =>
      assertProductionSecret("TEST_SECRET", "kQ7z2mN9pXvB4wR8sT1yU6eL3cJ0hF5g"),
    ).not.toThrow();
  });

  test("error messages never include the offending secret value", () => {
    try {
      assertProductionSecret("TEST_SECRET", "dev-secret-change-me");
      throw new Error("expected assertProductionSecret to throw");
    } catch (error) {
      expect(String(error)).not.toContain("dev-secret-change-me");
    }
  });
});
