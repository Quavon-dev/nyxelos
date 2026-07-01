import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import { migrate as migrateSqlite } from "drizzle-orm/bun-sqlite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { DEFAULT_SQLITE_PATH } from "./sqlite-path";

// Resolved relative to this file, not the caller's cwd, so `bun run
// db:migrate` works the same whether invoked from the repo root, from
// packages/db, or from apps/server.
const PACKAGE_DIR = fileURLToPath(new URL(".", import.meta.url));
const SQLITE_MIGRATIONS_DIR = `${PACKAGE_DIR}../drizzle/sqlite`;
const SQLITE_CHAT_TOOL_POLICY_MIGRATION = `${SQLITE_MIGRATIONS_DIR}/0010_optimal_midnight.sql`;

function sqliteHasTable(sqlite: Database, tableName: string) {
  return Boolean(
    sqlite
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName),
  );
}

function sqliteHasColumn(sqlite: Database, tableName: string, columnName: string) {
  const columns = sqlite.query(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
  return columns.some((column) => column.name === columnName);
}

function reconcileLegacySqliteChatToolPolicyMigration(sqlite: Database) {
  if (!sqliteHasTable(sqlite, "chat") || !sqliteHasTable(sqlite, "__drizzle_migrations")) return;
  if (!sqliteHasColumn(sqlite, "chat", "tool_mode")) return;
  if (!sqliteHasColumn(sqlite, "chat", "tool_policy")) return;

  const hash = createHash("sha256")
    .update(readFileSync(SQLITE_CHAT_TOOL_POLICY_MIGRATION, "utf8"))
    .digest("hex");
  const existing = sqlite
    .query("SELECT 1 FROM __drizzle_migrations WHERE hash = ? LIMIT 1")
    .get(hash);
  if (existing) return;

  console.warn(
    "SQLite drift detected: chat.tool_mode/tool_policy already exist before migration 0010 was recorded; marking that migration as applied.",
  );
  sqlite
    .query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
    .run(hash, Date.now());
}

export async function migrateDatabase() {
  const raw = process.env.DB_DRIVER?.toLowerCase();

  if (raw === "pg" || raw === "postgres" || raw === "postgresql") {
    const url = process.env.DATABASE_URL ?? "postgres://nyxel:nyxel@localhost:5432/nyxel";
    const client = postgres(url, { max: 1 });
    const db = drizzlePg(client);
    console.log(`Running Postgres migrations against ${url}...`);
    await migratePg(db, { migrationsFolder: `${PACKAGE_DIR}../drizzle/pg` });
    await client.end();
  } else {
    const path = process.env.DATABASE_URL ?? DEFAULT_SQLITE_PATH;
    const sqlite = new Database(path, { create: true });
    reconcileLegacySqliteChatToolPolicyMigration(sqlite);
    const db = drizzleSqlite(sqlite);
    console.log(`Running SQLite migrations against ${path}...`);
    await migrateSqlite(db, { migrationsFolder: SQLITE_MIGRATIONS_DIR });
  }

  console.log("Migrations complete.");
}

async function main() {
  await migrateDatabase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
