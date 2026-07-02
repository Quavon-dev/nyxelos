import {
	boolean,
	doublePrecision,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
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
	"openrouter",
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
	"extension",
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
	"extension",
]);

export const seoAnalysisRunStatus = pgEnum("seo_analysis_run_status", [
	"running",
	"completed",
	"failed",
]);
export const seoFindingCategory = pgEnum("seo_finding_category", [
	"seo",
	"geo",
	"aeo",
]);
export const seoFindingSeverity = pgEnum("seo_finding_severity", [
	"info",
	"warning",
	"critical",
]);
export const seoBlogPostStatus = pgEnum("seo_blog_post_status", [
	"suggested",
	"generating",
	"written",
	"failed",
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

/** What a scheduled run actually does when it fires — "agent" (existing
 * behavior, runs `prompt` as an agent task) or "workflow" (runs a saved
 * workflow graph to completion, no prompt/agent needed). See
 * ADR-0016-Automation-Workflow-Target. */
export const automationTargetKind = pgEnum("automation_target_kind", [
	"agent",
	"workflow",
]);

/** Broad classification of an uploaded library file, derived from its mime
 * type at upload time — drives which icon/preview the Library page shows,
 * and lets the "Images" / "Documents" filter chips work without parsing
 * mime types on the client. */
export const libraryItemKind = pgEnum("library_item_kind", [
	"image",
	"document",
	"video",
	"other",
]);

export const videoGenerationJobStatus = pgEnum("video_generation_job_status", [
	"queued",
	"in_progress",
	"completed",
	"failed",
]);

export const workflowRunStatus = pgEnum("workflow_run_status", [
	"queued",
	"running",
	"completed",
	"failed",
	"partial",
]);

export const workflowRunNodeStatus = pgEnum("workflow_run_node_status", [
	"queued",
	"running",
	"completed",
	"failed",
	"skipped",
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
	// Subset of modelIds hidden from the model picker without removing them
	// from the installation — lets a user temporarily hide a model without
	// losing it (re-enabling doesn't require re-adding). See models.setModelEnabled.
	disabledModelIds: jsonb("disabled_model_ids").notNull().default([]).$type<string[]>(),
	enabled: boolean("enabled").notNull().default(true),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const modelReasoningEffort = pgEnum("model_reasoning_effort", ["low", "medium", "high"]);

/** Per-(workspace, model) generation overrides — how a specific installed
 * model should behave by default (sampling params, reasoning effort, a
 * model-only instructions addendum). One row per model; deleting it (the
 * "reset" action) just falls back to provider defaults. See ../sqlite/app.ts. */
export const modelParameter = pgTable(
	"model_parameter",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		modelId: text("model_id").notNull(),
		customName: text("custom_name"),
		customInstructions: text("custom_instructions"),
		maxOutputTokens: integer("max_output_tokens"),
		temperature: doublePrecision("temperature"),
		topP: doublePrecision("top_p"),
		frequencyPenalty: doublePrecision("frequency_penalty"),
		presencePenalty: doublePrecision("presence_penalty"),
		stopSequences: jsonb("stop_sequences").notNull().default([]).$type<string[]>(),
		reasoningEffort: modelReasoningEffort("reasoning_effort"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex("model_parameter_workspace_model_idx").on(table.workspaceId, table.modelId),
	],
);

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
	/** Extra env vars for stdio servers only, e.g. a path to an OAuth
	 * credentials file a local command needs to read. Never sent to http
	 * servers — those authenticate via OAuth, not process env. */
	env: jsonb("env").$type<Record<string, string>>(),
	/** Persisted OAuth session for http servers — dynamic client registration
	 * result, access/refresh tokens, PKCE state. Without this, every server
	 * restart drops the in-memory OAuth provider and forces re-authorization
	 * for every previously-connected http connector. Opaque blob because the
	 * shape belongs to @modelcontextprotocol/sdk, not this schema. */
	oauthState: jsonb("oauth_state").$type<Record<string, unknown>>(),
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

/** See ../sqlite/app.ts. */
export interface PluginAgentDefinition {
	slug: string;
	name: string;
	description: string;
	body: string;
}

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
	| "github_code_search"
	| "generate_image"
	| "generate_video"
	| "edit_video"
	| "generate_speech"
	| "transcribe_audio";

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
	// Everything below is null for user/system/tool turns — only populated for
	// assistant turns generated by streamChat() (see chat-stream.ts), which is
	// the only place that has this data available. Powers the detailed
	// statistics dashboard (packages/model-providers has the token pricing
	// table used to derive costMicros).
	modelId: text("model_id"),
	inputTokens: integer("input_tokens"),
	outputTokens: integer("output_tokens"),
	reasoningTokens: integer("reasoning_tokens"),
	cacheReadTokens: integer("cache_read_tokens"),
	totalTokens: integer("total_tokens"),
	// USD cost estimate in millionths (1 = $0.000001) — integer to avoid
	// cross-dialect floating point drift; null when the model's pricing is
	// unknown (e.g. a custom OpenAI-compatible endpoint).
	costMicros: integer("cost_micros"),
	durationMs: integer("duration_ms"),
	// Wall-clock time between the first reasoning-delta and the first
	// text-delta of the same generation — null when the model produced no
	// reasoning trace.
	thinkingMs: integer("thinking_ms"),
	lineCount: integer("line_count"),
	codeLineCount: integer("code_line_count"),
	codeBlockCount: integer("code_block_count"),
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
	// Exactly one of agentId/workflowId is set, matching targetKind — see
	// ADR-0016. Nullable rather than a discriminated pair of tables because
	// every other column (triggerType, schedule fields, enabled, run
	// tracking) is identical between the two targets.
	agentId: text("agent_id").references(() => agent.id, { onDelete: "cascade" }),
	workflowId: text("workflow_id").references(() => workflow.id, { onDelete: "cascade" }),
	targetKind: automationTargetKind("target_kind").notNull().default("agent"),
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
	// Empty for targetKind "workflow" (a workflow graph has no single prompt).
	prompt: text("prompt").notNull().default(""),
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

/** One browser/device Web Push subscription (VAPID) — lets the server push
 * notifications (approval needed, task done, automation failed) to a
 * user's installed PWA even when the tab is closed. */
export const pushSubscription = pgTable("push_subscription", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	endpoint: text("endpoint").notNull().unique(),
	p256dh: text("p256dh").notNull(),
	auth: text("auth").notNull(),
	userAgent: text("user_agent"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** An installed marketplace extension, scoped to a workspace — mirrors
 * mcpServer's "catalog entry + configured instance" split (see
 * apps/server/src/extensions.ts for the catalog). `key` matches a catalog
 * entry; `config` shape depends on the extension (e.g. the SEO analyzer
 * stores nothing here — its own state lives in the seo_* tables keyed by
 * workspaceId, not in this jsonb blob). */
export const extension = pgTable("extension", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	key: text("key").notNull(),
	enabled: boolean("enabled").notNull().default(true),
	config: jsonb("config")
		.notNull()
		.default({})
		.$type<Record<string, unknown>>(),
	installedAt: timestamp("installed_at").notNull().defaultNow(),
});

/** An installed plugin — see ../sqlite/app.ts for the full rationale. A
 * full folder-based bundle (Claude Code plugin format) pulled from a GitHub
 * repo and kept on disk under `installDir` rather than flattened into a
 * single markdown body. */
export const plugin = pgTable("plugin", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	slug: text("slug").notNull(),
	name: text("name").notNull(),
	description: text("description").notNull(),
	version: text("version"),
	author: text("author"),
	homepage: text("homepage"),
	repoUrl: text("repo_url").notNull(),
	manifest: jsonb("manifest")
		.notNull()
		.default({})
		.$type<Record<string, unknown>>(),
	skillSlugs: jsonb("skill_slugs").notNull().default([]).$type<string[]>(),
	agentDefs: jsonb("agent_defs")
		.notNull()
		.default([])
		.$type<PluginAgentDefinition[]>(),
	fileCount: integer("file_count").notNull().default(0),
	installDir: text("install_dir").notNull(),
	enabled: boolean("enabled").notNull().default(true),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Links a domain to a local repo checkout for the SEO/GEO/AEO analyzer
 * extension. One workspace may run several linked projects (e.g. marketing
 * site + docs site). `fixerAgentId` is provisioned lazily on first fix
 * dispatch (see apps/server/src/seo-analyzer.ts) rather than at project
 * creation, so linking a project never creates an agent nobody asked for. */
export const seoProject = pgTable("seo_project", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	extensionId: text("extension_id")
		.notNull()
		.references(() => extension.id, { onDelete: "cascade" }),
	domain: text("domain").notNull(),
	repoPath: text("repo_path").notNull(),
	// Detected blog directory + frontmatter convention, filled in by the blog
	// heuristic on first "generate post" run. Null until then.
	blogConfig: jsonb("blog_config").$type<{
		dir: string;
		frontmatterStyle: string;
	} | null>(),
	fixerAgentId: text("fixer_agent_id").references(() => agent.id, {
		onDelete: "set null",
	}),
	// Optional recurring re-analysis, polled by the same scheduler loop as
	// automations (see apps/server/src/scheduler.ts) rather than going through
	// the agent-driven automation table — a crawl+scan isn't an LLM turn.
	reanalyzeCronExpression: text("reanalyze_cron_expression"),
	nextReanalyzeAt: timestamp("next_reanalyze_at"),
	lastReanalyzeAt: timestamp("last_reanalyze_at"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const seoAnalysisRun = pgTable("seo_analysis_run", {
	id: text("id").primaryKey(),
	seoProjectId: text("seo_project_id")
		.notNull()
		.references(() => seoProject.id, { onDelete: "cascade" }),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	status: seoAnalysisRunStatus("status").notNull().default("running"),
	// 0-100 composite score, null until the run completes.
	score: integer("score"),
	pagesScanned: integer("pages_scanned").notNull().default(0),
	summary: text("summary"),
	errorMessage: text("error_message"),
	startedAt: timestamp("started_at").notNull().defaultNow(),
	completedAt: timestamp("completed_at"),
});

export const seoFinding = pgTable("seo_finding", {
	id: text("id").primaryKey(),
	runId: text("run_id")
		.notNull()
		.references(() => seoAnalysisRun.id, { onDelete: "cascade" }),
	// Denormalized so "all open findings for a project" doesn't need to join
	// through every historical run.
	seoProjectId: text("seo_project_id")
		.notNull()
		.references(() => seoProject.id, { onDelete: "cascade" }),
	category: seoFindingCategory("category").notNull(),
	severity: seoFindingSeverity("severity").notNull(),
	title: text("title").notNull(),
	description: text("description").notNull(),
	recommendation: text("recommendation").notNull(),
	// Page URL (crawl findings) or repo-relative file path (source-scan
	// findings) the finding applies to. Null for site-wide findings.
	location: text("location"),
	resolved: boolean("resolved").notNull().default(false),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const seoBlogPost = pgTable("seo_blog_post", {
	id: text("id").primaryKey(),
	seoProjectId: text("seo_project_id")
		.notNull()
		.references(() => seoProject.id, { onDelete: "cascade" }),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	keyword: text("keyword").notNull(),
	title: text("title"),
	filePath: text("file_path"),
	status: seoBlogPostStatus("status").notNull().default("suggested"),
	taskId: text("task_id").references(() => task.id, { onDelete: "set null" }),
	errorMessage: text("error_message"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** A folder in the workspace's document/image library — purely an
 * organizational grouping, not tied to disk paths directly (see
 * libraryFile.storageKey for where bytes actually live). `parentId` is a
 * plain column with no FK constraint (same pattern as task.parentTaskId)
 * since Drizzle pg-core self-references need an awkward callback form;
 * cascading delete of subfolders/files is handled in
 * apps/server/src/library.ts instead of at the DB level. */
export const libraryFolder = pgTable("library_folder", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	parentId: text("parent_id"),
	name: text("name").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Metadata for one uploaded file in the library — the actual bytes live on
 * disk under LIBRARY_ROOT/<workspaceId>/<id>-<name> (see
 * apps/server/src/library.ts), this row is what the UI lists, renames,
 * moves, and deletes against. `folderId` null means "at the library root". */
export const libraryFile = pgTable("library_file", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	folderId: text("folder_id").references(() => libraryFolder.id, {
		onDelete: "set null",
	}),
	name: text("name").notNull(),
	mimeType: text("mime_type").notNull(),
	sizeBytes: integer("size_bytes").notNull(),
	kind: libraryItemKind("kind").notNull().default("other"),
	storageKey: text("storage_key").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** One text-to-video generation request, tracked as a row because
 * generation runs for minutes — the chat tool call polls this same job
 * synchronously, but the Video Studio page (apps/web) reads it back out to
 * show a history/queue instead of blocking on a single request. `chatId` is
 * a plain nullable column (no FK) since a job can be started from the Video
 * Studio page with no chat behind it at all. `libraryFileId`/
 * `posterLibraryFileId` are set once the finished video (and, best-effort,
 * a poster frame) have been written into the workspace library. */
export const videoGenerationJob = pgTable("video_generation_job", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	chatId: text("chat_id"),
	prompt: text("prompt").notNull(),
	model: text("model").notNull(),
	provider: text("provider").notNull(),
	status: videoGenerationJobStatus("status").notNull().default("queued"),
	progress: integer("progress").notNull().default(0),
	size: text("size").notNull(),
	seconds: integer("seconds").notNull(),
	auto: boolean("auto").notNull().default(true),
	externalJobId: text("external_job_id"),
	libraryFileId: text("library_file_id").references(() => libraryFile.id, {
		onDelete: "set null",
	}),
	posterLibraryFileId: text("poster_library_file_id").references(() => libraryFile.id, {
		onDelete: "set null",
	}),
	errorMessage: text("error_message"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** See ../sqlite/app.ts. */
export type WorkflowNodeKind =
	| "text_prompt"
	| "image_upload"
	| "video_upload"
	| "generate_image"
	| "generate_video"
	| "edit_video"
	| "agent"
	| "output";

/** See ../sqlite/app.ts. */
export interface WorkflowDefinition {
	nodes: {
		id: string;
		type: WorkflowNodeKind;
		position: { x: number; y: number };
		data: Record<string, unknown>;
	}[];
	edges: { id: string; source: string; target: string }[];
	viewport?: { x: number; y: number; zoom: number };
}

/** See ../sqlite/app.ts. */
export const workflow = pgTable("workflow", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	description: text("description"),
	definition: jsonb("definition").notNull().$type<WorkflowDefinition>(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** See ../sqlite/app.ts. */
export const workflowRun = pgTable("workflow_run", {
	id: text("id").primaryKey(),
	workflowId: text("workflow_id")
		.notNull()
		.references(() => workflow.id, { onDelete: "cascade" }),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	status: workflowRunStatus("status").notNull().default("queued"),
	errorMessage: text("error_message"),
	startedAt: timestamp("started_at"),
	completedAt: timestamp("completed_at"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** See ../sqlite/app.ts. */
export const workflowRunNode = pgTable("workflow_run_node", {
	id: text("id").primaryKey(),
	runId: text("run_id")
		.notNull()
		.references(() => workflowRun.id, { onDelete: "cascade" }),
	nodeId: text("node_id").notNull(),
	status: workflowRunNodeStatus("status").notNull().default("queued"),
	progress: integer("progress").notNull().default(0),
	libraryFileId: text("library_file_id").references(() => libraryFile.id, {
		onDelete: "set null",
	}),
	errorMessage: text("error_message"),
	startedAt: timestamp("started_at"),
	completedAt: timestamp("completed_at"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
