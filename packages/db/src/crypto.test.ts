import { describe, expect, test } from "bun:test";
import { decrypt, decryptNullable, encrypt, encryptNullable } from "./crypto";

describe("crypto", () => {
  test("encrypt then decrypt round-trips the original plaintext", () => {
    const plaintext = "sk-super-secret-value-123";
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  test("encrypted value carries the v1 prefix and is not the raw plaintext", () => {
    const encrypted = encrypt("hello");
    expect(encrypted.startsWith("v1:")).toBe(true);
    expect(encrypted).not.toContain("hello");
  });

  test("two encryptions of the same plaintext produce different ciphertext (random IV)", () => {
    const a = encrypt("same-value");
    const b = encrypt("same-value");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("same-value");
    expect(decrypt(b)).toBe("same-value");
  });

  test("decrypt returns legacy plaintext unchanged (pre-existing unencrypted rows)", () => {
    const legacyPlaintext = "sk-was-never-encrypted";
    expect(decrypt(legacyPlaintext)).toBe(legacyPlaintext);
  });

  test("decrypt rejects a malformed v1-prefixed value", () => {
    expect(() => decrypt("v1:not-enough-parts")).toThrow();
  });

  test("encryptNullable/decryptNullable pass through null and undefined", () => {
    expect(encryptNullable(null)).toBeNull();
    expect(encryptNullable(undefined)).toBeNull();
    expect(decryptNullable(null)).toBeNull();
    expect(decryptNullable(undefined)).toBeNull();
  });

  test("encryptNullable/decryptNullable round-trip a real value", () => {
    const encrypted = encryptNullable("obsidian-key-abc");
    expect(encrypted).not.toBeNull();
    expect(decryptNullable(encrypted)).toBe("obsidian-key-abc");
  });
});
