import { fileURLToPath } from "node:url";

// Keep SQLite's default location stable regardless of the caller's cwd so
// `bun dev`, `bun db:migrate`, and direct package entrypoints all hit the
// same database file.
export const DEFAULT_SQLITE_PATH = fileURLToPath(
	new URL("../../../apps/server/nyxel.sqlite", import.meta.url),
);
