import { createAuthDb } from "@nyxel/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

const authDb = createAuthDb();

/** Every origin the web app may be reached from — a LAN IP, a Tailscale/
 * ngrok tunnel, or a custom public domain, in addition to localhost. Set
 * WEB_ORIGIN to a comma-separated list to add more; see index.ts (CORS) and
 * trustedOrigins below, both driven by this same list. */
export const allowedWebOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

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
  trustedOrigins: allowedWebOrigins,
});
