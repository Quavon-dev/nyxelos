import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { Context as HonoContext } from "hono";

export function createContext(_opts: FetchCreateContextFnOptions, _c: HonoContext) {
  return {};
}

export type Context = ReturnType<typeof createContext>;
