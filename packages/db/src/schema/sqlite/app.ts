import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";

export type MessageRole = "user" | "assistant" | "system" | "tool";

/** See ../pg/app.ts — Phase 2 implements "autonomous"/"super_agent" behavior. */
export type AgentAutonomyLevel = "chat" | "assisted" | "autonomous" | "super_agent";

export type McpTransport = "stdio" | "http";

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

export const agent = sqliteTable("agent", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  systemPrompt: text("system_prompt"),
  modelId: text("model_id").notNull(),
  autonomyLevel: text("autonomy_level").notNull().default("chat").$type<AgentAutonomyLevel>(),
  skillIds: text("skill_ids", { mode: "json" }).notNull().default([]).$type<string[]>(),
  mcpServerIds: text("mcp_server_ids", { mode: "json" }).notNull().default([]).$type<string[]>(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const mcpServer = sqliteTable("mcp_server", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  transport: text("transport").notNull().$type<McpTransport>(),
  command: text("command"),
  args: text("args", { mode: "json" }).$type<string[]>(),
  url: text("url"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const chat = sqliteTable("chat", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  agentId: text("agent_id").references(() => agent.id, { onDelete: "set null" }),
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
