import type { Context } from "hono";
import { auth } from "./auth";

/**
 * Session check for the plain (non-tRPC) Hono routes — chat streaming and
 * library file bytes (routes/chat-stream.ts, routes/library.ts) don't go
 * through trpc/context.ts, so they need their own copy of the same
 * `auth.api.getSession` call tRPC's createContext makes. Returns null
 * rather than throwing so each route can shape its own 401 response body.
 */
export async function getSessionUser(c: Context) {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	return session?.user ?? null;
}
