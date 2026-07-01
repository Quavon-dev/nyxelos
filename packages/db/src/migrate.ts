import { Database } from "bun:sqlite";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import { migrate as migrateSqlite } from "drizzle-orm/bun-sqlite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const raw = process.env.DB_DRIVER?.toLowerCase();

  if (raw === "pg" || raw === "postgres" || raw === "postgresql") {
    const url = process.env.DATABASE_URL ?? "postgres://nyxel:nyxel@localhost:5432/nyxel";
    const client = postgres(url, { max: 1 });
    const db = drizzlePg(client);
    console.log(`Running Postgres migrations against ${url}...`);
    await migratePg(db, { migrationsFolder: "./drizzle/pg" });
    await client.end();
  } else {
    const path = process.env.DATABASE_URL ?? "./nyxel.sqlite";
    const sqlite = new Database(path, { create: true });
    const db = drizzleSqlite(sqlite);
    console.log(`Running SQLite migrations against ${path}...`);
    migrateSqlite(db, { migrationsFolder: "./drizzle/sqlite" });
  }

  console.log("Migrations complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
