import {
	boolean,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const messageRole = pgEnum("message_role", [
	"user",
	"assistant",
	"system",
	"tool",
]);

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
	"claude_cli",
	"codex_cli",
]);

/** See ADR-0009: pending approvals are resolved out-of-band, not by pausing
 * the model's tool-calling loop mid-stream. */
export const approvalStatus = pgEnum("approval_status", [
	"pending",
	"approved",
	"rejected",
]);

export const approvalKind = pgEnum("approval_kind", ["skill", "tool", "mcp"]);
export const chatToolMode = pgEnum("chat_tool_mode", [
	"default",
	"automatic",
	"auto",
]);

/** Who/what caused a logged action. See ARCHITECTURE.md section 5 ("Every
 * action by every agent is logged in the audit log"). */
export const auditActor = pgEnum("audit_actor", [
	"chat",
	"automation",
	"approval",
	"delegate",
]);

export const auditStatus = pgEnum("audit_status", [
	"success",
	"error",
	"pending_approval",
	"rejected",
]);
export const taskStatus = pgEnum("task_status", [
	"pending",
	"planning",
	"ready",
	"running",
	"blocked",
	"waiting_approval",
	"completed",
	"failed",
	"cancelled",
]);
export const taskPriority = pgEnum("task_priority", [
	"low",
	"normal",
	"high",
	"urgent",
]);
export const taskEventKind = pgEnum("task_event_kind", [
	"created",
	"planned",
	"status_changed",
	"assigned",
	"delegated",
	"tool_called",
	"approval_waiting",
	"approval_resolved",
	"run_started",
	"run_finished",
	"comment",
	"question",
	"question_answered",
	"completed",
	"failed",
]);
export const agentRunTrigger = pgEnum("agent_run_trigger", [
	"chat",
	"task",
	"automation",
	"delegate",
]);
export const agentRunStatus = pgEnum("agent_run_status", [
	"pending",
	"running",
	"waiting_approval",
	"completed",
	"failed",
	"cancelled",
]);

export const automationTriggerType = pgEnum("automation_trigger_type", [
	"cron",
	"file_watch",
]);

export const automationRunStatus = pgEnum("automation_run_status", [
	"success",
	"error",
	"pending_approval",
]);

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
	// Prepended to every agent/chat system prompt in this workspace — see
	// apps/server/src/workspace-prompt.ts, the single place this is read from.
	customInstructions: text("custom_instructions"),
	icon: text("icon"),
	color: text("color"),
	defaultModelId: text("default_model_id"),
	defaultAutonomyLevel: agentAutonomyLevel("default_autonomy_level")
		.notNull()
		.default("assisted"),
	// Applied to every new chat created in this workspace — see
	// resolveChatToolPolicy in apps/server/src/trpc/router.ts. Null means "use
	// the global DEFAULT_CHAT_TOOL_POLICY".
	defaultToolPolicy: jsonb("default_tool_policy").$type<{
		mode: "default" | "automatic" | "auto";
		approveFileWrites: boolean;
		approveFileDeletes: boolean;
		approveCustomCode: boolean;
		approveMcpTools: boolean;
	}>(),
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

/** A saved agent configuration: system prompt, model, and which runtime
 * skills, workspace tools, and MCP servers it may call. See ARCHITECTURE.md
 * sections 5-6. */
export const agent = pgTable("agent", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	systemPrompt: text("system_prompt"),
	role: text("role"),
	goalTemplate: text("goal_template"),
	modelId: text("model_id").notNull(),
	autonomyLevel: agentAutonomyLevel("autonomy_level").notNull().default("chat"),
	mcpServerIds: jsonb("mcp_server_ids").notNull().default([]).$type<string[]>(),
	toolIds: jsonb("tool_ids").notNull().default([]).$type<string[]>(),
	skillIds: jsonb("skill_ids").notNull().default([]).$type<string[]>(),
	// Optional per-tool allow-list, entries shaped "serverId::toolName". Null
	// (the default) means "every tool from every server in mcpServerIds" —
	// this only narrows that set, it never grants access beyond it.
	mcpToolFilter: jsonb("mcp_tool_filter").$type<string[] | null>(),
	// Only meaningful for autonomyLevel "super_agent" — the whitelist of other
	// agent ids this agent may delegate subtasks to. See ADR-0011.
	delegateAgentIds: jsonb("delegate_agent_ids")
		.notNull()
		.default([])
		.$type<string[]>(),
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

/** See ../sqlite/app.ts — kept as plain text (not a pg enum) rather than an
 * enum column: adding one of Nyxel's ~30 built-in tool kinds would otherwise
 * need a dedicated `ALTER TYPE ... ADD VALUE` migration each time, which
 * Postgres restricts inside transactions. Validated by the router's Zod
 * schema instead of the DB. */
export type ToolKind =
	| "http_fetch"
	| "file_read"
	| "file_write"
	| "file_list"
	| "file_delete"
	| "kb_search"
	| "custom_code"
	| "file_create"
	| "file_patch"
	| "file_move"
	| "directory_create"
	| "notebook_edit"
	| "file_stat"
	| "file_view_image"
	| "notebook_summary"
	| "notebook_cell_output"
	| "terminal_last_command"
	| "terminal_output"
	| "problems"
	| "file_search"
	| "text_search"
	| "usages"
	| "codebase_search"
	| "changes"
	| "terminal_run"
	| "terminal_send_input"
	| "terminal_kill"
	| "task_run"
	| "test_run"
	| "browser_navigate"
	| "browser_click"
	| "browser_drag"
	| "browser_hover"
	| "browser_type"
	| "browser_handle_dialog"
	| "browser_screenshot"
	| "browser_read_page"
	| "browser_run_playwright_code"
	| "github_repo_fetch"
	| "github_code_search";

/** A user-defined tool, built from a declarative `kind` instead of
 * hand-written TypeScript. Complements the process-wide hardcoded skills in
 * apps/server/src/skills-registry.ts — both are merged at tool-build time,
 * but they remain separate concepts. */
export const tool = pgTable("tool", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	description: text("description").notNull(),
	kind: text("kind").notNull().$type<ToolKind>(),
	// Shape depends on `kind` — see apps/server/src/tools-dynamic.ts and
	// apps/server/src/tools-builtin/*.
	config: jsonb("config")
		.notNull()
		.default({})
		.$type<Record<string, unknown>>(),
	sensitive: boolean("sensitive").notNull().default(true),
	enabled: boolean("enabled").notNull().default(true),
	// Seeded per workspace (apps/server/src/tools-builtin-seed.ts), can be
	// disabled but not deleted — see deleteTool()'s guard in both repos.
	builtin: boolean("builtin").notNull().default(false),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** A user-defined folder for organizing chats within a workspace — the
 * "Projekte" section in the chat sidebar. Chats point at a project via
 * chat.projectId (nullable, "set null" on delete) rather than projects
 * owning a chat list, so removing a project never deletes its chats. */
export const project = pgTable("project", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	// Sidebar/detail-page appearance — a fixed token name (see
	// PROJECT_COLORS/PROJECT_ICONS on the web client), not a raw hex/svg, so
	// the palette can be restyled without touching stored data.
	color: text("color").notNull().default("gray"),
	icon: text("icon").notNull().default("folder"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const chat = pgTable("chat", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	workingDirectory: text("working_directory"),
	agentId: text("agent_id").references(() => agent.id, {
		onDelete: "set null",
	}),
	projectId: text("project_id").references(() => project.id, {
		onDelete: "set null",
	}),
	title: text("title").notNull().default("New chat"),
	modelId: text("model_id").notNull(),
	archivedAt: timestamp("archived_at"),
	// Non-null once the chat has been pinned to the top of the sidebar list.
	pinnedAt: timestamp("pinned_at"),
	// Non-null public share token — a chat with a shareId is viewable
	// read-only at /share/{shareId} without auth. See apps/server's
	// chats.share/unshare and chats.getShared.
	shareId: text("share_id").unique(),
	sharedAt: timestamp("shared_at"),
	toolMode: chatToolMode("tool_mode").notNull().default("default"),
	toolPolicy: jsonb("tool_policy")
		.notNull()
		.default({
			mode: "default",
			approveFileWrites: true,
			approveFileDeletes: true,
			approveCustomCode: true,
			approveMcpTools: true,
		})
		.$type<{
			mode: "default" | "automatic" | "auto";
			approveFileWrites: boolean;
			approveFileDeletes: boolean;
			approveCustomCode: boolean;
			approveMcpTools: boolean;
		}>(),
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
	// Outcome of the most recent run, surfaced in the automations list so a
	// failing automation doesn't silently keep retrying unnoticed.
	lastRunStatus: automationRunStatus("last_run_status"),
	lastErrorMessage: text("last_error_message"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const task = pgTable("task", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	parentTaskId: text("parent_task_id"),
	sourceChatId: text("source_chat_id").references(() => chat.id, {
		onDelete: "set null",
	}),
	createdByAgentId: text("created_by_agent_id").references(() => agent.id, {
		onDelete: "set null",
	}),
	assignedAgentId: text("assigned_agent_id").references(() => agent.id, {
		onDelete: "set null",
	}),
	title: text("title").notNull(),
	instruction: text("instruction").notNull(),
	// Overrides the assigned agent's default model for this task only — lets
	// the same agent run different tasks on different models without needing
	// a separate agent per model. Null means "use agent.modelId".
	modelId: text("model_id"),
	status: taskStatus("status").notNull().default("pending"),
	priority: taskPriority("priority").notNull().default("normal"),
	requiresApproval: boolean("requires_approval").notNull().default(false),
	input: jsonb("input")
		.notNull()
		.default({})
		.$type<Record<string, unknown>>(),
	plan: jsonb("plan").$type<Record<string, unknown> | null>(),
	handoff: jsonb("handoff").$type<Record<string, unknown> | null>(),
	resultSummary: text("result_summary"),
	errorMessage: text("error_message"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	startedAt: timestamp("started_at"),
	completedAt: timestamp("completed_at"),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const agentRun = pgTable("agent_run", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	taskId: text("task_id").references(() => task.id, { onDelete: "set null" }),
	agentId: text("agent_id")
		.notNull()
		.references(() => agent.id, { onDelete: "cascade" }),
	chatId: text("chat_id").references(() => chat.id, { onDelete: "set null" }),
	automationId: text("automation_id").references(() => automation.id, {
		onDelete: "set null",
	}),
	trigger: agentRunTrigger("trigger").notNull(),
	// The model actually used for this run — may differ from the agent's
	// current default (task override, or the agent's model changed since).
	modelId: text("model_id"),
	stepCount: integer("step_count").notNull().default(0),
	status: agentRunStatus("status").notNull().default("pending"),
	finalOutput: text("final_output"),
	errorMessage: text("error_message"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	startedAt: timestamp("started_at"),
	completedAt: timestamp("completed_at"),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const taskEvent = pgTable("task_event", {
	id: text("id").primaryKey(),
	taskId: text("task_id")
		.notNull()
		.references(() => task.id, { onDelete: "cascade" }),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	agentRunId: text("agent_run_id").references(() => agentRun.id, {
		onDelete: "set null",
	}),
	agentId: text("agent_id").references(() => agent.id, { onDelete: "set null" }),
	kind: taskEventKind("kind").notNull(),
	message: text("message").notNull(),
	payload: jsonb("payload").$type<Record<string, unknown> | null>(),
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
	automationId: text("automation_id").references(() => automation.id, {
		onDelete: "set null",
	}),
	taskId: text("task_id").references(() => task.id, { onDelete: "set null" }),
	agentRunId: text("agent_run_id").references(() => agentRun.id, {
		onDelete: "set null",
	}),
	kind: approvalKind("kind").notNull(),
	skillId: text("skill_id"),
	toolId: text("tool_id"),
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
	agentId: text("agent_id").references(() => agent.id, {
		onDelete: "set null",
	}),
	chatId: text("chat_id").references(() => chat.id, { onDelete: "set null" }),
	automationId: text("automation_id").references(() => automation.id, {
		onDelete: "set null",
	}),
	actor: auditActor("actor").notNull(),
	toolLabel: text("tool_label").notNull(),
	input: jsonb("input").$type<unknown>(),
	output: jsonb("output").$type<unknown>(),
	status: auditStatus("status").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});
