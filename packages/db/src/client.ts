import { createPgRepository } from "./repo/pg.repo";
import { createSqliteRepository } from "./repo/sqlite.repo";
import type { DbRepository } from "./repo/types";
import { DEFAULT_SQLITE_PATH } from "./sqlite-path";

export type DbDriver = "pg" | "sqlite";

function resolveDriver(): DbDriver {
	const raw = process.env.DB_DRIVER?.toLowerCase();
	if (raw === "pg" || raw === "postgres" || raw === "postgresql") return "pg";
	return "sqlite";
}

let cached: DbRepository | null = null;

/**
 * Returns the app's data-access layer for whichever dialect the installer
 * picked (DB_DRIVER=pg|sqlite, defaults to sqlite for the PC mode). See
 * ADR-0002 for why this is a repository interface rather than exposing raw
 * Drizzle tables to the rest of the app.
 */
export function getDb(): DbRepository {
	if (cached) return cached;
	const driver = resolveDriver();
	cached =
		driver === "pg"
			? createPgRepository(
					process.env.DATABASE_URL ??
						"postgres://nyxel:nyxel@localhost:5432/nyxel",
				)
			: createSqliteRepository(process.env.DATABASE_URL ?? DEFAULT_SQLITE_PATH);
	return cached;
}
