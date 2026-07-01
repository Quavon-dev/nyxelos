import { trpcServer } from "@hono/trpc-server";
import { migrateDatabase } from "@nyxel/db/migrate";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { allowedWebOrigins, auth } from "./auth";
import { startKnowledgeBaseSyncLoop } from "./knowledge-base";
import { registerChatStreamRoute } from "./routes/chat-stream";
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
    // Reflects any origin in the allowlist instead of a single fixed one —
    // lets the same web build be reached from a LAN IP, a Tailscale/ngrok
    // tunnel, or a custom domain, all pointed at this one server (see
    // WEB_ORIGIN in .env, comma-separated).
    origin: (origin) => (allowedWebOrigins.includes(origin) ? origin : allowedWebOrigins[0]),
    credentials: true,
  }),
);

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext,
  }),
);

registerChatStreamRoute(app);
startScheduler();
startKnowledgeBaseSyncLoop();

app.get("/", (c) => c.json({ name: "nyxel-server", status: "ok" }));

const port = Number(process.env.PORT ?? 3001);
console.log(`Nyxel server listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
