import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";

export type MessageRole = "user" | "assistant" | "system" | "tool";

/** See ../pg/app.ts — Phase 2 implements "autonomous"/"super_agent" behavior. */
export type AgentAutonomyLevel = "chat" | "assisted" | "autonomous" | "super_agent";
export type InstallationMode = "pc" | "server";
export type ModelProviderKind = "anthropic" | "openai" | "openai_compatible";

export type McpTransport = "stdio" | "http";

export type ApprovalStatus = "pending" | "approved" | "rejected";
export type ApprovalKind = "skill" | "mcp";
export type AuditActor = "chat" | "automation" | "approval" | "delegate";
export type AuditStatus = "success" | "error" | "pending_approval" | "rejected";
export type ChatToolMode = "default" | "automatic" | "auto";

export type ChatToolPolicy = {
  mode: ChatToolMode;
  approveFileWrites: boolean;
  approveFileDeletes: boolean;
  approveCustomCode: boolean;
  approveMcpTools: boolean;
};

/** See ../pg/app.ts and packages/skills-sdk — DB-backed skills built from a
 * declarative `kind` + JSON `config` instead of hand-written TypeScript, so
 * the "Skills" tab can create them at runtime. */
export type SkillKind =
  | "http_fetch"
  | "file_read"
  | "file_write"
  | "file_list"
  | "file_delete"
  | "kb_search"
  | "custom_code";

export type AutomationTriggerType = "cron" | "file_watch";

/** Mirrors ../pg/app.ts. See ARCHITECTURE.md section 5 for the domain model. */
export const installation = sqliteTable("installation", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull().$type<InstallationMode>(),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  primaryWorkspaceId: text("primary_workspace_id").notNull(),
  appUrl: text("app_url"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const workspace = sqliteTable("workspace", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  customInstructions: text("custom_instructions"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const modelInstallation = sqliteTable("model_installation", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  providerKind: text("provider_kind").notNull().$type<ModelProviderKind>(),
  baseUrl: text("base_url").notNull(),
  apiKey: text("api_key"),
  modelIds: text("model_ids", { mode: "json" }).notNull().default([]).$type<string[]>(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
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
  // Optional per-tool allow-list, entries shaped "serverId::toolName". Null
  // (the default) means "every tool from every server in mcpServerIds" —
  // this only narrows that set, it never grants access beyond it.
  mcpToolFilter: text("mcp_tool_filter", { mode: "json" }).$type<string[] | null>(),
  delegateAgentIds: text("delegate_agent_ids", { mode: "json" })
    .notNull()
    .default([])
    .$type<string[]>(),
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

export const knowledgeBaseConfig = sqliteTable("knowledge_base_config", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .references(() => workspace.id, { onDelete: "cascade" }),
  vaultPath: text("vault_path").notNull().default("knowledge-base"),
  obsidianRestUrl: text("obsidian_rest_url"),
  obsidianApiKey: text("obsidian_api_key"),
  docsAgentEnabled: integer("docs_agent_enabled", { mode: "boolean" }).notNull().default(true),
  // Whether getKnowledgeBaseContextForPrompt() output is appended to every
  // chat/automation system prompt for this workspace. Default on — the goal
  // is that the model always has the living knowledge base, not just on
  // request. See apps/server/src/knowledge-base.ts.
  injectIntoPrompts: integer("inject_into_prompts", { mode: "boolean" }).notNull().default(true),
  lastDocsSyncAt: integer("last_docs_sync_at", { mode: "timestamp" }),
  lastDocsSyncError: text("last_docs_sync_error"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/** A user-defined skill, built from a declarative `kind` instead of
 * hand-written TypeScript. Complements (does not replace) the process-wide
 * hardcoded skills in apps/server/src/skills-registry.ts — both are merged
 * at tool-build time. See ADR-0013. */
export const skill = sqliteTable("skill", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  kind: text("kind").notNull().$type<SkillKind>(),
  // Shape depends on `kind` — see apps/server/src/skills-dynamic.ts:
  // http_fetch: { allowedHosts: string[] }
  // file_read / file_list: { allowedDirs: string[] }
  // file_write: { allowedDirs: string[] }
  // kb_search: {}
  // custom_code: { allowedHosts: string[], allowedDirs: string[], code: string }
  config: text("config", { mode: "json" }).notNull().default({}).$type<Record<string, unknown>>(),
  sensitive: integer("sensitive", { mode: "boolean" }).notNull().default(true),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

/** Mirrors ../pg/app.ts — see there for the "why" behind projectId being
 * nullable on chat instead of projects owning a list of chats. */
export const project = sqliteTable("project", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const chat = sqliteTable("chat", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  agentId: text("agent_id").references(() => agent.id, { onDelete: "set null" }),
  projectId: text("project_id").references(() => project.id, { onDelete: "set null" }),
  title: text("title").notNull().default("New chat"),
  modelId: text("model_id").notNull(),
  archivedAt: integer("archived_at", { mode: "timestamp" }),
  pinnedAt: integer("pinned_at", { mode: "timestamp" }),
  shareId: text("share_id").unique(),
  sharedAt: integer("shared_at", { mode: "timestamp" }),
  toolMode: text("tool_mode").notNull().default("default").$type<ChatToolMode>(),
  toolPolicy: text("tool_policy", { mode: "json" })
    .notNull()
    .default({
      mode: "default",
      approveFileWrites: true,
      approveFileDeletes: true,
      approveCustomCode: true,
      approveMcpTools: true,
    })
    .$type<ChatToolPolicy>(),
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

export const automation = sqliteTable("automation", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  agentId: text("agent_id")
    .notNull()
    .references(() => agent.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // "cron" (default, existing behavior) or "file_watch". See ADR-0013.
  triggerType: text("trigger_type").notNull().default("cron").$type<AutomationTriggerType>(),
  // Required when triggerType is "cron"; empty string when "file_watch".
  cronExpression: text("cron_expression").notNull().default(""),
  // Only meaningful when triggerType is "file_watch" — an absolute or
  // repo-relative directory to poll, and an optional glob-ish suffix filter
  // (e.g. ".md") applied to changed file names.
  watchPath: text("watch_path"),
  watchGlob: text("watch_glob"),
  lastWatchCheckAt: integer("last_watch_check_at", { mode: "timestamp" }),
  prompt: text("prompt").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastRunAt: integer("last_run_at", { mode: "timestamp" }),
  nextRunAt: integer("next_run_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const approvalRequest = sqliteTable("approval_request", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  agentId: text("agent_id")
    .notNull()
    .references(() => agent.id, { onDelete: "cascade" }),
  chatId: text("chat_id").references(() => chat.id, { onDelete: "set null" }),
  automationId: text("automation_id").references(() => automation.id, { onDelete: "set null" }),
  kind: text("kind").notNull().$type<ApprovalKind>(),
  skillId: text("skill_id"),
  mcpServerId: text("mcp_server_id"),
  mcpToolName: text("mcp_tool_name"),
  toolLabel: text("tool_label").notNull(),
  input: text("input", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
  status: text("status").notNull().default("pending").$type<ApprovalStatus>(),
  resultOutput: text("result_output", { mode: "json" }).$type<unknown>(),
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
});

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  agentId: text("agent_id").references(() => agent.id, { onDelete: "set null" }),
  chatId: text("chat_id").references(() => chat.id, { onDelete: "set null" }),
  automationId: text("automation_id").references(() => automation.id, { onDelete: "set null" }),
  actor: text("actor").notNull().$type<AuditActor>(),
  toolLabel: text("tool_label").notNull(),
  input: text("input", { mode: "json" }).$type<unknown>(),
  output: text("output", { mode: "json" }).$type<unknown>(),
  status: text("status").notNull().$type<AuditStatus>(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
