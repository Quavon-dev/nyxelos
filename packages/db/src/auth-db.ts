import { Database } from "bun:sqlite";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as pgSchema from "./schema/pg";
import * as sqliteSchema from "./schema/sqlite";

/**
 * Better-Auth needs a raw Drizzle instance + schema (it manages the
 * user/session/account/verification tables itself via its Drizzle adapter),
 * so this is separate from the DbRepository abstraction in client.ts, which
 * is what the rest of the app uses. Only apps/server/src/auth.ts should
 * import this.
 */
export function createAuthDb() {
  const raw = process.env.DB_DRIVER?.toLowerCase();

  if (raw === "pg" || raw === "postgres" || raw === "postgresql") {
    const client = postgres(
      process.env.DATABASE_URL ?? "postgres://nyxel:nyxel@localhost:5432/nyxel",
    );
    return {
      provider: "pg" as const,
      db: drizzlePg(client, { schema: pgSchema }),
      schema: pgSchema,
    };
  }

  const sqlite = new Database(process.env.DATABASE_URL ?? "./nyxel.sqlite", { create: true });
  return {
    provider: "sqlite" as const,
    db: drizzleSqlite(sqlite, { schema: sqliteSchema }),
    schema: sqliteSchema,
  };
}
