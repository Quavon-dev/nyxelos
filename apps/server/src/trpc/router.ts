import { getDb } from "@nyxel/db";
import { listAvailableModels } from "@nyxel/model-providers";
import { z } from "zod";
import { publicProcedure, router } from "./trpc";

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true, name: "nyxel-server" })),

  demoUser: publicProcedure.query(() => getDb().getOrCreateDemoUser()),

  models: router({
    list: publicProcedure.query(() => listAvailableModels()),
  }),

  workspaces: router({
    list: publicProcedure
      .input(z.object({ userId: z.string() }))
      .query(({ input }) => getDb().listWorkspacesByUser(input.userId)),
    create: publicProcedure
      .input(z.object({ userId: z.string(), name: z.string().min(1) }))
      .mutation(({ input }) => getDb().createWorkspace(input)),
  }),

  chats: router({
    list: publicProcedure
      .input(z.object({ workspaceId: z.string() }))
      .query(({ input }) => getDb().listChatsByWorkspace(input.workspaceId)),
    create: publicProcedure
      .input(
        z.object({
          workspaceId: z.string(),
          title: z.string().default("New chat"),
          modelId: z.string(),
        }),
      )
      .mutation(({ input }) => getDb().createChat(input)),
    messages: publicProcedure
      .input(z.object({ chatId: z.string() }))
      .query(({ input }) => getDb().listMessages(input.chatId)),
  }),
});

export type AppRouter = typeof appRouter;
