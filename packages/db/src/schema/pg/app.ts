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
export const installationMode = pgEnum("installation_mode", ["pc", "server"]);
export const modelProviderKind = pgEnum("model_provider_kind", [
  "anthropic",
  "openai",
  "openai_compatible",
]);

/** See ADR-0009: pending approvals are resolved out-of-band, not by pausing
 * the model's tool-calling loop mid-stream. */
export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "rejected"]);

export const approvalKind = pgEnum("approval_kind", ["skill", "mcp"]);

/** Who/what caused a logged action. See ARCHITECTURE.md section 5 ("Every
 * action by every agent is logged in the audit log"). */
export const auditActor = pgEnum("audit_actor", ["chat", "automation", "approval", "delegate"]);

export const auditStatus = pgEnum("audit_status", [
  "success",
  "error",
  "pending_approval",
  "rejected",
]);

/** See ../sqlite/app.ts and packages/skills-sdk — DB-backed skills built from
 * a declarative `kind` + JSON `config` instead of hand-written TypeScript, so
 * the "Skills" tab can create them at runtime. */
export const skillKind = pgEnum("skill_kind", [
  "http_fetch",
  "file_read",
  "file_write",
  "file_list",
  "kb_search",
  "custom_code",
]);

export const automationTriggerType = pgEnum("automation_trigger_type", ["cron", "file_watch"]);

/** A workspace is the top-level category a user sorts chats, agents, and
 * automations into (e.g. "Work", "Personal"). See ARCHITECTURE.md section 5. */
export const installation = pgTable("installation", {
  id: text("id").primaryKey(),
  mode: installationMode("mode").notNull(),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  primaryWorkspaceId: text("primary_workspace_id").notNull(),
  appUrl: text("app_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workspace = pgTable("workspace", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  customInstructions: text("custom_instructions"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const modelInstallation = pgTable("model_installation", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  providerKind: modelProviderKind("provider_kind").notNull(),
  baseUrl: text("base_url").notNull(),
  apiKey: text("api_key"),
  modelIds: jsonb("model_ids").notNull().default([]).$type<string[]>(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
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
  // Optional per-tool allow-list, entries shaped "serverId::toolName". Null
  // (the default) means "every tool from every server in mcpServerIds" —
  // this only narrows that set, it never grants access beyond it.
  mcpToolFilter: jsonb("mcp_tool_filter").$type<string[] | null>(),
  // Only meaningful for autonomyLevel "super_agent" — the whitelist of other
  // agent ids this agent may delegate subtasks to. See ADR-0011.
  delegateAgentIds: jsonb("delegate_agent_ids").notNull().default([]).$type<string[]>(),
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

export const knowledgeBaseConfig = pgTable("knowledge_base_config", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .references(() => workspace.id, { onDelete: "cascade" }),
  vaultPath: text("vault_path").notNull().default("knowledge-base"),
  obsidianRestUrl: text("obsidian_rest_url"),
  obsidianApiKey: text("obsidian_api_key"),
  docsAgentEnabled: boolean("docs_agent_enabled").notNull().default(true),
  // Whether getKnowledgeBaseContextForPrompt() output is appended to every
  // chat/automation system prompt for this workspace. Default on. See
  // apps/server/src/knowledge-base.ts.
  injectIntoPrompts: boolean("inject_into_prompts").notNull().default(true),
  lastDocsSyncAt: timestamp("last_docs_sync_at"),
  lastDocsSyncError: text("last_docs_sync_error"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** A user-defined skill, built from a declarative `kind` instead of
 * hand-written TypeScript. Complements (does not replace) the process-wide
 * hardcoded skills in apps/server/src/skills-registry.ts — both are merged
 * at tool-build time. See ADR-0013. */
export const skill = pgTable("skill", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  kind: skillKind("kind").notNull(),
  // Shape depends on `kind` — see apps/server/src/skills-dynamic.ts.
  config: jsonb("config").notNull().default({}).$type<Record<string, unknown>>(),
  sensitive: boolean("sensitive").notNull().default(true),
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
  archivedAt: timestamp("archived_at"),
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

/** A scheduled, unattended run of an "autonomous"/"super_agent" agent. See
 * ADR-0010 — a DB-backed cron poll rather than a queue, matching the
 * project's PC-mode-first constraint (no Redis requirement). */
export const automation = pgTable("automation", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  agentId: text("agent_id")
    .notNull()
    .references(() => agent.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // "cron" (default, existing behavior) or "file_watch". See ADR-0013.
  triggerType: automationTriggerType("trigger_type").notNull().default("cron"),
  // Required when triggerType is "cron"; empty string when "file_watch".
  cronExpression: text("cron_expression").notNull().default(""),
  // Only meaningful when triggerType is "file_watch" — an absolute or
  // repo-relative directory to poll, and an optional suffix filter (e.g.
  // ".md") applied to changed file names.
  watchPath: text("watch_path"),
  watchGlob: text("watch_glob"),
  lastWatchCheckAt: timestamp("last_watch_check_at"),
  // The instruction sent as the "user" turn on every scheduled run — the
  // agent's systemPrompt stays its persona, this is "what to do right now".
  prompt: text("prompt").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** A tool call deferred for human approval instead of executed immediately.
 * See ADR-0009 for why this is a defer-and-resolve record rather than a
 * paused model generation. */
export const approvalRequest = pgTable("approval_request", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  agentId: text("agent_id")
    .notNull()
    .references(() => agent.id, { onDelete: "cascade" }),
  chatId: text("chat_id").references(() => chat.id, { onDelete: "set null" }),
  automationId: text("automation_id").references(() => automation.id, { onDelete: "set null" }),
  kind: approvalKind("kind").notNull(),
  skillId: text("skill_id"),
  mcpServerId: text("mcp_server_id"),
  mcpToolName: text("mcp_tool_name"),
  toolLabel: text("tool_label").notNull(),
  input: jsonb("input").notNull().$type<Record<string, unknown>>(),
  status: approvalStatus("status").notNull().default("pending"),
  resultOutput: jsonb("result_output").$type<unknown>(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

/** Immutable record of every tool/agent action taken, satisfying the "every
 * action by every agent is logged" requirement (ARCHITECTURE.md section 5). */
export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  agentId: text("agent_id").references(() => agent.id, { onDelete: "set null" }),
  chatId: text("chat_id").references(() => chat.id, { onDelete: "set null" }),
  automationId: text("automation_id").references(() => automation.id, { onDelete: "set null" }),
  actor: auditActor("actor").notNull(),
  toolLabel: text("tool_label").notNull(),
  input: jsonb("input").$type<unknown>(),
  output: jsonb("output").$type<unknown>(),
  status: auditStatus("status").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
