import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __setDbForTesting } from "./client";
import { migrateDatabase } from "./migrate";
import { createSqliteRepository } from "./repo/sqlite.repo";
import type { DbRepository } from "./repo/types";

/**
 * Spins up a throwaway SQLite database (temp file, real migrations applied)
 * for DB-backed tests — the codebase's test suite otherwise avoids touching
 * a real DB entirely (pure-logic tests, or auth-rejection short-circuits
 * that never reach a resolver body). `migrateDatabase()` only reads
 * `DATABASE_URL`/`DB_DRIVER` from `process.env`, so those are set for the
 * duration of the migration call and restored immediately after — tests
 * using this helper must not run concurrently with each other in the same
 * process (bun:test runs each file's tests sequentially by default, which
 * this relies on).
 */
export async function createTestSqliteRepository(): Promise<{
	db: DbRepository;
	path: string;
	cleanup: () => Promise<void>;
}> {
	const path = join(tmpdir(), `nyxel-test-${randomUUID()}.sqlite`);
	const prevUrl = process.env.DATABASE_URL;
	const prevDriver = process.env.DB_DRIVER;
	process.env.DATABASE_URL = path;
	process.env.DB_DRIVER = "sqlite";
	try {
		await migrateDatabase();
	} finally {
		if (prevUrl === undefined) delete process.env.DATABASE_URL;
		else process.env.DATABASE_URL = prevUrl;
		if (prevDriver === undefined) delete process.env.DB_DRIVER;
		else process.env.DB_DRIVER = prevDriver;
	}

	const db = createSqliteRepository(path);
	const cleanup = async () => {
		await Promise.all(
			[path, `${path}-wal`, `${path}-shm`].map((f) => rm(f, { force: true })),
		);
	};
	return { db, path, cleanup };
}

/**
 * Same as `createTestSqliteRepository`, but also installs the repository as
 * the process-wide `getDb()` singleton (`__setDbForTesting`) for the
 * duration of the test — required for anything that calls `getDb()`
 * directly rather than taking a repository as a parameter, which is most of
 * `apps/server/src` (agent-runtime, scheduler, goal-orchestrator, ...).
 * `cleanup()` un-installs it in addition to deleting the temp file.
 */
export async function installTestDb(): Promise<{
	db: DbRepository;
	path: string;
	cleanup: () => Promise<void>;
}> {
	const { db, path, cleanup } = await createTestSqliteRepository();
	__setDbForTesting(db);
	return {
		db,
		path,
		cleanup: async () => {
			__setDbForTesting(null);
			await cleanup();
		},
	};
}

/**
 * Inserts a bare `user` row directly (better-auth owns real user creation
 * via a separate connection — DbRepository intentionally has no createUser
 * method, see ADR-0002/0006). Test-only: opens its own short-lived
 * connection to the same file rather than reaching into DbRepository's
 * internals, which the repository pattern deliberately doesn't expose.
 */
export function createTestUser(
	path: string,
	input: { name?: string; email?: string } = {},
): { id: string; name: string; email: string } {
	const id = randomUUID();
	const name = input.name ?? "Test User";
	const email = input.email ?? `${id}@example.test`;
	const sqlite = new Database(path);
	try {
		const now = Date.now();
		sqlite
			.query(
				"INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
			)
			.run(id, name, email, now, now);
	} finally {
		sqlite.close();
	}
	return { id, name, email };
}
