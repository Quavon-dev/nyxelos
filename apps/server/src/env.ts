import { assertProductionSecret } from "@nyxel/db";

/**
 * Single, explicit entry point for "is this environment safe to boot in
 * production" — call `validateEnv()` before anything else in index.ts.
 *
 * Individual modules (auth.ts, @nyxel/db's crypto.ts) still carry their own
 * `assertProductionSecret` call too, so importing them directly (e.g. from a
 * script or test) is never silently unsafe — this module exists so there's
 * one place that validates *everything* up front, with every problem
 * reported at once instead of stopping at the first `import` that happens
 * to throw.
 */

interface RequiredSecret {
  name: string;
  value: string | undefined;
  minLength?: number;
}

function requiredProductionSecrets(): RequiredSecret[] {
  return [
    { name: "BETTER_AUTH_SECRET", value: process.env.BETTER_AUTH_SECRET },
    { name: "NYXEL_ENCRYPTION_KEY", value: process.env.NYXEL_ENCRYPTION_KEY },
  ];
}

/**
 * Validates every critical production secret and throws once with every
 * failure listed, rather than failing loudly on the first one and hiding
 * the rest — an operator fixing this should see the whole list in one pass.
 * No-op outside production. Never includes a secret's actual value in the
 * thrown message (each per-secret check already guarantees that).
 */
export function validateEnv(): void {
  if (process.env.NODE_ENV !== "production") return;

  const problems: string[] = [];
  for (const secret of requiredProductionSecrets()) {
    try {
      assertProductionSecret(secret.name, secret.value, { minLength: secret.minLength });
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Refusing to start in production — ${problems.length} environment problem(s) found:\n` +
        problems.map((problem, i) => `  ${i + 1}. ${problem}`).join("\n"),
    );
  }
}
