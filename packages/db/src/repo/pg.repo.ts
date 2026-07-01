import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema/pg";
import type { DbRepository } from "./types";

export function createPgRepository(connectionString: string): DbRepository {
  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  return {
    driver: "pg",

    async getOrCreateDemoUser() {
      const existing = await db.query.user.findFirst({
        where: eq(schema.user.email, "demo@nyxel.local"),
      });
      if (existing) return existing;

      const [created] = await db
        .insert(schema.user)
        .values({
          id: randomUUID(),
          name: "Demo User",
          email: "demo@nyxel.local",
        })
        .returning();
      if (!created) throw new Error("Failed to create demo user");
      return created;
    },

    async getUser(userId) {
      const row = await db.query.user.findFirst({ where: eq(schema.user.id, userId) });
      if (!row) return null;
      return { id: row.id, name: row.name, email: row.email };
    },

    async getInstallation() {
      const row = await db.query.installation.findFirst({
        where: eq(schema.installation.id, "main"),
      });
      return row ?? null;
    },

    async completeInstallation({ mode, ownerUserId, primaryWorkspaceId, appUrl }) {
      const existing = await db.query.installation.findFirst({
        where: eq(schema.installation.id, "main"),
      });
      if (existing) {
        const [row] = await db
          .update(schema.installation)
          .set({
            mode,
            ownerUserId,
            primaryWorkspaceId,
            appUrl: appUrl ?? null,
            updatedAt: new Date(),
          })
          .where(eq(schema.installation.id, "main"))
          .returning();
        if (!row) throw new Error("Failed to update installation");
        return row;
      }

      const [row] = await db
        .insert(schema.installation)
        .values({
          id: "main",
          mode,
          ownerUserId,
          primaryWorkspaceId,
          appUrl: appUrl ?? null,
        })
        .returning();
      if (!row) throw new Error("Failed to create installation");
      return row;
    },

    async createWorkspace({ userId, name }) {
      const [row] = await db
        .insert(schema.workspace)
        .values({ id: randomUUID(), userId, name })
        .returning();
      if (!row) throw new Error("Failed to create workspace");
      return { id: row.id, name: row.name, customInstructions: row.customInstructions };
    },

    async listWorkspacesByUser(userId) {
      const rows = await db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.userId, userId));
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        customInstructions: r.customInstructions,
      }));
    },

    async listWorkspaces() {
      const rows = await db.select().from(schema.workspace);
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        customInstructions: r.customInstructions,
      }));
    },

    async getWorkspace(workspaceId) {
      const row = await db.query.workspace.findFirst({
        where: eq(schema.workspace.id, workspaceId),
      });
      if (!row) return null;
      return { id: row.id, name: row.name, customInstructions: row.customInstructions };
    },

    async updateWorkspaceInstructions({ workspaceId, customInstructions }) {
      const [row] = await db
        .update(schema.workspace)
        .set({ customInstructions })
        .where(eq(schema.workspace.id, workspaceId))
        .returning();
      if (!row) throw new Error(`Workspace not found: ${workspaceId}`);
      return { id: row.id, name: row.name, customInstructions: row.customInstructions };
    },

    async createModelInstallation({
      workspaceId,
      label,
      providerKind,
      baseUrl,
      apiKey,
      modelIds,
      enabled,
    }) {
      const [row] = await db
        .insert(schema.modelInstallation)
        .values({
          id: randomUUID(),
          workspaceId,
          label,
          providerKind,
          baseUrl,
          apiKey: apiKey ?? null,
          modelIds,
          enabled: enabled ?? true,
          updatedAt: new Date(),
        })
        .returning();
      if (!row) throw new Error("Failed to create model installation");
      return row;
    },

    async listModelInstallationsByWorkspace(workspaceId) {
      return db
        .select()
        .from(schema.modelInstallation)
        .where(eq(schema.modelInstallation.workspaceId, workspaceId));
    },

    async getModelInstallation(id) {
      const row = await db.query.modelInstallation.findFirst({
        where: eq(schema.modelInstallation.id, id),
      });
      return row ?? null;
    },

    async deleteModelInstallation(id) {
      await db.delete(schema.modelInstallation).where(eq(schema.modelInstallation.id, id));
    },

    async createChat({ workspaceId, title, modelId, agentId }) {
      const [row] = await db
        .insert(schema.chat)
        .values({ id: randomUUID(), workspaceId, title, modelId, agentId: agentId ?? null })
        .returning();
      if (!row) throw new Error("Failed to create chat");
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        agentId: row.agentId,
        title: row.title,
        modelId: row.modelId,
        archivedAt: row.archivedAt,
        createdAt: row.createdAt,
      };
    },

    async listChatsByWorkspace(workspaceId) {
      const rows = await db
        .select()
        .from(schema.chat)
        .where(and(eq(schema.chat.workspaceId, workspaceId), isNull(schema.chat.archivedAt)));
      return rows.map((r) => ({
        id: r.id,
        workspaceId: r.workspaceId,
        agentId: r.agentId,
        title: r.title,
        modelId: r.modelId,
        archivedAt: r.archivedAt,
        createdAt: r.createdAt,
      }));
    },

    async listArchivedChatsByWorkspace(workspaceId) {
      const rows = await db
        .select()
        .from(schema.chat)
        .where(and(eq(schema.chat.workspaceId, workspaceId), isNotNull(schema.chat.archivedAt)));
      return rows.map((r) => ({
        id: r.id,
        workspaceId: r.workspaceId,
        agentId: r.agentId,
        title: r.title,
        modelId: r.modelId,
        archivedAt: r.archivedAt,
        createdAt: r.createdAt,
      }));
    },

    async getChat(chatId) {
      const row = await db.query.chat.findFirst({ where: eq(schema.chat.id, chatId) });
      if (!row) return null;
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        agentId: row.agentId,
        title: row.title,
        modelId: row.modelId,
        archivedAt: row.archivedAt,
        createdAt: row.createdAt,
      };
    },

    async renameChat(chatId, title) {
      const [row] = await db
        .update(schema.chat)
        .set({ title })
        .where(eq(schema.chat.id, chatId))
        .returning();
      if (!row) throw new Error(`Chat not found: ${chatId}`);
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        agentId: row.agentId,
        title: row.title,
        modelId: row.modelId,
        archivedAt: row.archivedAt,
        createdAt: row.createdAt,
      };
    },

    async setChatArchived(chatId, archived) {
      const [row] = await db
        .update(schema.chat)
        .set({ archivedAt: archived ? new Date() : null })
        .where(eq(schema.chat.id, chatId))
        .returning();
      if (!row) throw new Error(`Chat not found: ${chatId}`);
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        agentId: row.agentId,
        title: row.title,
        modelId: row.modelId,
        archivedAt: row.archivedAt,
        createdAt: row.createdAt,
      };
    },

    async deleteChat(chatId) {
      await db.delete(schema.chat).where(eq(schema.chat.id, chatId));
    },

    async updateChatAgent(chatId, agentId) {
      const [row] = await db
        .update(schema.chat)
        .set({ agentId })
        .where(eq(schema.chat.id, chatId))
        .returning();
      if (!row) throw new Error(`Chat not found: ${chatId}`);
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        agentId: row.agentId,
        title: row.title,
        modelId: row.modelId,
        archivedAt: row.archivedAt,
        createdAt: row.createdAt,
      };
    },

    async addMessage({ chatId, role, content }) {
      const [row] = await db
        .insert(schema.message)
        .values({ id: randomUUID(), chatId, role, content })
        .returning();
      if (!row) throw new Error("Failed to add message");
      return {
        id: row.id,
        chatId: row.chatId,
        role: row.role,
        content: row.content,
        createdAt: row.createdAt,
      };
    },

    async listMessages(chatId) {
      const rows = await db.select().from(schema.message).where(eq(schema.message.chatId, chatId));
      return rows.map((r) => ({
        id: r.id,
        chatId: r.chatId,
        role: r.role,
        content: r.content,
        createdAt: r.createdAt,
      }));
    },

    async createAgent({
      workspaceId,
      name,
      systemPrompt,
      modelId,
      autonomyLevel,
      skillIds,
      mcpServerIds,
      mcpToolFilter,
      delegateAgentIds,
    }) {
      const [row] = await db
        .insert(schema.agent)
        .values({
          id: randomUUID(),
          workspaceId,
          name,
          systemPrompt: systemPrompt ?? null,
          modelId,
          autonomyLevel: autonomyLevel ?? "chat",
          skillIds: skillIds ?? [],
          mcpServerIds: mcpServerIds ?? [],
          mcpToolFilter: mcpToolFilter ?? null,
          delegateAgentIds: delegateAgentIds ?? [],
        })
        .returning();
      if (!row) throw new Error("Failed to create agent");
      return row;
    },

    async listAgentsByWorkspace(workspaceId) {
      return db.select().from(schema.agent).where(eq(schema.agent.workspaceId, workspaceId));
    },

    async getAgent(agentId) {
      const row = await db.query.agent.findFirst({ where: eq(schema.agent.id, agentId) });
      return row ?? null;
    },

    async createMcpServer({ workspaceId, name, transport, command, args, url }) {
      const [row] = await db
        .insert(schema.mcpServer)
        .values({
          id: randomUUID(),
          workspaceId,
          name,
          transport,
          command: command ?? null,
          args: args ?? null,
          url: url ?? null,
        })
        .returning();
      if (!row) throw new Error("Failed to create MCP server");
      return row;
    },

    async listMcpServersByWorkspace(workspaceId) {
      return db
        .select()
        .from(schema.mcpServer)
        .where(eq(schema.mcpServer.workspaceId, workspaceId));
    },

    async getMcpServer(id) {
      const row = await db.query.mcpServer.findFirst({ where: eq(schema.mcpServer.id, id) });
      return row ?? null;
    },

    async deleteMcpServer(id) {
      await db.delete(schema.mcpServer).where(eq(schema.mcpServer.id, id));
    },

    async getKnowledgeBaseConfig(workspaceId) {
      const row = await db.query.knowledgeBaseConfig.findFirst({
        where: eq(schema.knowledgeBaseConfig.workspaceId, workspaceId),
      });
      return row ?? null;
    },

    async listKnowledgeBaseConfigs() {
      return db.select().from(schema.knowledgeBaseConfig);
    },

    async upsertKnowledgeBaseConfig({
      workspaceId,
      vaultPath,
      obsidianRestUrl,
      obsidianApiKey,
      docsAgentEnabled,
      injectIntoPrompts,
    }) {
      const existing = await db.query.knowledgeBaseConfig.findFirst({
        where: eq(schema.knowledgeBaseConfig.workspaceId, workspaceId),
      });
      if (existing) {
        const [row] = await db
          .update(schema.knowledgeBaseConfig)
          .set({
            vaultPath,
            obsidianRestUrl: obsidianRestUrl ?? null,
            obsidianApiKey: obsidianApiKey ?? null,
            docsAgentEnabled: docsAgentEnabled ?? existing.docsAgentEnabled,
            injectIntoPrompts: injectIntoPrompts ?? existing.injectIntoPrompts,
            updatedAt: new Date(),
          })
          .where(eq(schema.knowledgeBaseConfig.workspaceId, workspaceId))
          .returning();
        if (!row) throw new Error(`Knowledge base config not found: ${workspaceId}`);
        return row;
      }

      const [row] = await db
        .insert(schema.knowledgeBaseConfig)
        .values({
          workspaceId,
          vaultPath,
          obsidianRestUrl: obsidianRestUrl ?? null,
          obsidianApiKey: obsidianApiKey ?? null,
          docsAgentEnabled: docsAgentEnabled ?? true,
          injectIntoPrompts: injectIntoPrompts ?? true,
          updatedAt: new Date(),
        })
        .returning();
      if (!row) throw new Error("Failed to create knowledge base config");
      return row;
    },

    async updateKnowledgeBaseSyncStatus({ workspaceId, lastDocsSyncAt, lastDocsSyncError }) {
      const [row] = await db
        .update(schema.knowledgeBaseConfig)
        .set({
          lastDocsSyncAt,
          lastDocsSyncError: lastDocsSyncError ?? null,
          updatedAt: new Date(),
        })
        .where(eq(schema.knowledgeBaseConfig.workspaceId, workspaceId))
        .returning();
      if (!row) throw new Error(`Knowledge base config not found: ${workspaceId}`);
      return row;
    },

    async createAutomation({
      workspaceId,
      agentId,
      name,
      triggerType,
      cronExpression,
      watchPath,
      watchGlob,
      prompt,
      enabled,
      nextRunAt,
    }) {
      const [row] = await db
        .insert(schema.automation)
        .values({
          id: randomUUID(),
          workspaceId,
          agentId,
          name,
          triggerType: triggerType ?? "cron",
          cronExpression: cronExpression ?? "",
          watchPath: watchPath ?? null,
          watchGlob: watchGlob ?? null,
          prompt,
          enabled: enabled ?? true,
          nextRunAt: nextRunAt ?? null,
        })
        .returning();
      if (!row) throw new Error("Failed to create automation");
      return row;
    },

    async listAutomationsByWorkspace(workspaceId) {
      return db
        .select()
        .from(schema.automation)
        .where(eq(schema.automation.workspaceId, workspaceId));
    },

    async listDueAutomations(now) {
      return db
        .select()
        .from(schema.automation)
        .where(and(eq(schema.automation.enabled, true), lte(schema.automation.nextRunAt, now)));
    },

    async listFileWatchAutomations() {
      return db
        .select()
        .from(schema.automation)
        .where(
          and(eq(schema.automation.enabled, true), eq(schema.automation.triggerType, "file_watch")),
        );
    },

    async getAutomation(id) {
      const row = await db.query.automation.findFirst({ where: eq(schema.automation.id, id) });
      return row ?? null;
    },

    async updateAutomationRun({ id, lastRunAt, nextRunAt }) {
      const [row] = await db
        .update(schema.automation)
        .set({ lastRunAt, nextRunAt })
        .where(eq(schema.automation.id, id))
        .returning();
      if (!row) throw new Error(`Automation not found: ${id}`);
      return row;
    },

    async setAutomationNextRun(id, nextRunAt) {
      const [row] = await db
        .update(schema.automation)
        .set({ nextRunAt })
        .where(eq(schema.automation.id, id))
        .returning();
      if (!row) throw new Error(`Automation not found: ${id}`);
      return row;
    },

    async setAutomationEnabled(id, enabled) {
      const [row] = await db
        .update(schema.automation)
        .set({ enabled })
        .where(eq(schema.automation.id, id))
        .returning();
      if (!row) throw new Error(`Automation not found: ${id}`);
      return row;
    },

    async setAutomationWatchCheckedAt(id, lastWatchCheckAt) {
      const [row] = await db
        .update(schema.automation)
        .set({ lastWatchCheckAt })
        .where(eq(schema.automation.id, id))
        .returning();
      if (!row) throw new Error(`Automation not found: ${id}`);
      return row;
    },

    async deleteAutomation(id) {
      await db.delete(schema.automation).where(eq(schema.automation.id, id));
    },

    async createSkill({ workspaceId, name, description, kind, config, sensitive, enabled }) {
      const [row] = await db
        .insert(schema.skill)
        .values({
          id: randomUUID(),
          workspaceId,
          name,
          description,
          kind,
          config,
          sensitive: sensitive ?? true,
          enabled: enabled ?? true,
        })
        .returning();
      if (!row) throw new Error("Failed to create skill");
      return row;
    },

    async listSkillsByWorkspace(workspaceId) {
      return db.select().from(schema.skill).where(eq(schema.skill.workspaceId, workspaceId));
    },

    async getSkill(id) {
      const row = await db.query.skill.findFirst({ where: eq(schema.skill.id, id) });
      return row ?? null;
    },

    async setSkillEnabled(id, enabled) {
      const [row] = await db
        .update(schema.skill)
        .set({ enabled })
        .where(eq(schema.skill.id, id))
        .returning();
      if (!row) throw new Error(`Skill not found: ${id}`);
      return row;
    },

    async deleteSkill(id) {
      await db.delete(schema.skill).where(eq(schema.skill.id, id));
    },

    async createApprovalRequest({
      workspaceId,
      agentId,
      chatId,
      automationId,
      kind,
      skillId,
      mcpServerId,
      mcpToolName,
      toolLabel,
      input,
    }) {
      const [row] = await db
        .insert(schema.approvalRequest)
        .values({
          id: randomUUID(),
          workspaceId,
          agentId,
          chatId: chatId ?? null,
          automationId: automationId ?? null,
          kind,
          skillId: skillId ?? null,
          mcpServerId: mcpServerId ?? null,
          mcpToolName: mcpToolName ?? null,
          toolLabel,
          input,
          status: "pending",
        })
        .returning();
      if (!row) throw new Error("Failed to create approval request");
      return row;
    },

    async listApprovalsByWorkspace(workspaceId, status) {
      const condition = status
        ? and(
            eq(schema.approvalRequest.workspaceId, workspaceId),
            eq(schema.approvalRequest.status, status),
          )
        : eq(schema.approvalRequest.workspaceId, workspaceId);
      return db
        .select()
        .from(schema.approvalRequest)
        .where(condition)
        .orderBy(desc(schema.approvalRequest.createdAt));
    },

    async getApprovalRequest(id) {
      const row = await db.query.approvalRequest.findFirst({
        where: eq(schema.approvalRequest.id, id),
      });
      return row ?? null;
    },

    async resolveApprovalRequest({ id, status, resultOutput, errorMessage }) {
      const [row] = await db
        .update(schema.approvalRequest)
        .set({ status, resultOutput, errorMessage: errorMessage ?? null, resolvedAt: new Date() })
        .where(eq(schema.approvalRequest.id, id))
        .returning();
      if (!row) throw new Error(`Approval request not found: ${id}`);
      return row;
    },

    async createAuditLog({
      workspaceId,
      agentId,
      chatId,
      automationId,
      actor,
      toolLabel,
      input,
      output,
      status,
    }) {
      const [row] = await db
        .insert(schema.auditLog)
        .values({
          id: randomUUID(),
          workspaceId,
          agentId: agentId ?? null,
          chatId: chatId ?? null,
          automationId: automationId ?? null,
          actor,
          toolLabel,
          input: input ?? null,
          output: output ?? null,
          status,
        })
        .returning();
      if (!row) throw new Error("Failed to create audit log entry");
      return row;
    },

    async listAuditLogByWorkspace(workspaceId, limit = 100) {
      return db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.workspaceId, workspaceId))
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(limit);
    },
  };
}
