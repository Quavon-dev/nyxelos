import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
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

    async createChat({ workspaceId, title, modelId }) {
      const [row] = await db
        .insert(schema.chat)
        .values({ id: randomUUID(), workspaceId, title, modelId })
        .returning();
      if (!row) throw new Error("Failed to create chat");
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        title: row.title,
        modelId: row.modelId,
        createdAt: row.createdAt,
      };
    },

    async listChatsByWorkspace(workspaceId) {
      const rows = await db
        .select()
        .from(schema.chat)
        .where(eq(schema.chat.workspaceId, workspaceId));
      return rows.map((r) => ({
        id: r.id,
        workspaceId: r.workspaceId,
        title: r.title,
        modelId: r.modelId,
        createdAt: r.createdAt,
      }));
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
      const rows = await db
        .select()
        .from(schema.message)
        .where(eq(schema.message.chatId, chatId));
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
