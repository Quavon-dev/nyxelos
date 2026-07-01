import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
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
      const rows = db.select().from(schema.workspace).where(eq(schema.workspace.userId, userId)).all();
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        customInstructions: r.customInstructions,
      }));
    },

    async createChat({ workspaceId, title, modelId }) {
      const row = db
        .insert(schema.chat)
        .values({ id: randomUUID(), workspaceId, title, modelId, createdAt: new Date() })
        .returning()
        .get();
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        title: row.title,
        modelId: row.modelId,
        createdAt: row.createdAt,
      };
    },

    async listChatsByWorkspace(workspaceId) {
      const rows = db.select().from(schema.chat).where(eq(schema.chat.workspaceId, workspaceId)).all();
      return rows.map((r) => ({
        id: r.id,
        workspaceId: r.workspaceId,
        title: r.title,
        modelId: r.modelId,
        createdAt: r.createdAt,
      }));
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
  };
}
