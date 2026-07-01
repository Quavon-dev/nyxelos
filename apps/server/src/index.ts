import { trpcServer } from "@hono/trpc-server";
import { migrateDatabase } from "@nyxel/db/migrate";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth";
import { startKnowledgeBaseSyncLoop } from "./knowledge-base";
import { registerChatStreamRoute } from "./routes/chat-stream";
import { startScheduler } from "./scheduler";
import { createContext } from "./trpc/context";
import { appRouter } from "./trpc/router";

await migrateDatabase();

const app = new Hono();

app.use(
  "*",
  cors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
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
