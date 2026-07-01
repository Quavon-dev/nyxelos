import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema/sqlite";
import type { DbRepository } from "./types";

export function createSqliteRepository(filePath: string): DbRepository {
  const sqlite = new Database(filePath, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  // Older local databases created before chat archiving existed may still be
  // missing the archived_at column. Add it in place so chat creation and
  // list/restore flows keep working without forcing a manual reset.
  const chatTable = sqlite
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get("chat") as { name: string } | null;
  if (chatTable) {
    const chatColumns = sqlite.query("PRAGMA table_info(chat)").all() as { name: string }[];
    if (!chatColumns.some((column) => column.name === "archived_at")) {
      sqlite.exec("ALTER TABLE chat ADD COLUMN archived_at integer;");
    }
  }

  const db = drizzle(sqlite, { schema });

  return {
    driver: "sqlite",

    async getOrCreateDemoUser() {
      const existing = db
        .select()
        .from(schema.user)
        .where(eq(schema.user.email, "demo@nyxel.local"))
        .get();
      if (existing) return existing;

      const now = new Date();
      const row = db
        .insert(schema.user)
        .values({
          id: randomUUID(),
          name: "Demo User",
          email: "demo@nyxel.local",
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      return row;
    },

    async getUser(userId) {
      const row = db.select().from(schema.user).where(eq(schema.user.id, userId)).get();
      if (!row) return null;
      return { id: row.id, name: row.name, email: row.email };
    },

    async getInstallation() {
      const row = db
        .select()
        .from(schema.installation)
        .where(eq(schema.installation.id, "main"))
        .get();
      return row ?? null;
    },

    async completeInstallation({ mode, ownerUserId, primaryWorkspaceId, appUrl }) {
      const now = new Date();
      const existing = db
        .select()
        .from(schema.installation)
        .where(eq(schema.installation.id, "main"))
        .get();

      if (existing) {
        const row = db
          .update(schema.installation)
          .set({ mode, ownerUserId, primaryWorkspaceId, appUrl: appUrl ?? null, updatedAt: now })
          .where(eq(schema.installation.id, "main"))
          .returning()
          .get();
        if (!row) throw new Error("Failed to update installation");
        return row;
      }

      const row = db
        .insert(schema.installation)
        .values({
          id: "main",
          mode,
          ownerUserId,
          primaryWorkspaceId,
          appUrl: appUrl ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      return row;
    },

    async createWorkspace({ userId, name }) {
      const row = db
        .insert(schema.workspace)
        .values({ id: randomUUID(), userId, name, createdAt: new Date() })
        .returning()
        .get();
      return { id: row.id, name: row.name, customInstructions: row.customInstructions };
    },

    async listWorkspacesByUser(userId) {
      const rows = db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.userId, userId))
        .all();
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        customInstructions: r.customInstructions,
      }));
    },

    async listWorkspaces() {
      const rows = db.select().from(schema.workspace).all();
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        customInstructions: r.customInstructions,
      }));
    },

    async getWorkspace(workspaceId) {
      const row = db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.id, workspaceId))
        .get();
      if (!row) return null;
      return { id: row.id, name: row.name, customInstructions: row.customInstructions };
    },

    async updateWorkspaceInstructions({ workspaceId, customInstructions }) {
      const row = db
        .update(schema.workspace)
        .set({ customInstructions })
        .where(eq(schema.workspace.id, workspaceId))
        .returning()
        .get();
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
      const now = new Date();
      const row = db
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
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      return row;
    },

    async listModelInstallationsByWorkspace(workspaceId) {
      return db
        .select()
        .from(schema.modelInstallation)
        .where(eq(schema.modelInstallation.workspaceId, workspaceId))
        .all();
    },

    async getModelInstallation(id) {
      const row = db
        .select()
        .from(schema.modelInstallation)
        .where(eq(schema.modelInstallation.id, id))
        .get();
      return row ?? null;
    },

    async deleteModelInstallation(id) {
      db.delete(schema.modelInstallation).where(eq(schema.modelInstallation.id, id)).run();
    },

    async createChat({ workspaceId, title, modelId, agentId }) {
      const row = db
        .insert(schema.chat)
        .values({
          id: randomUUID(),
          workspaceId,
          title,
          modelId,
          agentId: agentId ?? null,
          createdAt: new Date(),
        })
        .returning()
        .get();
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
      const rows = db
        .select()
        .from(schema.chat)
        .where(and(eq(schema.chat.workspaceId, workspaceId), isNull(schema.chat.archivedAt)))
        .all();
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
      const rows = db
        .select()
        .from(schema.chat)
        .where(and(eq(schema.chat.workspaceId, workspaceId), isNotNull(schema.chat.archivedAt)))
        .all();
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
      const row = db.select().from(schema.chat).where(eq(schema.chat.id, chatId)).get();
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
      const row = db
        .update(schema.chat)
        .set({ title })
        .where(eq(schema.chat.id, chatId))
        .returning()
        .get();
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
      const row = db
        .update(schema.chat)
        .set({ archivedAt: archived ? new Date() : null })
        .where(eq(schema.chat.id, chatId))
        .returning()
        .get();
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
      db.delete(schema.chat).where(eq(schema.chat.id, chatId)).run();
    },

    async updateChatAgent(chatId, agentId) {
      const row = db
        .update(schema.chat)
        .set({ agentId })
        .where(eq(schema.chat.id, chatId))
        .returning()
        .get();
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
      const row = db
        .insert(schema.message)
        .values({ id: randomUUID(), chatId, role, content, createdAt: new Date() })
        .returning()
        .get();
      return {
        id: row.id,
        chatId: row.chatId,
        role: row.role,
        content: row.content,
        createdAt: row.createdAt,
      };
    },

    async listMessages(chatId) {
      const rows = db.select().from(schema.message).where(eq(schema.message.chatId, chatId)).all();
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
      const row = db
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
          createdAt: new Date(),
        })
        .returning()
        .get();
      return row;
    },

    async listAgentsByWorkspace(workspaceId) {
      return db.select().from(schema.agent).where(eq(schema.agent.workspaceId, workspaceId)).all();
    },

    async getAgent(agentId) {
      const row = db.select().from(schema.agent).where(eq(schema.agent.id, agentId)).get();
      return row ?? null;
    },

    async createMcpServer({ workspaceId, name, transport, command, args, url }) {
      const row = db
        .insert(schema.mcpServer)
        .values({
          id: randomUUID(),
          workspaceId,
          name,
          transport,
          command: command ?? null,
          args: args ?? null,
          url: url ?? null,
          createdAt: new Date(),
        })
        .returning()
        .get();
      return row;
    },

    async listMcpServersByWorkspace(workspaceId) {
      return db
        .select()
        .from(schema.mcpServer)
        .where(eq(schema.mcpServer.workspaceId, workspaceId))
        .all();
    },

    async getMcpServer(id) {
      const row = db.select().from(schema.mcpServer).where(eq(schema.mcpServer.id, id)).get();
      return row ?? null;
    },

    async deleteMcpServer(id) {
      db.delete(schema.mcpServer).where(eq(schema.mcpServer.id, id)).run();
    },

    async getKnowledgeBaseConfig(workspaceId) {
      const row = db
        .select()
        .from(schema.knowledgeBaseConfig)
        .where(eq(schema.knowledgeBaseConfig.workspaceId, workspaceId))
        .get();
      return row ?? null;
    },

    async listKnowledgeBaseConfigs() {
      return db.select().from(schema.knowledgeBaseConfig).all();
    },

    async upsertKnowledgeBaseConfig({
      workspaceId,
      vaultPath,
      obsidianRestUrl,
      obsidianApiKey,
      docsAgentEnabled,
      injectIntoPrompts,
    }) {
      const now = new Date();
      const existing = db
        .select()
        .from(schema.knowledgeBaseConfig)
        .where(eq(schema.knowledgeBaseConfig.workspaceId, workspaceId))
        .get();
      if (existing) {
        const row = db
          .update(schema.knowledgeBaseConfig)
          .set({
            vaultPath,
            obsidianRestUrl: obsidianRestUrl ?? null,
            obsidianApiKey: obsidianApiKey ?? null,
            docsAgentEnabled: docsAgentEnabled ?? existing.docsAgentEnabled,
            injectIntoPrompts: injectIntoPrompts ?? existing.injectIntoPrompts,
            updatedAt: now,
          })
          .where(eq(schema.knowledgeBaseConfig.workspaceId, workspaceId))
          .returning()
          .get();
        if (!row) throw new Error(`Knowledge base config not found: ${workspaceId}`);
        return row;
      }

      const row = db
        .insert(schema.knowledgeBaseConfig)
        .values({
          workspaceId,
          vaultPath,
          obsidianRestUrl: obsidianRestUrl ?? null,
          obsidianApiKey: obsidianApiKey ?? null,
          docsAgentEnabled: docsAgentEnabled ?? true,
          injectIntoPrompts: injectIntoPrompts ?? true,
          updatedAt: now,
        })
        .returning()
        .get();
      return row;
    },

    async updateKnowledgeBaseSyncStatus({ workspaceId, lastDocsSyncAt, lastDocsSyncError }) {
      const row = db
        .update(schema.knowledgeBaseConfig)
        .set({
          lastDocsSyncAt,
          lastDocsSyncError: lastDocsSyncError ?? null,
          updatedAt: new Date(),
        })
        .where(eq(schema.knowledgeBaseConfig.workspaceId, workspaceId))
        .returning()
        .get();
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
      const row = db
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
          createdAt: new Date(),
        })
        .returning()
        .get();
      return row;
    },

    async listAutomationsByWorkspace(workspaceId) {
      return db
        .select()
        .from(schema.automation)
        .where(eq(schema.automation.workspaceId, workspaceId))
        .all();
    },

    async listDueAutomations(now) {
      return db
        .select()
        .from(schema.automation)
        .where(and(eq(schema.automation.enabled, true), lte(schema.automation.nextRunAt, now)))
        .all();
    },

    async listFileWatchAutomations() {
      return db
        .select()
        .from(schema.automation)
        .where(
          and(
            eq(schema.automation.enabled, true),
            eq(schema.automation.triggerType, "file_watch"),
          ),
        )
        .all();
    },

    async getAutomation(id) {
      const row = db.select().from(schema.automation).where(eq(schema.automation.id, id)).get();
      return row ?? null;
    },

    async updateAutomationRun({ id, lastRunAt, nextRunAt }) {
      const row = db
        .update(schema.automation)
        .set({ lastRunAt, nextRunAt })
        .where(eq(schema.automation.id, id))
        .returning()
        .get();
      if (!row) throw new Error(`Automation not found: ${id}`);
      return row;
    },

    async setAutomationNextRun(id, nextRunAt) {
      const row = db
        .update(schema.automation)
        .set({ nextRunAt })
        .where(eq(schema.automation.id, id))
        .returning()
        .get();
      if (!row) throw new Error(`Automation not found: ${id}`);
      return row;
    },

    async setAutomationEnabled(id, enabled) {
      const row = db
        .update(schema.automation)
        .set({ enabled })
        .where(eq(schema.automation.id, id))
        .returning()
        .get();
      if (!row) throw new Error(`Automation not found: ${id}`);
      return row;
    },

    async setAutomationWatchCheckedAt(id, lastWatchCheckAt) {
      const row = db
        .update(schema.automation)
        .set({ lastWatchCheckAt })
        .where(eq(schema.automation.id, id))
        .returning()
        .get();
      if (!row) throw new Error(`Automation not found: ${id}`);
      return row;
    },

    async deleteAutomation(id) {
      db.delete(schema.automation).where(eq(schema.automation.id, id)).run();
    },

    async createSkill({ workspaceId, name, description, kind, config, sensitive, enabled }) {
      const row = db
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
          createdAt: new Date(),
        })
        .returning()
        .get();
      return row;
    },

    async listSkillsByWorkspace(workspaceId) {
      return db.select().from(schema.skill).where(eq(schema.skill.workspaceId, workspaceId)).all();
    },

    async getSkill(id) {
      const row = db.select().from(schema.skill).where(eq(schema.skill.id, id)).get();
      return row ?? null;
    },

    async setSkillEnabled(id, enabled) {
      const row = db
        .update(schema.skill)
        .set({ enabled })
        .where(eq(schema.skill.id, id))
        .returning()
        .get();
      if (!row) throw new Error(`Skill not found: ${id}`);
      return row;
    },

    async deleteSkill(id) {
      db.delete(schema.skill).where(eq(schema.skill.id, id)).run();
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
      const row = db
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
          createdAt: new Date(),
        })
        .returning()
        .get();
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
        .orderBy(desc(schema.approvalRequest.createdAt))
        .all();
    },

    async getApprovalRequest(id) {
      const row = db
        .select()
        .from(schema.approvalRequest)
        .where(eq(schema.approvalRequest.id, id))
        .get();
      return row ?? null;
    },

    async resolveApprovalRequest({ id, status, resultOutput, errorMessage }) {
      const row = db
        .update(schema.approvalRequest)
        .set({ status, resultOutput, errorMessage: errorMessage ?? null, resolvedAt: new Date() })
        .where(eq(schema.approvalRequest.id, id))
        .returning()
        .get();
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
      const row = db
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
          createdAt: new Date(),
        })
        .returning()
        .get();
      return row;
    },

    async listAuditLogByWorkspace(workspaceId, limit = 100) {
      return db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.workspaceId, workspaceId))
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(limit)
        .all();
    },
  };
}
