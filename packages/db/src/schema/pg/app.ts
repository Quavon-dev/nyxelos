import { pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const messageRole = pgEnum("message_role", ["user", "assistant", "system", "tool"]);

/** A workspace is the top-level category a user sorts chats, agents, and
 * automations into (e.g. "Work", "Personal"). See ARCHITECTURE.md section 5. */
export const workspace = pgTable("workspace", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  customInstructions: text("custom_instructions"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const chat = pgTable("chat", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New chat"),
  modelId: text("model_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const message = pgTable("message", {
  id: text("id").primaryKey(),
  chatId: text("chat_id")
    .notNull()
    .references(() => chat.id, { onDelete: "cascade" }),
  role: messageRole("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
