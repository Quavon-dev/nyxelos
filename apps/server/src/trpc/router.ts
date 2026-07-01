import { getDb } from "@nyxel/db";
import { listAvailableModels, probeOpenAiCompatibleEndpoint } from "@nyxel/model-providers";
import { z } from "zod";
import { resolveApprovalDecision } from "../approvals";
import { auth } from "../auth";
import {
  buildKnowledgeBaseGraph,
  getKnowledgeBaseOverview,
  listKnowledgeBaseDocuments,
  runDocsAgentForWorkspace,
} from "../knowledge-base";
import { ensureMcpServerConnected, mcpManager } from "../mcp-runtime";
import { getInstalledProvidersForWorkspace } from "../models";
import { computeNextRunAt, runAutomation } from "../scheduler";
import { skillRegistry } from "../skills-registry";
import { publicProcedure, router } from "./trpc";

const autonomyLevelSchema = z.enum(["chat", "assisted", "autonomous", "super_agent"]);
const mcpTransportSchema = z.enum(["stdio", "http"]);
const approvalStatusSchema = z.enum(["pending", "approved", "rejected"]);
const installationModeSchema = z.enum(["pc", "server"]);
const modelProviderKindSchema = z.enum(["openai_compatible"]);
const AUTOMATABLE_LEVELS = new Set(["autonomous", "super_agent"]);

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true, name: "nyxel-server" })),

  demoUser: publicProcedure.query(() => getDb().getOrCreateDemoUser()),

  installation: router({
    status: publicProcedure.query(async () => {
      const db = getDb();
      const installation = await db.getInstallation();
      const recommendedMode = db.driver === "pg" ? "server" : "pc";
      const defaultAppUrl =
        process.env.PUBLIC_APP_URL ??
        (recommendedMode === "server"
          ? `https://${process.env.NYXEL_DOMAIN ?? "nyxel.example.com"}`
          : "http://localhost:3000");

      return {
        isInstalled: installation !== null,
        driver: db.driver,
        recommendedMode,
        defaultAppUrl,
        record: installation,
      };
    }),
    complete: publicProcedure
      .input(
        z.object({
          mode: installationModeSchema,
          ownerName: z.string().min(2),
          ownerEmail: z.string().email(),
          ownerPassword: z.string().min(8),
          workspaceName: z.string().min(1),
          appUrl: z.string().url().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const db = getDb();
        const existing = await db.getInstallation();
        if (existing) return existing;

        const signUpResult = await auth.api.signUpEmail({
          body: {
            name: input.ownerName,
            email: input.ownerEmail,
            password: input.ownerPassword,
          },
        });

        const workspace = await db.createWorkspace({
          userId: signUpResult.user.id,
          name: input.workspaceName,
        });

        return db.completeInstallation({
          mode: input.mode,
          ownerUserId: signUpResult.user.id,
          primaryWorkspaceId: workspace.id,
          appUrl: input.appUrl ?? null,
        });
      }),
  }),

  models: router({
    list: publicProcedure
      .input(z.object({ workspaceId: z.string().optional() }).optional())
      .query(async ({ input }) => {
        const providers = input?.workspaceId
          ? await getInstalledProvidersForWorkspace(input.workspaceId)
          : [];
        return listAvailableModels(providers);
      }),
    installations: publicProcedure
      .input(z.object({ workspaceId: z.string() }))
      .query(({ input }) => getDb().listModelInstallationsByWorkspace(input.workspaceId)),
    probe: publicProcedure
      .input(
        z.object({
          label: z.string().min(1).optional(),
          baseUrl: z.string().url(),
          apiKey: z.string().min(1).optional(),
        }),
      )
      .query(async ({ input }) => {
        const detected = await probeOpenAiCompatibleEndpoint({
          baseUrl: input.baseUrl,
          apiKey: input.apiKey,
          providerLabel: input.label,
        });
        if (!detected) {
          throw new Error(`No OpenAI-compatible models found at ${input.baseUrl}.`);
        }
        return detected;
      }),
    installCustom: publicProcedure
      .input(
        z.object({
          workspaceId: z.string(),
          label: z.string().min(1),
          providerKind: modelProviderKindSchema.default("openai_compatible"),
          baseUrl: z.string().url(),
          apiKey: z.string().min(1).optional(),
          modelIds: z.array(z.string().min(1)).min(1).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const detected = await probeOpenAiCompatibleEndpoint({
          baseUrl: input.baseUrl,
          apiKey: input.apiKey,
          providerLabel: input.label,
        });
        if (!detected) {
          throw new Error(`No OpenAI-compatible models found at ${input.baseUrl}.`);
        }

        const modelIds =
          input.modelIds?.length &&
          input.modelIds.every((modelId) => detected.modelIds.includes(modelId))
            ? input.modelIds
            : detected.modelIds;

        return getDb().createModelInstallation({
          workspaceId: input.workspaceId,
          label: input.label,
          providerKind: input.providerKind,
          baseUrl: detected.baseUrl,
          apiKey: input.apiKey ?? null,
          modelIds,
          enabled: true,
        });
      }),
    deleteInstallation: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ input }) => getDb().deleteModelInstallation(input.id)),
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
        sensitive: skill.sensitive,
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
          // Only meaningful for autonomyLevel "super_agent" — see ADR-0011.
          delegateAgentIds: z.array(z.string()).optional(),
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

  automations: router({
    list: publicProcedure
      .input(z.object({ workspaceId: z.string() }))
      .query(({ input }) => getDb().listAutomationsByWorkspace(input.workspaceId)),
    create: publicProcedure
      .input(
        z.object({
          workspaceId: z.string(),
          agentId: z.string(),
          name: z.string().min(1),
          cronExpression: z.string().min(1),
          prompt: z.string().min(1),
          enabled: z.boolean().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const db = getDb();
        const agent = await db.getAgent(input.agentId);
        if (!agent) throw new Error(`Unknown agent: ${input.agentId}`);
        if (!AUTOMATABLE_LEVELS.has(agent.autonomyLevel)) {
          throw new Error(
            `Agent "${agent.name}" has autonomy level "${agent.autonomyLevel}" — only "autonomous" or "super_agent" agents can be scheduled.`,
          );
        }
        const nextRunAt = computeNextRunAt(input.cronExpression, new Date());
        if (!nextRunAt)
          throw new Error(`"${input.cronExpression}" is not a valid cron expression.`);
        return db.createAutomation({ ...input, nextRunAt });
      }),
    setEnabled: publicProcedure
      .input(z.object({ id: z.string(), enabled: z.boolean() }))
      .mutation(async ({ input }) => {
        const db = getDb();
        if (input.enabled) {
          // Re-enabling: recompute nextRunAt from "now" rather than resuming
          // whatever stale schedule was in place before it was disabled.
          const automation = await db.getAutomation(input.id);
          if (!automation) throw new Error(`Unknown automation: ${input.id}`);
          const nextRunAt = computeNextRunAt(automation.cronExpression, new Date());
          await db.setAutomationNextRun(input.id, nextRunAt);
        }
        return db.setAutomationEnabled(input.id, input.enabled);
      }),
    delete: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ input }) => getDb().deleteAutomation(input.id)),
    runNow: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
      const db = getDb();
      const automation = await db.getAutomation(input.id);
      if (!automation) throw new Error(`Unknown automation: ${input.id}`);
      await runAutomation(automation);
      const updated = await db.getAutomation(input.id);
      if (!updated) throw new Error(`Automation disappeared during run: ${input.id}`);
      return updated;
    }),
  }),

  approvals: router({
    list: publicProcedure
      .input(z.object({ workspaceId: z.string(), status: approvalStatusSchema.optional() }))
      .query(({ input }) => getDb().listApprovalsByWorkspace(input.workspaceId, input.status)),
    approve: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ input }) => resolveApprovalDecision(input.id, "approved")),
    reject: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ input }) => resolveApprovalDecision(input.id, "rejected")),
  }),

  auditLog: router({
    list: publicProcedure
      .input(z.object({ workspaceId: z.string(), limit: z.number().min(1).max(500).optional() }))
      .query(({ input }) => getDb().listAuditLogByWorkspace(input.workspaceId, input.limit)),
  }),

  knowledgeBase: router({
    overview: publicProcedure
      .input(z.object({ workspaceId: z.string() }))
      .query(({ input }) => getKnowledgeBaseOverview(input.workspaceId)),
    updateConfig: publicProcedure
      .input(
        z.object({
          workspaceId: z.string(),
          vaultPath: z.string().min(1),
          obsidianRestUrl: z.string().url().nullable().optional(),
          obsidianApiKey: z.string().nullable().optional(),
          docsAgentEnabled: z.boolean().optional(),
        }),
      )
      .mutation(({ input }) =>
        getDb().upsertKnowledgeBaseConfig({
          workspaceId: input.workspaceId,
          vaultPath: input.vaultPath,
          obsidianRestUrl: input.obsidianRestUrl ?? null,
          obsidianApiKey: input.obsidianApiKey ?? null,
          docsAgentEnabled: input.docsAgentEnabled,
        }),
      ),
    documents: publicProcedure
      .input(z.object({ workspaceId: z.string() }))
      .query(({ input }) => listKnowledgeBaseDocuments(input.workspaceId)),
    graph: publicProcedure.input(z.object({ workspaceId: z.string() })).query(async ({ input }) => {
      const documents = await listKnowledgeBaseDocuments(input.workspaceId);
      return buildKnowledgeBaseGraph(documents);
    }),
    runDocsAgent: publicProcedure
      .input(z.object({ workspaceId: z.string() }))
      .mutation(({ input }) => runDocsAgentForWorkspace(input.workspaceId, "manual")),
  }),
});

export type AppRouter = typeof appRouter;
