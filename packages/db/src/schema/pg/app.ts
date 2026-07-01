import { boolean, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const messageRole = pgEnum("message_role", ["user", "assistant", "system", "tool"]);

/** See ARCHITECTURE.md section 6 — "Chat" only responds on request, "Assisted"
 * may call tools but needs confirmation for sensitive actions, "Autonomous"
 * and "Super-agent" (background scheduling / delegation) land in Phase 2. */
export const agentAutonomyLevel = pgEnum("agent_autonomy_level", [
  "chat",
  "assisted",
  "autonomous",
  "super_agent",
]);

export const mcpTransport = pgEnum("mcp_transport", ["stdio", "http"]);

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

/** A saved agent configuration: system prompt, model, and which skills/MCP
 * servers it may call. See ARCHITECTURE.md sections 5-6. */
export const agent = pgTable("agent", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  systemPrompt: text("system_prompt"),
  modelId: text("model_id").notNull(),
  autonomyLevel: agentAutonomyLevel("autonomy_level").notNull().default("chat"),
  skillIds: jsonb("skill_ids").notNull().default([]).$type<string[]>(),
  mcpServerIds: jsonb("mcp_server_ids").notNull().default([]).$type<string[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** A configured MCP server connection, scoped to a workspace. See
 * ARCHITECTURE.md section 8 and packages/mcp-client. */
export const mcpServer = pgTable("mcp_server", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  transport: mcpTransport("transport").notNull(),
  command: text("command"),
  args: jsonb("args").$type<string[]>(),
  url: text("url"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const chat = pgTable("chat", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  agentId: text("agent_id").references(() => agent.id, { onDelete: "set null" }),
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
