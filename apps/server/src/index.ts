import { trpcServer } from "@hono/trpc-server";
import { migrateDatabase } from "@nyxel/db/migrate";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { allowedWebOrigins, auth } from "./auth";
import { startKnowledgeBaseSyncLoop } from "./knowledge-base";
import { rateLimitMiddleware } from "./rate-limit";
import { registerChatStreamRoute } from "./routes/chat-stream";
import { registerLibraryRoutes } from "./routes/library";
import { startScheduler } from "./scheduler";
import { seedBuiltinToolsForAllWorkspaces } from "./tools-builtin-seed";
import { createContext } from "./trpc/context";
import { appRouter } from "./trpc/router";

await migrateDatabase();
// Backfills the builtin tool catalog into every workspace that existed
// before this feature shipped — idempotent, see tools-builtin-seed.ts.
await seedBuiltinToolsForAllWorkspaces();

const app = new Hono();

app.use(
  "*",
  cors({
    // Reflects an origin only if it's in the allowlist; any other origin
    // gets no Access-Control-Allow-Origin header at all (hono's cors()
    // omits the header when this callback returns undefined) instead of
    // the previous fail-open behavior of reflecting allowedWebOrigins[0]
    // for every unrecognized origin, which paired badly with
    // credentials: true. See WEB_ORIGIN in .env (comma-separated) to add
    // a LAN IP, tunnel, or custom domain to the allowlist.
    origin: (origin) => (allowedWebOrigins.includes(origin) ? origin : undefined),
    credentials: true,
  }),
);

// Auth endpoints are the brute-force/credential-stuffing surface — tighter
// budget than general API traffic.
app.use(
  "/api/auth/*",
  rateLimitMiddleware({ windowMs: 60_000, max: 20, keyPrefix: "auth" }),
);
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.use(
  "/trpc/*",
  rateLimitMiddleware({ windowMs: 60_000, max: 300, keyPrefix: "trpc" }),
);
app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext,
  }),
);

registerChatStreamRoute(app);
registerLibraryRoutes(app);
startScheduler();
startKnowledgeBaseSyncLoop();

app.get("/", (c) => c.json({ name: "nyxel-server", status: "ok" }));

const port = Number(process.env.PORT ?? 3001);
console.log(`Nyxel server listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
  // Bun's default is 10s of connection inactivity before it force-closes the
  // socket — the chat SSE stream can go quiet for well over that while a
  // tool call runs (image/speech generation, slow model calls), so the
  // connection was dying mid-turn with no bytes ever flushed: no error to
  // the client, and chat-stream.ts's catch block skips persisting anything
  // once cancel() has already marked it disconnected. 255 is Bun's max.
  idleTimeout: 255,
};
