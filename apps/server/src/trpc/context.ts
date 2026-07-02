import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { Context as HonoContext } from "hono";
import { auth } from "../auth";

/**
 * Derives the caller's session from the better-auth cookie on every tRPC
 * request. The web client always sends `credentials: "include"`
 * (apps/web/src/lib/trpc.ts), so a logged-in browser's session cookie is
 * present here without any extra wiring — this is the one place a session
 * gets attached to ctx; procedures never re-derive it themselves.
 */
export async function createContext(_opts: FetchCreateContextFnOptions, c: HonoContext) {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	return {
		user: session?.user ?? null,
		session: session?.session ?? null,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
