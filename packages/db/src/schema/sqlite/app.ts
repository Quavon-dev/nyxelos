import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth";

export type MessageRole = "user" | "assistant" | "system" | "tool";

/** See ../pg/app.ts — Phase 2 implements "autonomous"/"super_agent" behavior. */
export type AgentAutonomyLevel =
	| "chat"
	| "assisted"
	| "autonomous"
	| "super_agent";
export type InstallationMode = "pc" | "server";
export type ModelProviderKind =
	| "anthropic"
	| "openai"
	| "openrouter"
	| "openai_compatible"
	| "claude_cli"
	| "codex_cli";

export type McpTransport = "stdio" | "http";

export type ApprovalStatus = "pending" | "approved" | "rejected";
export type ApprovalKind = "skill" | "tool" | "mcp";
export type AuditActor = "chat" | "automation" | "approval" | "delegate" | "extension";
export type AuditStatus = "success" | "error" | "pending_approval" | "rejected";
/** See ../pg/app.ts — event bus v1 stable event types. */
export type NyxelEventType =
	| "agent.run.started"
	| "agent.run.completed"
	| "agent.run.failed"
	| "approval.created"
	| "approval.resolved"
	| "workflow.completed"
	| "task.failed"
	| "library.file.created"
	| "automation.triggered";
export type ChatToolMode = "default" | "automatic" | "auto";
export type TaskStatus =
	| "pending"
	| "planning"
	| "ready"
	| "running"
	| "blocked"
	| "waiting_approval"
	| "completed"
	| "failed"
	| "cancelled";
export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type TaskEventKind =
	| "created"
	| "planned"
	| "status_changed"
	| "assigned"
	| "delegated"
	| "tool_called"
	| "approval_waiting"
	| "approval_resolved"
	| "run_started"
	| "run_finished"
	| "comment"
	| "question"
	| "question_answered"
	| "completed"
	| "failed";
export type AgentRunTrigger =
	| "chat"
	| "task"
	| "automation"
	| "delegate"
	| "extension";

export type SeoAnalysisRunStatus = "running" | "completed" | "failed";
export type SeoFindingCategory = "seo" | "geo" | "aeo";
export type SeoFindingSeverity = "info" | "warning" | "critical";
export type SeoBlogPostStatus =
	| "suggested"
	| "generating"
	| "written"
	| "failed";
export type AgentRunStatus =
	| "pending"
	| "running"
	| "waiting_approval"
	| "completed"
	| "failed"
	| "cancelled";

export type ChatToolPolicy = {
	mode: ChatToolMode;
	approveFileWrites: boolean;
	approveFileDeletes: boolean;
	approveCustomCode: boolean;
	approveMcpTools: boolean;
};

/** See ../pg/app.ts and packages/skills-sdk — DB-backed tools built from a
 * declarative `kind` + JSON `config` instead of hand-written TypeScript, so
 * the workspace tools section can create them at runtime. */
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

export type AutomationTriggerType = "cron" | "file_watch";
export type AutomationTargetKind = "agent" | "workflow";
export type AutomationRunStatus = "success" | "error" | "pending_approval";

export type MemoryType =
	| "user_preference"
	| "workspace_fact"
	| "project_decision"
	| "agent_observation"
	| "task_summary"
	| "file_summary"
	| "repo_summary"
	| "long_term_note";
export type MemorySource = "user" | "agent" | "automation" | "system";
export type ArtifactType =
	| "text"
	| "markdown"
	| "code_patch"
	| "diff"
	| "file"
	| "report"
	| "json"
	| "image_reference"
	| "task_result"
	| "command_output";

/** See ../pg/app.ts. */
export type LibraryItemKind = "image" | "document" | "video" | "other";

/** See ../pg/app.ts. */
export type VideoGenerationJobStatus = "queued" | "in_progress" | "completed" | "failed";

/** See ../pg/app.ts. */
export type WorkflowRunStatus = "queued" | "running" | "completed" | "failed" | "partial";

/** See ../pg/app.ts. */
export type WorkflowRunNodeStatus = "queued" | "running" | "completed" | "failed" | "skipped";

/** Node kinds the canvas builder (apps/web) and workflow-runner
 * (apps/server) both understand — see WorkflowDefinition below. */
export type WorkflowNodeKind =
	| "text_prompt"
	| "image_upload"
	| "video_upload"
	| "generate_image"
	| "generate_video"
	| "edit_video"
	| "agent"
	| "http_request"
	| "delay"
	| "condition"
	| "output";

/** The graph a workflow's canvas builds and the runner executes — plain
 * JSON rather than a normalized table per node/edge because the whole graph
 * is always read and written together (one autosave, one run), and React
 * Flow's own node/edge shape is the natural fit to persist as-is. `data` is
 * intentionally untyped per node kind: each node kind's own config (prompt
 * text, model id, edit params, ...) is validated by the runner/UI, not the
 * DB layer. */
export interface WorkflowDefinition {
	nodes: {
		id: string;
		type: WorkflowNodeKind;
		position: { x: number; y: number };
		data: Record<string, unknown>;
	}[];
	edges: {
		id: string;
		source: string;
		target: string;
		sourceHandle?: string | null;
	}[];
	viewport?: { x: number; y: number; zoom: number };
}

/** A sub-agent bundled in an installed plugin's `agents/*.md` directory
 * (Claude Code plugin format) — parsed and stored for display; not wired
 * into NyxelOS's own agent runtime automatically. See ../pg/app.ts. */
export interface PluginAgentDefinition {
	slug: string;
	name: string;
	description: string;
	body: string;
}

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
	// Prepended to every agent/chat system prompt in this workspace — see
	// apps/server/src/workspace-prompt.ts, the single place this is read from.
	customInstructions: text("custom_instructions"),
	icon: text("icon"),
	color: text("color"),
	defaultModelId: text("default_model_id"),
	defaultAutonomyLevel: text("default_autonomy_level")
		.notNull()
		.default("assisted")
		.$type<AgentAutonomyLevel>(),
	// Applied to every new chat created in this workspace — see
	// resolveChatToolPolicy in apps/server/src/trpc/router.ts. Null means "use
	// the global DEFAULT_CHAT_TOOL_POLICY".
	defaultToolPolicy: text("default_tool_policy", {
		mode: "json",
	}).$type<ChatToolPolicy>(),
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
	modelIds: text("model_ids", { mode: "json" })
		.notNull()
		.default([])
		.$type<string[]>(),
	// Subset of modelIds hidden from the model picker without removing them —
	// see ../pg/app.ts.
	disabledModelIds: text("disabled_model_ids", { mode: "json" })
		.notNull()
		.default([])
		.$type<string[]>(),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type ModelReasoningEffort = "low" | "medium" | "high";

/** Per-(workspace, model) generation overrides — how a specific installed
 * model should behave by default (sampling params, reasoning effort, a
 * model-only instructions addendum). One row per model; deleting it (the
 * "reset" action) just falls back to provider defaults. */
export const modelParameter = sqliteTable(
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
		temperature: real("temperature"),
		topP: real("top_p"),
		frequencyPenalty: real("frequency_penalty"),
		presencePenalty: real("presence_penalty"),
		stopSequences: text("stop_sequences", { mode: "json" })
			.notNull()
			.default([])
			.$type<string[]>(),
		reasoningEffort: text("reasoning_effort").$type<ModelReasoningEffort>(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(table) => [
		uniqueIndex("model_parameter_workspace_model_idx").on(table.workspaceId, table.modelId),
	],
);

export const agent = sqliteTable("agent", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	systemPrompt: text("system_prompt"),
	role: text("role"),
	goalTemplate: text("goal_template"),
	modelId: text("model_id").notNull(),
	autonomyLevel: text("autonomy_level")
		.notNull()
		.default("chat")
		.$type<AgentAutonomyLevel>(),
	mcpServerIds: text("mcp_server_ids", { mode: "json" })
		.notNull()
		.default([])
		.$type<string[]>(),
	toolIds: text("tool_ids", { mode: "json" })
		.notNull()
		.default([])
		.$type<string[]>(),
	skillIds: text("skill_ids", { mode: "json" })
		.notNull()
		.default([])
		.$type<string[]>(),
	// Optional per-tool allow-list, entries shaped "serverId::toolName". Null
	// (the default) means "every tool from every server in mcpServerIds" —
	// this only narrows that set, it never grants access beyond it.
	mcpToolFilter: text("mcp_tool_filter", { mode: "json" }).$type<
		string[] | null
	>(),
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
	/** Extra env vars for stdio servers only, e.g. a path to an OAuth
	 * credentials file a local command needs to read. Never sent to http
	 * servers — those authenticate via OAuth, not process env. */
	env: text("env", { mode: "json" }).$type<Record<string, string>>(),
	/** Persisted OAuth session for http servers — dynamic client registration
	 * result, access/refresh tokens, PKCE state. Without this, every server
	 * restart drops the in-memory OAuth provider and forces re-authorization
	 * for every previously-connected http connector. Opaque blob because the
	 * shape belongs to @modelcontextprotocol/sdk, not this schema. */
	oauthState: text("oauth_state", { mode: "json" }).$type<Record<string, unknown>>(),
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
	docsAgentEnabled: integer("docs_agent_enabled", { mode: "boolean" })
		.notNull()
		.default(true),
	// Whether getKnowledgeBaseContextForPrompt() output is appended to every
	// chat/automation system prompt for this workspace. Default on — the goal
	// is that the model always has the living knowledge base, not just on
	// request. See apps/server/src/knowledge-base.ts.
	injectIntoPrompts: integer("inject_into_prompts", { mode: "boolean" })
		.notNull()
		.default(true),
	lastDocsSyncAt: integer("last_docs_sync_at", { mode: "timestamp" }),
	lastDocsSyncError: text("last_docs_sync_error"),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/** A user-defined tool, built from a declarative `kind` instead of
 * hand-written TypeScript. Complements the process-wide hardcoded skills in
 * apps/server/src/skills-registry.ts — both are merged at tool-build time,
 * but they remain separate concepts. */
export const tool = sqliteTable("tool", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	description: text("description").notNull(),
	kind: text("kind").notNull().$type<ToolKind>(),
	// Shape depends on `kind` — see apps/server/src/skills-dynamic.ts:
	// http_fetch: { allowedHosts: string[] }
	// file_read / file_list: { allowedDirs: string[] }
	// file_write: { allowedDirs: string[] }
	// kb_search: {}
	// custom_code: { allowedHosts: string[], allowedDirs: string[], code: string }
	config: text("config", { mode: "json" })
		.notNull()
		.default({})
		.$type<Record<string, unknown>>(),
	sensitive: integer("sensitive", { mode: "boolean" }).notNull().default(true),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
	// Seeded per workspace (apps/server/src/tools-builtin-seed.ts), can be
	// disabled but not deleted — see deleteTool()'s guard in both repos.
	builtin: integer("builtin", { mode: "boolean" }).notNull().default(false),
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
	// Sidebar/detail-page appearance — a fixed token name (see
	// PROJECT_COLORS/PROJECT_ICONS on the web client), not a raw hex/svg, so
	// the palette can be restyled without touching stored data.
	color: text("color").notNull().default("gray"),
	icon: text("icon").notNull().default("folder"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const chat = sqliteTable("chat", {
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
	archivedAt: integer("archived_at", { mode: "timestamp" }),
	pinnedAt: integer("pinned_at", { mode: "timestamp" }),
	shareId: text("share_id").unique(),
	sharedAt: integer("shared_at", { mode: "timestamp" }),
	toolMode: text("tool_mode")
		.notNull()
		.default("default")
		.$type<ChatToolMode>(),
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
	// See ../pg/app.ts for the rationale — null for non-assistant turns, only
	// populated by streamChat() (chat-stream.ts). Powers the detailed
	// statistics dashboard.
	modelId: text("model_id"),
	inputTokens: integer("input_tokens"),
	outputTokens: integer("output_tokens"),
	reasoningTokens: integer("reasoning_tokens"),
	cacheReadTokens: integer("cache_read_tokens"),
	totalTokens: integer("total_tokens"),
	costMicros: integer("cost_micros"),
	durationMs: integer("duration_ms"),
	thinkingMs: integer("thinking_ms"),
	lineCount: integer("line_count"),
	codeLineCount: integer("code_line_count"),
	codeBlockCount: integer("code_block_count"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const automation = sqliteTable("automation", {
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
	targetKind: text("target_kind")
		.notNull()
		.default("agent")
		.$type<AutomationTargetKind>(),
	name: text("name").notNull(),
	// "cron" (default, existing behavior) or "file_watch". See ADR-0013.
	triggerType: text("trigger_type")
		.notNull()
		.default("cron")
		.$type<AutomationTriggerType>(),
	// Required when triggerType is "cron"; empty string when "file_watch".
	cronExpression: text("cron_expression").notNull().default(""),
	// Only meaningful when triggerType is "file_watch" — an absolute or
	// repo-relative directory to poll, and an optional glob-ish suffix filter
	// (e.g. ".md") applied to changed file names.
	watchPath: text("watch_path"),
	watchGlob: text("watch_glob"),
	lastWatchCheckAt: integer("last_watch_check_at", { mode: "timestamp" }),
	// Empty for targetKind "workflow" (a workflow graph has no single prompt).
	prompt: text("prompt").notNull().default(""),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
	lastRunAt: integer("last_run_at", { mode: "timestamp" }),
	nextRunAt: integer("next_run_at", { mode: "timestamp" }),
	// Outcome of the most recent run, surfaced in the automations list so a
	// failing automation doesn't silently keep retrying unnoticed.
	lastRunStatus: text("last_run_status").$type<AutomationRunStatus>(),
	lastErrorMessage: text("last_error_message"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const task = sqliteTable("task", {
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
	status: text("status").notNull().default("pending").$type<TaskStatus>(),
	priority: text("priority").notNull().default("normal").$type<TaskPriority>(),
	requiresApproval: integer("requires_approval", { mode: "boolean" })
		.notNull()
		.default(false),
	input: text("input", { mode: "json" })
		.notNull()
		.default({})
		.$type<Record<string, unknown>>(),
	plan: text("plan", { mode: "json" }).$type<Record<string, unknown> | null>(),
	handoff: text("handoff", { mode: "json" }).$type<
		Record<string, unknown> | null
	>(),
	resultSummary: text("result_summary"),
	errorMessage: text("error_message"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	startedAt: integer("started_at", { mode: "timestamp" }),
	completedAt: integer("completed_at", { mode: "timestamp" }),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const agentRun = sqliteTable("agent_run", {
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
	trigger: text("trigger").notNull().$type<AgentRunTrigger>(),
	// The model actually used for this run — may differ from the agent's
	// current default (task override, or the agent's model changed since).
	modelId: text("model_id"),
	stepCount: integer("step_count").notNull().default(0),
	status: text("status").notNull().default("pending").$type<AgentRunStatus>(),
	finalOutput: text("final_output"),
	errorMessage: text("error_message"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	startedAt: integer("started_at", { mode: "timestamp" }),
	completedAt: integer("completed_at", { mode: "timestamp" }),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const taskEvent = sqliteTable("task_event", {
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
	kind: text("kind").notNull().$type<TaskEventKind>(),
	message: text("message").notNull(),
	payload: text("payload", { mode: "json" }).$type<Record<string, unknown> | null>(),
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
	automationId: text("automation_id").references(() => automation.id, {
		onDelete: "set null",
	}),
	taskId: text("task_id").references(() => task.id, { onDelete: "set null" }),
	agentRunId: text("agent_run_id").references(() => agentRun.id, {
		onDelete: "set null",
	}),
	kind: text("kind").notNull().$type<ApprovalKind>(),
	skillId: text("skill_id"),
	toolId: text("tool_id"),
	mcpServerId: text("mcp_server_id"),
	mcpToolName: text("mcp_tool_name"),
	toolLabel: text("tool_label").notNull(),
	input: text("input", { mode: "json" })
		.notNull()
		.$type<Record<string, unknown>>(),
	status: text("status").notNull().default("pending").$type<ApprovalStatus>(),
	resultOutput: text("result_output", { mode: "json" }).$type<unknown>(),
	errorMessage: text("error_message"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	resolvedAt: integer("resolved_at", { mode: "timestamp" }),
	// See ../pg/app.ts for the rationale — additive/nullable richer
	// approval-dialog context (ADR-0017).
	title: text("title"),
	description: text("description"),
	riskLevel: text("risk_level"),
	affectedResources: text("affected_resources", { mode: "json" }).$type<string[]>(),
	diffPreview: text("diff_preview"),
});

export const auditLog = sqliteTable("audit_log", {
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
	actor: text("actor").notNull().$type<AuditActor>(),
	toolLabel: text("tool_label").notNull(),
	input: text("input", { mode: "json" }).$type<unknown>(),
	output: text("output", { mode: "json" }).$type<unknown>(),
	status: text("status").notNull().$type<AuditStatus>(),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	// See ../pg/app.ts for the rationale — additive/nullable (ADR-0017).
	inputHash: text("input_hash"),
	permissionSnapshot: text("permission_snapshot", { mode: "json" }).$type<
		Record<string, unknown>
	>(),
});

/** See ../pg/app.ts. */
export const nyxelEvent = sqliteTable("nyxel_event", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	type: text("type").notNull().$type<NyxelEventType>(),
	entityType: text("entity_type").notNull(),
	entityId: text("entity_id").notNull(),
	payload: text("payload", { mode: "json" }).$type<Record<string, unknown> | null>(),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

/** See ../pg/app.ts. */
export const memoryEntry = sqliteTable("memory_entry", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	type: text("type").notNull().$type<MemoryType>(),
	content: text("content").notNull(),
	source: text("source").notNull().$type<MemorySource>(),
	confidence: real("confidence").notNull().default(1),
	createdByAgentId: text("created_by_agent_id").references(() => agent.id, {
		onDelete: "set null",
	}),
	expiresAt: integer("expires_at", { mode: "timestamp" }),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/** See ../pg/app.ts. */
export const artifact = sqliteTable("artifact", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	type: text("type").notNull().$type<ArtifactType>(),
	title: text("title").notNull(),
	content: text("content").notNull(),
	taskId: text("task_id").references(() => task.id, { onDelete: "set null" }),
	agentRunId: text("agent_run_id").references(() => agentRun.id, {
		onDelete: "set null",
	}),
	agentId: text("agent_id").references(() => agent.id, { onDelete: "set null" }),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

/** One browser/device Web Push subscription (VAPID) — lets the server push
 * notifications (approval needed, task done, automation failed) to a
 * user's installed PWA even when the tab is closed. */
export const pushSubscription = sqliteTable("push_subscription", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	endpoint: text("endpoint").notNull().unique(),
	p256dh: text("p256dh").notNull(),
	auth: text("auth").notNull(),
	userAgent: text("user_agent"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

/** Mirrors ../pg/app.ts. */
export const extension = sqliteTable("extension", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	key: text("key").notNull(),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
	config: text("config", { mode: "json" })
		.notNull()
		.default({})
		.$type<Record<string, unknown>>(),
	installedAt: integer("installed_at", { mode: "timestamp" }).notNull(),
});

/** An installed plugin — a full folder-based bundle (Claude Code plugin
 * format: `.claude-plugin/plugin.json` + `skills/`, `agents/`, and other
 * supporting files) pulled from a GitHub repo and kept on disk under
 * `installDir` rather than flattened into a single markdown body. Every
 * `skills/<slug>/SKILL.md` the plugin ships is registered as a file skill
 * (see packages/skills-sdk/src/file-skill.ts loadFileSkillBundle) whose id
 * is tracked in `skillSlugs`; `agents/*.md` sub-agents are parsed into
 * `agentDefs` for display since NyxelOS agents are DB rows, not files. See
 * ../pg/app.ts. */
export const plugin = sqliteTable("plugin", {
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
	// Raw parsed .claude-plugin/plugin.json (or {} for repos that ship skills
	// without a manifest) — kept verbatim so the UI can show anything a future
	// manifest field adds without a schema change.
	manifest: text("manifest", { mode: "json" })
		.notNull()
		.default({})
		.$type<Record<string, unknown>>(),
	// file_skill_bundle__ ids (see file-skill.ts) contributed by this plugin's
	// skills/ directory — used to merge them into the workspace skill catalog
	// and to clean them up on uninstall.
	skillSlugs: text("skill_slugs", { mode: "json" })
		.notNull()
		.default([])
		.$type<string[]>(),
	agentDefs: text("agent_defs", { mode: "json" })
		.notNull()
		.default([])
		.$type<PluginAgentDefinition[]>(),
	fileCount: integer("file_count").notNull().default(0),
	// Absolute path under NYXEL_PLUGINS_DIR/<workspaceId>/<slug>/ where every
	// downloaded file lives, preserving the repo's folder structure.
	installDir: text("install_dir").notNull(),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
	// Install-hardening (docs/PLUGIN_SECURITY.md stage 3): the branch/tag/ref
	// actually used, the best-effort-resolved commit SHA at install time (null
	// if GitHub's commit-resolve call failed), and whether the user pinned an
	// exact commit themselves via `/tree/<40-hex-sha>` rather than a moving
	// branch/tag name.
	ref: text("ref").notNull().default(""),
	resolvedSha: text("resolved_sha"),
	refPinned: integer("ref_pinned", { mode: "boolean" }).notNull().default(false),
	// Stage 3 static-scan findings ("pattern: file" strings) recorded at
	// install time for later display — see scanForRiskyPatterns in plugins.ts.
	riskFindings: text("risk_findings", { mode: "json" })
		.notNull()
		.default([])
		.$type<string[]>(),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const seoProject = sqliteTable("seo_project", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	extensionId: text("extension_id")
		.notNull()
		.references(() => extension.id, { onDelete: "cascade" }),
	domain: text("domain").notNull(),
	repoPath: text("repo_path").notNull(),
	blogConfig: text("blog_config", { mode: "json" }).$type<{
		dir: string;
		frontmatterStyle: string;
	} | null>(),
	fixerAgentId: text("fixer_agent_id").references(() => agent.id, {
		onDelete: "set null",
	}),
	reanalyzeCronExpression: text("reanalyze_cron_expression"),
	nextReanalyzeAt: integer("next_reanalyze_at", { mode: "timestamp" }),
	lastReanalyzeAt: integer("last_reanalyze_at", { mode: "timestamp" }),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const seoAnalysisRun = sqliteTable("seo_analysis_run", {
	id: text("id").primaryKey(),
	seoProjectId: text("seo_project_id")
		.notNull()
		.references(() => seoProject.id, { onDelete: "cascade" }),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	status: text("status")
		.notNull()
		.default("running")
		.$type<SeoAnalysisRunStatus>(),
	score: integer("score"),
	pagesScanned: integer("pages_scanned").notNull().default(0),
	summary: text("summary"),
	errorMessage: text("error_message"),
	startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
	completedAt: integer("completed_at", { mode: "timestamp" }),
});

export const seoFinding = sqliteTable("seo_finding", {
	id: text("id").primaryKey(),
	runId: text("run_id")
		.notNull()
		.references(() => seoAnalysisRun.id, { onDelete: "cascade" }),
	seoProjectId: text("seo_project_id")
		.notNull()
		.references(() => seoProject.id, { onDelete: "cascade" }),
	category: text("category").notNull().$type<SeoFindingCategory>(),
	severity: text("severity").notNull().$type<SeoFindingSeverity>(),
	title: text("title").notNull(),
	description: text("description").notNull(),
	recommendation: text("recommendation").notNull(),
	location: text("location"),
	resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const seoBlogPost = sqliteTable("seo_blog_post", {
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
	status: text("status")
		.notNull()
		.default("suggested")
		.$type<SeoBlogPostStatus>(),
	taskId: text("task_id").references(() => task.id, { onDelete: "set null" }),
	errorMessage: text("error_message"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/** See ../pg/app.ts. */
export const libraryFolder = sqliteTable("library_folder", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	parentId: text("parent_id"),
	name: text("name").notNull(),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

/** See ../pg/app.ts. */
export const libraryFile = sqliteTable("library_file", {
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
	kind: text("kind").notNull().default("other").$type<LibraryItemKind>(),
	storageKey: text("storage_key").notNull(),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/** See ../pg/app.ts. */
export const videoGenerationJob = sqliteTable("video_generation_job", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	chatId: text("chat_id"),
	prompt: text("prompt").notNull(),
	model: text("model").notNull(),
	provider: text("provider").notNull(),
	status: text("status").notNull().default("queued").$type<VideoGenerationJobStatus>(),
	progress: integer("progress").notNull().default(0),
	size: text("size").notNull(),
	seconds: integer("seconds").notNull(),
	auto: integer("auto", { mode: "boolean" }).notNull().default(true),
	externalJobId: text("external_job_id"),
	libraryFileId: text("library_file_id").references(() => libraryFile.id, {
		onDelete: "set null",
	}),
	posterLibraryFileId: text("poster_library_file_id").references(() => libraryFile.id, {
		onDelete: "set null",
	}),
	errorMessage: text("error_message"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/** See ../pg/app.ts. */
export const workflow = sqliteTable("workflow", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	description: text("description"),
	definition: text("definition", { mode: "json" })
		.notNull()
		.$type<WorkflowDefinition>(),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/** See ../pg/app.ts. */
export const workflowRun = sqliteTable("workflow_run", {
	id: text("id").primaryKey(),
	workflowId: text("workflow_id")
		.notNull()
		.references(() => workflow.id, { onDelete: "cascade" }),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspace.id, { onDelete: "cascade" }),
	status: text("status").notNull().default("queued").$type<WorkflowRunStatus>(),
	errorMessage: text("error_message"),
	startedAt: integer("started_at", { mode: "timestamp" }),
	completedAt: integer("completed_at", { mode: "timestamp" }),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

/** See ../pg/app.ts. */
export const workflowRunNode = sqliteTable("workflow_run_node", {
	id: text("id").primaryKey(),
	runId: text("run_id")
		.notNull()
		.references(() => workflowRun.id, { onDelete: "cascade" }),
	// References a node id inside the parent run's workflow.definition JSON,
	// not a row in another table — the graph isn't normalized (see
	// WorkflowDefinition above), so there's nothing to foreign-key against.
	nodeId: text("node_id").notNull(),
	status: text("status").notNull().default("queued").$type<WorkflowRunNodeStatus>(),
	progress: integer("progress").notNull().default(0),
	libraryFileId: text("library_file_id").references(() => libraryFile.id, {
		onDelete: "set null",
	}),
	errorMessage: text("error_message"),
	startedAt: integer("started_at", { mode: "timestamp" }),
	completedAt: integer("completed_at", { mode: "timestamp" }),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
