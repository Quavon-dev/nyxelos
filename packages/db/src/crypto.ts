import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { assertProductionSecret } from "./secret-guard";

/**
 * Encrypts secret-shaped DB columns at rest (model provider API keys,
 * Obsidian REST key) so a raw DB file/backup/volume mount doesn't hand over
 * live credentials. Mirrors apps/server/src/auth.ts's BETTER_AUTH_SECRET
 * guard (via the shared `assertProductionSecret`): a fixed fallback for
 * local dev (zero setup friction), a hard failure in production if no real
 * key was ever set, is a known-weak placeholder, or is too short. Never
 * reuse BETTER_AUTH_SECRET here — different secret, different rotation
 * lifecycle.
 */

const DEV_FALLBACK_KEY = "dev-encryption-key-change-me";

assertProductionSecret("NYXEL_ENCRYPTION_KEY", process.env.NYXEL_ENCRYPTION_KEY);

const rawKey = process.env.NYXEL_ENCRYPTION_KEY ?? DEV_FALLBACK_KEY;
// AES-256-GCM needs exactly 32 bytes; hashing the raw env string accepts any
// length/format the operator provides while always yielding a valid key.
const key = createHash("sha256").update(rawKey).digest();

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const PREFIX = "v1:";

/**
 * Encrypts a plaintext string for storage. Format: `v1:<iv>:<authTag>:<ciphertext>`,
 * each segment base64. The `v1:` prefix lets `decrypt` tell an encrypted
 * value apart from a pre-existing plaintext row written before this module
 * existed (see `decrypt`'s legacy-plaintext fallback below).
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/**
 * Decrypts a value produced by `encrypt`. Values written before this module
 * existed have no `v1:` prefix — those are returned as-is (they're already
 * plaintext) so existing dev databases keep working without a blocking
 * migration; the next write through `encrypt` upgrades that row in place.
 */
export function decrypt(value: string): string {
  if (!value.startsWith(PREFIX)) return value;
  const [ivB64, authTagB64, ciphertextB64] = value.slice(PREFIX.length).split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Malformed encrypted value: expected iv:authTag:ciphertext");
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

export function encryptNullable(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return encrypt(value);
}

export function decryptNullable(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return decrypt(value);
}
