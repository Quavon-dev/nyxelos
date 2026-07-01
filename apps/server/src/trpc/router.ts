import { getDb } from "@nyxel/db";
import { listAvailableModels } from "@nyxel/model-providers";
import { z } from "zod";
import { ensureMcpServerConnected, mcpManager } from "../mcp-runtime";
import { skillRegistry } from "../skills-registry";
import { publicProcedure, router } from "./trpc";

const autonomyLevelSchema = z.enum(["chat", "assisted", "autonomous", "super_agent"]);
const mcpTransportSchema = z.enum(["stdio", "http"]);

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true, name: "nyxel-server" })),

  demoUser: publicProcedure.query(() => getDb().getOrCreateDemoUser()),

  models: router({
    list: publicProcedure.query(() => listAvailableModels()),
  }),

  skills: router({
    // Read-only catalog for now — see ARCHITECTURE.md section 8 for the
    // planned per-workspace skill marketplace.
    list: publicProcedure.query(() =>
      skillRegistry.list().map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        permissions: skill.permissions,
      })),
    ),
  }),

  workspaces: router({
    list: publicProcedure
      .input(z.object({ userId: z.string() }))
      .query(({ input }) => getDb().listWorkspacesByUser(input.userId)),
    create: publicProcedure
      .input(z.object({ userId: z.string(), name: z.string().min(1) }))
      .mutation(({ input }) => getDb().createWorkspace(input)),
    get: publicProcedure
      .input(z.object({ workspaceId: z.string() }))
      .query(({ input }) => getDb().getWorkspace(input.workspaceId)),
    updateInstructions: publicProcedure
      .input(z.object({ workspaceId: z.string(), customInstructions: z.string().nullable() }))
      .mutation(({ input }) => getDb().updateWorkspaceInstructions(input)),
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
          modelId: z.string().optional(),
          agentId: z.string().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const db = getDb();
        let modelId = input.modelId;
        if (!modelId && input.agentId) {
          const agent = await db.getAgent(input.agentId);
          if (!agent) throw new Error(`Unknown agent: ${input.agentId}`);
          modelId = agent.modelId;
        }
        if (!modelId) throw new Error("chats.create needs either modelId or agentId.");
        return db.createChat({ ...input, modelId });
      }),
    messages: publicProcedure
      .input(z.object({ chatId: z.string() }))
      .query(({ input }) => getDb().listMessages(input.chatId)),
  }),

  agents: router({
    list: publicProcedure
      .input(z.object({ workspaceId: z.string() }))
      .query(({ input }) => getDb().listAgentsByWorkspace(input.workspaceId)),
    create: publicProcedure
      .input(
        z.object({
          workspaceId: z.string(),
          name: z.string().min(1),
          systemPrompt: z.string().optional(),
          modelId: z.string(),
          autonomyLevel: autonomyLevelSchema.optional(),
          skillIds: z.array(z.string()).optional(),
          mcpServerIds: z.array(z.string()).optional(),
        }),
      )
      .mutation(({ input }) => getDb().createAgent(input)),
  }),

  mcpServers: router({
    list: publicProcedure
      .input(z.object({ workspaceId: z.string() }))
      .query(({ input }) => getDb().listMcpServersByWorkspace(input.workspaceId)),
    create: publicProcedure
      .input(
        z.object({
          workspaceId: z.string(),
          name: z.string().min(1),
          transport: mcpTransportSchema,
          command: z.string().optional(),
          args: z.array(z.string()).optional(),
          url: z.string().optional(),
        }),
      )
      .mutation(({ input }) => getDb().createMcpServer(input)),
    delete: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ input }) => getDb().deleteMcpServer(input.id)),
    // Connects on demand and lists the server's tools — lets the UI offer a
    // "test connection" action without keeping every configured server
    // connected all the time.
    listTools: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
      const server = await getDb().getMcpServer(input.id);
      if (!server) throw new Error(`Unknown MCP server: ${input.id}`);
      await ensureMcpServerConnected(server);
      return mcpManager.listTools(server.id);
    }),
  }),
});

export type AppRouter = typeof appRouter;
