/**
 * Shared production-secret validation used by every secret-shaped env var in
 * the app (BETTER_AUTH_SECRET in apps/server/src/auth.ts,
 * NYXEL_ENCRYPTION_KEY in crypto.ts, and any future one) so the rule is
 * defined once instead of drifting between copies. Framework-free — no
 * process.env reads happen inside this file except in `assertProductionSecret`
 * itself, which only ever compares an already-read value.
 */

const DEFAULT_MIN_LENGTH = 20;

// Substrings that show up in every "just make it work locally" default this
// codebase (or its docs/.env.example) has ever shipped. Case-insensitive
// substring match, not exact — catches "dev-secret-change-me",
// "change-me-in-production", "my-test-secret", etc.
const WEAK_VALUE_SUBSTRINGS = [
  "dev-secret",
  "change-me",
  "changeme",
  "example",
  "test",
  "password",
];

export function isWeakSecretValue(value: string): boolean {
  const lower = value.toLowerCase();
  return WEAK_VALUE_SUBSTRINGS.some((needle) => lower.includes(needle));
}

export interface SecretCheckOptions {
  minLength?: number;
}

/**
 * Throws with a clear, secret-value-free error message if `value` isn't
 * safe to run in production: unset, a known-weak placeholder, or too short.
 * No-op outside production so local dev keeps its zero-setup fallback.
 */
export function assertProductionSecret(
  envVarName: string,
  value: string | undefined,
  options: SecretCheckOptions = {},
): void {
  if (process.env.NODE_ENV !== "production") return;
  const minLength = options.minLength ?? DEFAULT_MIN_LENGTH;

  if (!value) {
    throw new Error(
      `${envVarName} is not set. Refusing to start in production without it — ` +
        "generate one (e.g. `openssl rand -base64 32`) and set it in the environment.",
    );
  }
  if (isWeakSecretValue(value)) {
    throw new Error(
      `${envVarName} is set to a known-insecure placeholder value. Refusing to start in ` +
        "production — generate a real secret (e.g. `openssl rand -base64 32`) and set it in the environment.",
    );
  }
  if (value.length < minLength) {
    throw new Error(
      `${envVarName} is too short (minimum ${minLength} characters) to be a safe production ` +
        "secret. Generate one (e.g. `openssl rand -base64 32`) and set it in the environment.",
    );
  }
}
