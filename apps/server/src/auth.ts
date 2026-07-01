import { createAuthDb } from "@nyxel/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

const authDb = createAuthDb();

/**
 * Self-hosted auth (ADR: see ARCHITECTURE.md section 3). Works unchanged in
 * both PC mode (SQLite, single local account) and server mode (Postgres,
 * full email/passkey/OIDC login) — only DB_DRIVER changes.
 */
export const auth = betterAuth({
  database: drizzleAdapter(authDb.db, {
    provider: authDb.provider,
    schema: authDb.schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-secret-change-me",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
});
