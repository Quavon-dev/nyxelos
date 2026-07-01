import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema/sqlite";
import type { DbRepository } from "./types";

export function createSqliteRepository(filePath: string): DbRepository {
  const sqlite = new Database(filePath, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
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
        createdAt: row.createdAt,
      };
    },

    async listChatsByWorkspace(workspaceId) {
      const rows = db
        .select()
        .from(schema.chat)
        .where(eq(schema.chat.workspaceId, workspaceId))
        .all();
      return rows.map((r) => ({
        id: r.id,
        workspaceId: r.workspaceId,
        agentId: r.agentId,
        title: r.title,
        modelId: r.modelId,
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
  };
}
