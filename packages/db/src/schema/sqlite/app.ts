import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";

export type MessageRole = "user" | "assistant" | "system" | "tool";

/** Mirrors ../pg/app.ts. See ARCHITECTURE.md section 5 for the domain model. */
export const workspace = sqliteTable("workspace", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  customInstructions: text("custom_instructions"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const chat = sqliteTable("chat", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New chat"),
  modelId: text("model_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const message = sqliteTable("message", {
  id: text("id").primaryKey(),
  chatId: text("chat_id")
    .notNull()
    .references(() => chat.id, { onDelete: "cascade" }),
  role: text("role").notNull().$type<MessageRole>(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
