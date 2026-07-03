export type MessageRole = "user" | "assistant" | "system" | "tool";

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

export type GoalStatus =
	| "active"
	| "paused"
	| "blocked"
	| "completed"
	| "archived";
export type GoalMilestoneStatus = "pending" | "completed";
export type GoalEventKind =
	| "created"
	| "status_changed"
	| "milestone_added"
	| "milestone_status_changed";

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

export type LibraryItemKind = "image" | "document" | "video" | "other";

export interface ChatToolPolicy {
	mode: ChatToolMode;
	approveFileWrites: boolean;
	approveFileDeletes: boolean;
	approveCustomCode: boolean;
	approveMcpTools: boolean;
}

/** A sub-agent bundled in an installed plugin's `agents/*.md` directory. */
export interface PluginAgentDefinition {
	slug: string;
	name: string;
	description: string;
	body: string;
}

export const DEFAULT_CHAT_TOOL_POLICY: ChatToolPolicy = {
	mode: "default",
	approveFileWrites: true,
	approveFileDeletes: true,
	approveCustomCode: true,
	approveMcpTools: true,
};

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

export interface WorkspaceRecord {
	id: string;
	userId: string;
	name: string;
	customInstructions: string | null;
	icon: string | null;
	color: string | null;
	defaultModelId: string | null;
	defaultAutonomyLevel: AgentAutonomyLevel;
	defaultToolPolicy: ChatToolPolicy;
}

export interface InstallationRecord {
	id: string;
	mode: InstallationMode;
	ownerUserId: string;
	primaryWorkspaceId: string;
	appUrl: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface ChatRecord {
	id: string;
	workspaceId: string;
	workingDirectory: string;
	agentId: string | null;
	projectId: string | null;
	title: string;
	modelId: string;
	archivedAt: Date | null;
	pinnedAt: Date | null;
	shareId: string | null;
	sharedAt: Date | null;
	toolMode: ChatToolMode;
	toolPolicy: ChatToolPolicy;
	createdAt: Date;
}

export interface ProjectRecord {
	id: string;
	workspaceId: string;
	name: string;
	color: string;
	icon: string;
	createdAt: Date;
}

/** Usage/generation metrics captured for an assistant turn — see
 * schema/pg/app.ts's message table for the column-level rationale. Every
 * field is null for user/system/tool turns and for assistant turns
 * generated before this tracking existed. */
export interface MessageUsage {
	modelId: string | null;
	inputTokens: number | null;
	outputTokens: number | null;
	reasoningTokens: number | null;
	cacheReadTokens: number | null;
	totalTokens: number | null;
	costMicros: number | null;
	durationMs: number | null;
	thinkingMs: number | null;
	lineCount: number | null;
	codeLineCount: number | null;
	codeBlockCount: number | null;
}

export interface MessageRecord extends MessageUsage {
	id: string;
	chatId: string;
	role: MessageRole;
	content: string;
	createdAt: Date;
}

export interface AgentRecord {
	id: string;
	workspaceId: string;
	name: string;
	systemPrompt: string | null;
	role: string | null;
	goalTemplate: string | null;
	modelId: string;
	autonomyLevel: AgentAutonomyLevel;
	skillIds: string[];
	mcpServerIds: string[];
	toolIds: string[];
	/** Per-tool allow-list narrowing mcpServerIds, entries shaped
	 * "serverId::toolName". Null means every tool from every listed server. */
	mcpToolFilter: string[] | null;
	/** Only meaningful for autonomyLevel "super_agent" — see ADR-0011. */
	delegateAgentIds: string[];
	createdAt: Date;
}

export interface TaskRecord {
	id: string;
	workspaceId: string;
	parentTaskId: string | null;
	sourceChatId: string | null;
	createdByAgentId: string | null;
	assignedAgentId: string | null;
	title: string;
	instruction: string;
	/** Overrides the assigned agent's default model for this task only. */
	modelId: string | null;
	status: TaskStatus;
	priority: TaskPriority;
	requiresApproval: boolean;
	input: Record<string, unknown>;
	plan: Record<string, unknown> | null;
	handoff: Record<string, unknown> | null;
	resultSummary: string | null;
	errorMessage: string | null;
	createdAt: Date;
	startedAt: Date | null;
	completedAt: Date | null;
	updatedAt: Date;
}

export interface TaskEventRecord {
	id: string;
	taskId: string;
	workspaceId: string;
	agentRunId: string | null;
	agentId: string | null;
	kind: TaskEventKind;
	message: string;
	payload: Record<string, unknown> | null;
	createdAt: Date;
}

export interface GoalRecord {
	id: string;
	workspaceId: string;
	title: string;
	description: string | null;
	status: GoalStatus;
	priority: TaskPriority;
	createdAt: Date;
	updatedAt: Date;
}

export interface GoalMilestoneRecord {
	id: string;
	goalId: string;
	workspaceId: string;
	title: string;
	status: GoalMilestoneStatus;
	order: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface GoalProgressEventRecord {
	id: string;
	goalId: string;
	workspaceId: string;
	kind: GoalEventKind;
	message: string;
	payload: Record<string, unknown> | null;
	createdAt: Date;
}

export interface AgentRunRecord {
	id: string;
	workspaceId: string;
	taskId: string | null;
	agentId: string;
	chatId: string | null;
	automationId: string | null;
	trigger: AgentRunTrigger;
	/** The model actually used for this run. */
	modelId: string | null;
	stepCount: number;
	status: AgentRunStatus;
	finalOutput: string | null;
	errorMessage: string | null;
	createdAt: Date;
	startedAt: Date | null;
	completedAt: Date | null;
	updatedAt: Date;
}

export interface UserRecord {
	id: string;
	name: string;
	email: string;
}

export interface AutomationRecord {
	id: string;
	workspaceId: string;
	agentId: string | null;
	workflowId: string | null;
	targetKind: AutomationTargetKind;
	name: string;
	triggerType: AutomationTriggerType;
	cronExpression: string;
	watchPath: string | null;
	watchGlob: string | null;
	lastWatchCheckAt: Date | null;
	prompt: string;
	enabled: boolean;
	lastRunAt: Date | null;
	nextRunAt: Date | null;
	lastRunStatus: AutomationRunStatus | null;
	lastErrorMessage: string | null;
	createdAt: Date;
}

export interface ToolRecord {
	id: string;
	workspaceId: string;
	name: string;
	description: string;
	kind: ToolKind;
	config: Record<string, unknown>;
	sensitive: boolean;
	enabled: boolean;
	/** Seeded per workspace, can be disabled but not deleted. */
	builtin: boolean;
	createdAt: Date;
}

export interface ApprovalRequestRecord {
	id: string;
	workspaceId: string;
	agentId: string;
	chatId: string | null;
	automationId: string | null;
	taskId: string | null;
	agentRunId: string | null;
	kind: ApprovalKind;
	skillId: string | null;
	toolId: string | null;
	mcpServerId: string | null;
	mcpToolName: string | null;
	toolLabel: string;
	input: Record<string, unknown>;
	status: ApprovalStatus;
	resultOutput: unknown;
	errorMessage: string | null;
	createdAt: Date;
	resolvedAt: Date | null;
	title: string | null;
	description: string | null;
	riskLevel: string | null;
	affectedResources: string[] | null;
	diffPreview: string | null;
}

export interface AuditLogRecord {
	id: string;
	workspaceId: string;
	agentId: string | null;
	chatId: string | null;
	automationId: string | null;
	actor: AuditActor;
	toolLabel: string;
	input: unknown;
	output: unknown;
	status: AuditStatus;
	createdAt: Date;
	inputHash: string | null;
	permissionSnapshot: Record<string, unknown> | null;
}

export interface NyxelEventRecord {
	id: string;
	workspaceId: string;
	type: NyxelEventType;
	entityType: string;
	entityId: string;
	payload: Record<string, unknown> | null;
	createdAt: Date;
}

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

export interface MemoryEntryRecord {
	id: string;
	workspaceId: string;
	type: MemoryType;
	content: string;
	source: MemorySource;
	confidence: number;
	createdByAgentId: string | null;
	expiresAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

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

export interface ArtifactRecord {
	id: string;
	workspaceId: string;
	type: ArtifactType;
	title: string;
	content: string;
	taskId: string | null;
	agentRunId: string | null;
	agentId: string | null;
	createdAt: Date;
}

export interface McpServerRecord {
	id: string;
	workspaceId: string;
	name: string;
	transport: McpTransport;
	command: string | null;
	args: string[] | null;
	url: string | null;
	/** Extra env vars passed to the spawned process for stdio servers. */
	env: Record<string, string> | null;
	/** Persisted OAuth session for http servers (dynamic client registration
	 * result + tokens) — see packages/mcp-client. Without this, restarting
	 * the server drops every previously-authorized http connector's session. */
	oauthState: Record<string, unknown> | null;
	enabled: boolean;
	createdAt: Date;
}

export interface KnowledgeBaseConfigRecord {
	workspaceId: string;
	vaultPath: string;
	obsidianRestUrl: string | null;
	obsidianApiKey: string | null;
	docsAgentEnabled: boolean;
	injectIntoPrompts: boolean;
	lastDocsSyncAt: Date | null;
	lastDocsSyncError: string | null;
	updatedAt: Date;
}

export interface ModelInstallationRecord {
	id: string;
	workspaceId: string;
	label: string;
	providerKind: ModelProviderKind;
	baseUrl: string;
	apiKey: string | null;
	modelIds: string[];
	/** Subset of modelIds hidden from the model picker without removing them —
	 * see models.setModelEnabled. */
	disabledModelIds: string[];
	enabled: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface ModelParameterRecord {
	workspaceId: string;
	modelId: string;
	customName: string | null;
	customInstructions: string | null;
	maxOutputTokens: number | null;
	temperature: number | null;
	topP: number | null;
	frequencyPenalty: number | null;
	presencePenalty: number | null;
	stopSequences: string[];
	reasoningEffort: "low" | "medium" | "high" | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface PushSubscriptionRecord {
	id: string;
	userId: string;
	endpoint: string;
	p256dh: string;
	auth: string;
	userAgent: string | null;
	createdAt: Date;
}

export interface ExtensionRecord {
	id: string;
	workspaceId: string;
	key: string;
	enabled: boolean;
	config: Record<string, unknown>;
	installedAt: Date;
}

export interface PluginRecord {
	id: string;
	workspaceId: string;
	slug: string;
	name: string;
	description: string;
	version: string | null;
	author: string | null;
	homepage: string | null;
	repoUrl: string;
	manifest: Record<string, unknown>;
	skillSlugs: string[];
	agentDefs: PluginAgentDefinition[];
	fileCount: number;
	installDir: string;
	enabled: boolean;
	/** Branch/tag/ref actually used to fetch this install. */
	ref: string;
	/** Best-effort-resolved commit SHA at install time, or null if GitHub's
	 * commit-resolve call failed. See docs/PLUGIN_SECURITY.md stage 3. */
	resolvedSha: string | null;
	/** True only if the user pinned an exact commit via `/tree/<40-hex-sha>`. */
	refPinned: boolean;
	/** Static-scan findings ("pattern: file") recorded at install time. */
	riskFindings: string[];
	createdAt: Date;
}

export interface LibraryFolderRecord {
	id: string;
	workspaceId: string;
	parentId: string | null;
	name: string;
	createdAt: Date;
}

export interface LibraryFileRecord {
	id: string;
	workspaceId: string;
	folderId: string | null;
	name: string;
	mimeType: string;
	sizeBytes: number;
	kind: LibraryItemKind;
	storageKey: string;
	createdAt: Date;
	updatedAt: Date;
}

export type VideoGenerationJobStatus = "queued" | "in_progress" | "completed" | "failed";

/** One text-to-video generation request — see apps/server/src/tools-builtin/video.ts
 * and apps/server/src/video.ts. Tracked as a row (rather than only living in
 * a single tool-call's return value) because generation runs for minutes:
 * the chat tool call polls this same job synchronously to completion, while
 * the Video Studio page reads it back out to show a history/queue instead of
 * blocking on one in-flight request. */
export interface VideoGenerationJobRecord {
	id: string;
	workspaceId: string;
	chatId: string | null;
	prompt: string;
	model: string;
	provider: string;
	status: VideoGenerationJobStatus;
	progress: number;
	size: string;
	seconds: number;
	auto: boolean;
	externalJobId: string | null;
	libraryFileId: string | null;
	posterLibraryFileId: string | null;
	errorMessage: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export type WorkflowRunStatus = "queued" | "running" | "completed" | "failed" | "partial";
export type WorkflowRunNodeStatus = "queued" | "running" | "completed" | "failed" | "skipped";
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

/** See packages/db/src/schema/sqlite/app.ts's WorkflowDefinition doc comment
 * for why this is one JSON blob rather than normalized node/edge tables. */
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
		/** Which of a source node's output handles this edge leaves from —
		 * only meaningful for multi-output kinds like "condition" (true/false).
		 * Undefined for every single-output kind. */
		sourceHandle?: string | null;
	}[];
	viewport?: { x: number; y: number; zoom: number };
}

export interface WorkflowRecord {
	id: string;
	workspaceId: string;
	name: string;
	description: string | null;
	definition: WorkflowDefinition;
	createdAt: Date;
	updatedAt: Date;
}

/** One execution of a workflow's graph — see workflow-runner.ts. Kept as its
 * own row (rather than only a return value) for the same reason
 * VideoGenerationJobRecord is: a run can take minutes, so the builder page
 * polls this back out to paint live per-node progress instead of blocking on
 * one request. */
export interface WorkflowRunRecord {
	id: string;
	workflowId: string;
	workspaceId: string;
	status: WorkflowRunStatus;
	errorMessage: string | null;
	startedAt: Date | null;
	completedAt: Date | null;
	createdAt: Date;
}

/** Per-node status/output within one WorkflowRunRecord. `nodeId` points at a
 * node inside the parent workflow's `definition.nodes` JSON, not another
 * table's primary key. */
export interface WorkflowRunNodeRecord {
	id: string;
	runId: string;
	nodeId: string;
	status: WorkflowRunNodeStatus;
	progress: number;
	libraryFileId: string | null;
	errorMessage: string | null;
	startedAt: Date | null;
	completedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface SeoProjectRecord {
	id: string;
	workspaceId: string;
	extensionId: string;
	domain: string;
	repoPath: string;
	blogConfig: { dir: string; frontmatterStyle: string } | null;
	fixerAgentId: string | null;
	reanalyzeCronExpression: string | null;
	nextReanalyzeAt: Date | null;
	lastReanalyzeAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface SeoAnalysisRunRecord {
	id: string;
	seoProjectId: string;
	workspaceId: string;
	status: SeoAnalysisRunStatus;
	score: number | null;
	pagesScanned: number;
	summary: string | null;
	errorMessage: string | null;
	startedAt: Date;
	completedAt: Date | null;
}

export interface SeoFindingRecord {
	id: string;
	runId: string;
	seoProjectId: string;
	category: SeoFindingCategory;
	severity: SeoFindingSeverity;
	title: string;
	description: string;
	recommendation: string;
	location: string | null;
	resolved: boolean;
	createdAt: Date;
}

export interface SeoBlogPostRecord {
	id: string;
	seoProjectId: string;
	workspaceId: string;
	keyword: string;
	title: string | null;
	filePath: string | null;
	status: SeoBlogPostStatus;
	taskId: string | null;
	errorMessage: string | null;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * A dialect-agnostic data access interface. `packages/db` ships one
 * implementation per SQL dialect (pg.repo.ts, sqlite.repo.ts) so the rest of
 * the app never imports drizzle table objects directly — it only ever calls
 * these methods against whichever dialect the installer picked (ADR-0002).
 * See ADR-0006 for why this is an interface rather than a shared instance.
 */
export interface DbRepository {
	readonly driver: "pg" | "sqlite";

	getOrCreateDemoUser(): Promise<{ id: string; name: string; email: string }>;
	getUser(userId: string): Promise<UserRecord | null>;
	getInstallation(): Promise<InstallationRecord | null>;
	completeInstallation(input: {
		mode: InstallationMode;
		ownerUserId: string;
		primaryWorkspaceId: string;
		appUrl?: string | null;
	}): Promise<InstallationRecord>;

	createWorkspace(input: {
		userId: string;
		name: string;
	}): Promise<WorkspaceRecord>;
	listWorkspacesByUser(userId: string): Promise<WorkspaceRecord[]>;
	listWorkspaces(): Promise<WorkspaceRecord[]>;
	getWorkspace(workspaceId: string): Promise<WorkspaceRecord | null>;
	updateWorkspaceSettings(input: {
		workspaceId: string;
		name?: string;
		customInstructions?: string | null;
		icon?: string | null;
		color?: string | null;
		defaultModelId?: string | null;
		defaultAutonomyLevel?: AgentAutonomyLevel;
		defaultToolPolicy?: ChatToolPolicy;
	}): Promise<WorkspaceRecord>;

	createModelInstallation(input: {
		workspaceId: string;
		label: string;
		providerKind: ModelProviderKind;
		baseUrl: string;
		apiKey?: string | null;
		modelIds: string[];
		disabledModelIds?: string[];
		enabled?: boolean;
	}): Promise<ModelInstallationRecord>;
	listModelInstallationsByWorkspace(
		workspaceId: string,
	): Promise<ModelInstallationRecord[]>;
	getModelInstallation(id: string): Promise<ModelInstallationRecord | null>;
	updateModelInstallation(input: {
		id: string;
		label?: string;
		modelIds?: string[];
		disabledModelIds?: string[];
		enabled?: boolean;
	}): Promise<ModelInstallationRecord>;
	deleteModelInstallation(id: string): Promise<void>;

	getModelParameter(
		workspaceId: string,
		modelId: string,
	): Promise<ModelParameterRecord | null>;
	upsertModelParameter(input: {
		workspaceId: string;
		modelId: string;
		customName?: string | null;
		customInstructions?: string | null;
		maxOutputTokens?: number | null;
		temperature?: number | null;
		topP?: number | null;
		frequencyPenalty?: number | null;
		presencePenalty?: number | null;
		stopSequences?: string[];
		reasoningEffort?: "low" | "medium" | "high" | null;
	}): Promise<ModelParameterRecord>;
	deleteModelParameter(workspaceId: string, modelId: string): Promise<void>;

	createPushSubscription(input: {
		userId: string;
		endpoint: string;
		p256dh: string;
		auth: string;
		userAgent?: string | null;
	}): Promise<PushSubscriptionRecord>;
	listPushSubscriptionsByUser(userId: string): Promise<PushSubscriptionRecord[]>;
	deletePushSubscriptionByEndpoint(endpoint: string): Promise<void>;

	createChat(input: {
		workspaceId: string;
		workingDirectory: string;
		title: string;
		modelId: string;
		agentId?: string | null;
		projectId?: string | null;
		toolMode?: ChatToolMode;
		toolPolicy?: ChatToolPolicy;
	}): Promise<ChatRecord>;
	listChatsByWorkspace(workspaceId: string): Promise<ChatRecord[]>;
	listArchivedChatsByWorkspace(workspaceId: string): Promise<ChatRecord[]>;
	listChatsByProject(projectId: string): Promise<ChatRecord[]>;
	getChat(chatId: string): Promise<ChatRecord | null>;
	getChatByShareId(shareId: string): Promise<ChatRecord | null>;
	renameChat(chatId: string, title: string): Promise<ChatRecord>;
	setChatArchived(chatId: string, archived: boolean): Promise<ChatRecord>;
	setChatPinned(chatId: string, pinned: boolean): Promise<ChatRecord>;
	setChatProject(chatId: string, projectId: string | null): Promise<ChatRecord>;
	/** Turning sharing on assigns a share token the first time (idempotent
	 * afterwards); turning it off clears the token so the old link 404s. */
	setChatShared(chatId: string, shared: boolean): Promise<ChatRecord>;
	/** Clones a chat (and its messages) into a new chat in the same
	 * workspace/project — the "Duplizieren" sidebar action. The duplicate is
	 * never pinned/shared/archived even if the source was. */
	duplicateChat(chatId: string): Promise<ChatRecord>;
	deleteChat(chatId: string): Promise<void>;
	/** Re-points a chat at a different agent — used when a chat's skill/MCP
	 * selection is edited mid-conversation: rather than mutating a shared
	 * agent (which could be reused by other chats), the caller forks a new
	 * one-off agent and calls this to bind the chat to it going forward. */
	updateChatAgent(chatId: string, agentId: string | null): Promise<ChatRecord>;
	updateChatToolPolicy(input: {
		chatId: string;
		toolMode: ChatToolMode;
		toolPolicy: ChatToolPolicy;
	}): Promise<ChatRecord>;

	createProject(input: {
		workspaceId: string;
		name: string;
		color?: string;
		icon?: string;
	}): Promise<ProjectRecord>;
	listProjectsByWorkspace(workspaceId: string): Promise<ProjectRecord[]>;
	getProject(projectId: string): Promise<ProjectRecord | null>;
	renameProject(projectId: string, name: string): Promise<ProjectRecord>;
	setProjectAppearance(
		projectId: string,
		appearance: { color: string; icon: string },
	): Promise<ProjectRecord>;
	/** Deletes the project itself; member chats are kept and simply fall back
	 * to projectId null (see the "set null" FK in packages/db/src/schema). */
	deleteProject(projectId: string): Promise<void>;
	/** Clones a project and every chat (with messages) filed under it — the
	 * "Duplizieren" action on a project row. */
	duplicateProject(projectId: string): Promise<ProjectRecord>;

	addMessage(input: {
		chatId: string;
		role: MessageRole;
		content: string;
	} & Partial<MessageUsage>): Promise<MessageRecord>;
	/** Ordered oldest-first by createdAt — callers (chat-stream.ts's history
	 * replay, edit/regenerate truncation) depend on this order. */
	listMessages(chatId: string): Promise<MessageRecord[]>;
	/** Every message across every chat in the workspace (joins through chat),
	 * newest first — powers the detailed statistics dashboard. `since` limits
	 * to messages created on/after that instant. */
	listMessagesByWorkspace(
		workspaceId: string,
		options?: { since?: Date },
	): Promise<MessageRecord[]>;
	/** Rewrites a message's content in place — used by the "edit" action on a
	 * past user turn (see chat-stream.ts's editMessageId handling). */
	updateMessage(id: string, content: string): Promise<MessageRecord>;
	deleteMessage(id: string): Promise<void>;
	/** Deletes every message in the chat that comes after messageId (by
	 * createdAt order) — used to drop the stale reply/turns that followed an
	 * edited message before regenerating from it. */
	deleteMessagesAfter(chatId: string, messageId: string): Promise<void>;

	createAgent(input: {
		workspaceId: string;
		name: string;
		systemPrompt?: string | null;
		role?: string | null;
		goalTemplate?: string | null;
		modelId: string;
		autonomyLevel?: AgentAutonomyLevel;
		mcpServerIds?: string[];
		toolIds?: string[];
		skillIds?: string[];
		mcpToolFilter?: string[] | null;
		delegateAgentIds?: string[];
	}): Promise<AgentRecord>;
	listAgentsByWorkspace(workspaceId: string): Promise<AgentRecord[]>;
	getAgent(agentId: string): Promise<AgentRecord | null>;
	updateAgent(
		agentId: string,
		input: {
			name?: string;
			systemPrompt?: string | null;
			role?: string | null;
			goalTemplate?: string | null;
			modelId?: string;
			autonomyLevel?: AgentAutonomyLevel;
			mcpServerIds?: string[];
			toolIds?: string[];
			skillIds?: string[];
			mcpToolFilter?: string[] | null;
			delegateAgentIds?: string[];
		},
	): Promise<AgentRecord>;
	/** Cascades to the agent's own runs/approvals/task-links per the schema's
	 * onDelete rules; callers must check for referencing automations
	 * themselves first (see agents.delete in the router — automations require
	 * a non-null agentId, so a cascade there would silently destroy them). */
	deleteAgent(agentId: string): Promise<void>;
	/** Bulk-removes one-off agents forked for a single chat's tool selection
	 * (name "Chat — custom tools") that no chat currently points at — cleans
	 * up the pile that builds up from repeatedly tweaking a chat's tool
	 * toolbar. Returns the number deleted. */
	deleteUnusedChatAgents(workspaceId: string): Promise<number>;
	/** Same "unused" definition as deleteUnusedChatAgents but read-only — lets
	 * the UI show an accurate count before the user commits to deleting, since
	 * not every agent named "Chat — custom tools" is actually orphaned. */
	listUnusedChatAgentIds(workspaceId: string): Promise<string[]>;

	createTask(input: {
		workspaceId: string;
		parentTaskId?: string | null;
		sourceChatId?: string | null;
		createdByAgentId?: string | null;
		assignedAgentId?: string | null;
		title: string;
		instruction: string;
		modelId?: string | null;
		status?: TaskStatus;
		priority?: TaskPriority;
		requiresApproval?: boolean;
		input?: Record<string, unknown>;
		plan?: Record<string, unknown> | null;
		handoff?: Record<string, unknown> | null;
		resultSummary?: string | null;
		errorMessage?: string | null;
		startedAt?: Date | null;
		completedAt?: Date | null;
	}): Promise<TaskRecord>;
	listTasksByWorkspace(
		workspaceId: string,
		input?: { status?: TaskStatus; assignedAgentId?: string | null },
	): Promise<TaskRecord[]>;
	getTask(taskId: string): Promise<TaskRecord | null>;
	listTaskTree(parentTaskId: string): Promise<TaskRecord[]>;
	updateTask(
		taskId: string,
		input: {
			assignedAgentId?: string | null;
			modelId?: string | null;
			status?: TaskStatus;
			priority?: TaskPriority;
			requiresApproval?: boolean;
			plan?: Record<string, unknown> | null;
			handoff?: Record<string, unknown> | null;
			resultSummary?: string | null;
			errorMessage?: string | null;
			startedAt?: Date | null;
			completedAt?: Date | null;
		},
	): Promise<TaskRecord>;
	claimNextTaskForAgent(
		workspaceId: string,
		agentId: string,
	): Promise<TaskRecord | null>;

	createTaskEvent(input: {
		taskId: string;
		workspaceId: string;
		agentRunId?: string | null;
		agentId?: string | null;
		kind: TaskEventKind;
		message: string;
		payload?: Record<string, unknown> | null;
	}): Promise<TaskEventRecord>;
	listTaskEvents(taskId: string): Promise<TaskEventRecord[]>;

	/** No agent acts on a goal automatically — it is purely a record for the
	 * user to track long-term outcomes. Linking goals to tasks/runs/workflows
	 * is future work (see ADR/roadmap, not implemented in v1). */
	createGoal(input: {
		workspaceId: string;
		title: string;
		description?: string | null;
		status?: GoalStatus;
		priority?: TaskPriority;
	}): Promise<GoalRecord>;
	listGoalsByWorkspace(workspaceId: string): Promise<GoalRecord[]>;
	getGoal(goalId: string): Promise<GoalRecord | null>;
	updateGoalStatus(goalId: string, status: GoalStatus): Promise<GoalRecord>;

	addMilestone(input: {
		goalId: string;
		workspaceId: string;
		title: string;
		order?: number;
	}): Promise<GoalMilestoneRecord>;
	listMilestonesByGoal(goalId: string): Promise<GoalMilestoneRecord[]>;
	getMilestone(milestoneId: string): Promise<GoalMilestoneRecord | null>;
	updateMilestoneStatus(
		milestoneId: string,
		status: GoalMilestoneStatus,
	): Promise<GoalMilestoneRecord>;

	createGoalProgressEvent(input: {
		goalId: string;
		workspaceId: string;
		kind: GoalEventKind;
		message: string;
		payload?: Record<string, unknown> | null;
	}): Promise<GoalProgressEventRecord>;
	listGoalProgressEvents(goalId: string): Promise<GoalProgressEventRecord[]>;

	createAgentRun(input: {
		workspaceId: string;
		taskId?: string | null;
		agentId: string;
		chatId?: string | null;
		automationId?: string | null;
		trigger: AgentRunTrigger;
		modelId?: string | null;
		stepCount?: number;
		status?: AgentRunStatus;
		finalOutput?: string | null;
		errorMessage?: string | null;
		startedAt?: Date | null;
		completedAt?: Date | null;
	}): Promise<AgentRunRecord>;
	getAgentRun(id: string): Promise<AgentRunRecord | null>;
	/** Every run in the workspace regardless of status, newest first —
	 * powers the detailed statistics dashboard's run-status breakdown.
	 * `since` limits to runs created on/after that instant. */
	listAgentRunsByWorkspace(
		workspaceId: string,
		options?: { since?: Date },
	): Promise<AgentRunRecord[]>;
	listAgentRunsByTask(taskId: string): Promise<AgentRunRecord[]>;
	/** Most recent first — powers the agent detail page's run history. */
	listAgentRunsByAgent(agentId: string): Promise<AgentRunRecord[]>;
	/** Runs with status "pending" | "running" | "waiting_approval" — powers
	 * the "currently running" indicator on the agents list page. */
	listActiveAgentRunsByWorkspace(workspaceId: string): Promise<AgentRunRecord[]>;
	updateAgentRun(
		id: string,
		input: {
			stepCount?: number;
			status?: AgentRunStatus;
			finalOutput?: string | null;
			errorMessage?: string | null;
			startedAt?: Date | null;
			completedAt?: Date | null;
		},
	): Promise<AgentRunRecord>;

	createMcpServer(input: {
		workspaceId: string;
		name: string;
		transport: McpTransport;
		command?: string | null;
		args?: string[] | null;
		url?: string | null;
		env?: Record<string, string> | null;
	}): Promise<McpServerRecord>;
	listMcpServersByWorkspace(workspaceId: string): Promise<McpServerRecord[]>;
	getMcpServer(id: string): Promise<McpServerRecord | null>;
	deleteMcpServer(id: string): Promise<void>;
	updateMcpServerOAuthState(
		id: string,
		oauthState: Record<string, unknown>,
	): Promise<void>;

	getKnowledgeBaseConfig(
		workspaceId: string,
	): Promise<KnowledgeBaseConfigRecord | null>;
	listKnowledgeBaseConfigs(): Promise<KnowledgeBaseConfigRecord[]>;
	upsertKnowledgeBaseConfig(input: {
		workspaceId: string;
		vaultPath: string;
		obsidianRestUrl?: string | null;
		obsidianApiKey?: string | null;
		docsAgentEnabled?: boolean;
		injectIntoPrompts?: boolean;
	}): Promise<KnowledgeBaseConfigRecord>;
	updateKnowledgeBaseSyncStatus(input: {
		workspaceId: string;
		lastDocsSyncAt?: Date | null;
		lastDocsSyncError?: string | null;
	}): Promise<KnowledgeBaseConfigRecord>;

	createAutomation(input: {
		workspaceId: string;
		/** Exactly one of agentId/workflowId, matching targetKind. */
		agentId?: string | null;
		workflowId?: string | null;
		targetKind?: AutomationTargetKind;
		name: string;
		triggerType?: AutomationTriggerType;
		cronExpression?: string;
		watchPath?: string | null;
		watchGlob?: string | null;
		prompt?: string;
		enabled?: boolean;
		nextRunAt?: Date | null;
	}): Promise<AutomationRecord>;
	listAutomationsByWorkspace(workspaceId: string): Promise<AutomationRecord[]>;
	listDueAutomations(now: Date): Promise<AutomationRecord[]>;
	/** Enabled automations with triggerType "file_watch" — polled by the
	 * scheduler independently of listDueAutomations (which is nextRunAt/cron
	 * only). See ADR-0013. */
	listFileWatchAutomations(): Promise<AutomationRecord[]>;
	getAutomation(id: string): Promise<AutomationRecord | null>;
	updateAutomationRun(input: {
		id: string;
		lastRunAt: Date;
		nextRunAt: Date | null;
		lastRunStatus?: AutomationRunStatus;
		lastErrorMessage?: string | null;
	}): Promise<AutomationRecord>;
	setAutomationNextRun(
		id: string,
		nextRunAt: Date | null,
	): Promise<AutomationRecord>;
	setAutomationEnabled(id: string, enabled: boolean): Promise<AutomationRecord>;
	setAutomationWatchCheckedAt(
		id: string,
		lastWatchCheckAt: Date,
	): Promise<AutomationRecord>;
	/** Edits an existing automation's config without touching its run history
	 * (lastRunAt/lastRunStatus/etc). Callers recompute nextRunAt themselves
	 * when the cron expression changes. */
	updateAutomation(
		id: string,
		patch: {
			name?: string;
			agentId?: string;
			workflowId?: string;
			cronExpression?: string;
			watchPath?: string | null;
			watchGlob?: string | null;
			prompt?: string;
			nextRunAt?: Date | null;
		},
	): Promise<AutomationRecord>;
	deleteAutomation(id: string): Promise<void>;

	createTool(input: {
		workspaceId: string;
		name: string;
		description: string;
		kind: ToolKind;
		config: Record<string, unknown>;
		sensitive?: boolean;
		enabled?: boolean;
		/** Only ever passed by tools-builtin-seed.ts — never user-settable. */
		builtin?: boolean;
	}): Promise<ToolRecord>;
	listToolsByWorkspace(workspaceId: string): Promise<ToolRecord[]>;
	getTool(id: string): Promise<ToolRecord | null>;
	setToolEnabled(id: string, enabled: boolean): Promise<ToolRecord>;
	/** Throws if the tool is builtin (seeded, non-deletable) — see
	 * tools-builtin-seed.ts. */
	deleteTool(id: string): Promise<void>;

	createApprovalRequest(input: {
		workspaceId: string;
		agentId: string;
		chatId?: string | null;
		automationId?: string | null;
		taskId?: string | null;
		agentRunId?: string | null;
		kind: ApprovalKind;
		skillId?: string | null;
		toolId?: string | null;
		mcpServerId?: string | null;
		mcpToolName?: string | null;
		toolLabel: string;
		input: Record<string, unknown>;
		title?: string | null;
		description?: string | null;
		riskLevel?: string | null;
		affectedResources?: string[] | null;
		diffPreview?: string | null;
	}): Promise<ApprovalRequestRecord>;
	listApprovalsByWorkspace(
		workspaceId: string,
		status?: ApprovalStatus,
	): Promise<ApprovalRequestRecord[]>;
	getApprovalRequest(id: string): Promise<ApprovalRequestRecord | null>;
	resolveApprovalRequest(input: {
		id: string;
		status: "approved" | "rejected";
		resultOutput?: unknown;
		errorMessage?: string | null;
	}): Promise<ApprovalRequestRecord>;

	createAuditLog(input: {
		workspaceId: string;
		agentId?: string | null;
		chatId?: string | null;
		automationId?: string | null;
		actor: AuditActor;
		toolLabel: string;
		input?: unknown;
		output?: unknown;
		status: AuditStatus;
		inputHash?: string | null;
		permissionSnapshot?: Record<string, unknown> | null;
	}): Promise<AuditLogRecord>;
	listAuditLogByWorkspace(
		workspaceId: string,
		limit?: number,
	): Promise<AuditLogRecord[]>;

	createNyxelEvent(input: {
		workspaceId: string;
		type: NyxelEventType;
		entityType: string;
		entityId: string;
		payload?: Record<string, unknown> | null;
	}): Promise<NyxelEventRecord>;
	listNyxelEventsByWorkspace(
		workspaceId: string,
		limit?: number,
	): Promise<NyxelEventRecord[]>;

	createMemoryEntry(input: {
		workspaceId: string;
		type: MemoryType;
		content: string;
		source: MemorySource;
		confidence?: number;
		createdByAgentId?: string | null;
		expiresAt?: Date | null;
	}): Promise<MemoryEntryRecord>;
	listMemoryEntriesByWorkspace(
		workspaceId: string,
		type?: MemoryType,
	): Promise<MemoryEntryRecord[]>;
	getMemoryEntry(id: string): Promise<MemoryEntryRecord | null>;
	updateMemoryEntry(
		id: string,
		input: { content?: string; confidence?: number; expiresAt?: Date | null },
	): Promise<MemoryEntryRecord>;
	deleteMemoryEntry(id: string): Promise<void>;

	createArtifact(input: {
		workspaceId: string;
		type: ArtifactType;
		title: string;
		content: string;
		taskId?: string | null;
		agentRunId?: string | null;
		agentId?: string | null;
	}): Promise<ArtifactRecord>;
	listArtifactsByWorkspace(workspaceId: string): Promise<ArtifactRecord[]>;
	listArtifactsByTask(taskId: string): Promise<ArtifactRecord[]>;
	getArtifact(id: string): Promise<ArtifactRecord | null>;

	installExtension(input: {
		workspaceId: string;
		key: string;
		config?: Record<string, unknown>;
	}): Promise<ExtensionRecord>;
	listExtensionsByWorkspace(workspaceId: string): Promise<ExtensionRecord[]>;
	getExtension(id: string): Promise<ExtensionRecord | null>;
	getExtensionByKey(
		workspaceId: string,
		key: string,
	): Promise<ExtensionRecord | null>;
	setExtensionEnabled(id: string, enabled: boolean): Promise<ExtensionRecord>;
	updateExtensionConfig(
		id: string,
		config: Record<string, unknown>,
	): Promise<ExtensionRecord>;
	uninstallExtension(id: string): Promise<void>;

	createPlugin(input: {
		workspaceId: string;
		slug: string;
		name: string;
		description: string;
		version?: string | null;
		author?: string | null;
		homepage?: string | null;
		repoUrl: string;
		manifest: Record<string, unknown>;
		skillSlugs: string[];
		agentDefs: PluginAgentDefinition[];
		fileCount: number;
		installDir: string;
		ref: string;
		resolvedSha: string | null;
		refPinned: boolean;
		riskFindings: string[];
	}): Promise<PluginRecord>;
	listPluginsByWorkspace(workspaceId: string): Promise<PluginRecord[]>;
	getPlugin(id: string): Promise<PluginRecord | null>;
	getPluginBySlug(workspaceId: string, slug: string): Promise<PluginRecord | null>;
	setPluginEnabled(id: string, enabled: boolean): Promise<PluginRecord>;
	deletePlugin(id: string): Promise<void>;

	createLibraryFolder(input: {
		workspaceId: string;
		parentId: string | null;
		name: string;
	}): Promise<LibraryFolderRecord>;
	listLibraryFoldersByWorkspace(workspaceId: string): Promise<LibraryFolderRecord[]>;
	getLibraryFolder(id: string): Promise<LibraryFolderRecord | null>;
	renameLibraryFolder(id: string, name: string): Promise<LibraryFolderRecord>;
	moveLibraryFolder(id: string, parentId: string | null): Promise<LibraryFolderRecord>;
	deleteLibraryFolder(id: string): Promise<void>;

	createLibraryFile(input: {
		workspaceId: string;
		folderId: string | null;
		name: string;
		mimeType: string;
		sizeBytes: number;
		kind: LibraryItemKind;
		storageKey: string;
	}): Promise<LibraryFileRecord>;
	listLibraryFilesByWorkspace(workspaceId: string): Promise<LibraryFileRecord[]>;
	getLibraryFile(id: string): Promise<LibraryFileRecord | null>;
	renameLibraryFile(id: string, name: string): Promise<LibraryFileRecord>;
	moveLibraryFile(id: string, folderId: string | null): Promise<LibraryFileRecord>;
	deleteLibraryFile(id: string): Promise<void>;

	createVideoGenerationJob(input: {
		workspaceId: string;
		chatId: string | null;
		prompt: string;
		model: string;
		provider: string;
		size: string;
		seconds: number;
		auto: boolean;
	}): Promise<VideoGenerationJobRecord>;
	listVideoGenerationJobsByWorkspace(workspaceId: string): Promise<VideoGenerationJobRecord[]>;
	getVideoGenerationJob(id: string): Promise<VideoGenerationJobRecord | null>;
	updateVideoGenerationJob(
		id: string,
		patch: Partial<{
			status: VideoGenerationJobStatus;
			progress: number;
			externalJobId: string | null;
			libraryFileId: string | null;
			posterLibraryFileId: string | null;
			errorMessage: string | null;
		}>,
	): Promise<VideoGenerationJobRecord>;

	createWorkflow(input: {
		workspaceId: string;
		name: string;
		description?: string | null;
		definition: WorkflowDefinition;
	}): Promise<WorkflowRecord>;
	listWorkflowsByWorkspace(workspaceId: string): Promise<WorkflowRecord[]>;
	getWorkflow(id: string): Promise<WorkflowRecord | null>;
	updateWorkflow(
		id: string,
		patch: Partial<{
			name: string;
			description: string | null;
			definition: WorkflowDefinition;
		}>,
	): Promise<WorkflowRecord>;
	deleteWorkflow(id: string): Promise<void>;

	createWorkflowRun(input: {
		workflowId: string;
		workspaceId: string;
	}): Promise<WorkflowRunRecord>;
	getWorkflowRun(id: string): Promise<WorkflowRunRecord | null>;
	listWorkflowRunsByWorkflow(workflowId: string): Promise<WorkflowRunRecord[]>;
	updateWorkflowRun(
		id: string,
		patch: Partial<{
			status: WorkflowRunStatus;
			errorMessage: string | null;
			startedAt: Date | null;
			completedAt: Date | null;
		}>,
	): Promise<WorkflowRunRecord>;

	createWorkflowRunNode(input: {
		runId: string;
		nodeId: string;
	}): Promise<WorkflowRunNodeRecord>;
	listWorkflowRunNodesByRun(runId: string): Promise<WorkflowRunNodeRecord[]>;
	updateWorkflowRunNode(
		id: string,
		patch: Partial<{
			status: WorkflowRunNodeStatus;
			progress: number;
			libraryFileId: string | null;
			errorMessage: string | null;
			startedAt: Date | null;
			completedAt: Date | null;
		}>,
	): Promise<WorkflowRunNodeRecord>;

	createSeoProject(input: {
		workspaceId: string;
		extensionId: string;
		domain: string;
		repoPath: string;
	}): Promise<SeoProjectRecord>;
	listSeoProjectsByWorkspace(workspaceId: string): Promise<SeoProjectRecord[]>;
	getSeoProject(id: string): Promise<SeoProjectRecord | null>;
	updateSeoProject(
		id: string,
		patch: {
			domain?: string;
			repoPath?: string;
			blogConfig?: { dir: string; frontmatterStyle: string } | null;
			fixerAgentId?: string | null;
			reanalyzeCronExpression?: string | null;
			nextReanalyzeAt?: Date | null;
			lastReanalyzeAt?: Date | null;
		},
	): Promise<SeoProjectRecord>;
	deleteSeoProject(id: string): Promise<void>;
	/** Enabled recurring re-analysis whose nextReanalyzeAt has passed — polled
	 * by the scheduler's tick alongside due automations. */
	listDueSeoProjects(now: Date): Promise<SeoProjectRecord[]>;

	createSeoAnalysisRun(input: {
		seoProjectId: string;
		workspaceId: string;
	}): Promise<SeoAnalysisRunRecord>;
	getSeoAnalysisRun(id: string): Promise<SeoAnalysisRunRecord | null>;
	/** Most recent first. */
	listSeoAnalysisRunsByProject(
		seoProjectId: string,
	): Promise<SeoAnalysisRunRecord[]>;
	updateSeoAnalysisRun(
		id: string,
		patch: {
			status?: SeoAnalysisRunStatus;
			score?: number | null;
			pagesScanned?: number;
			summary?: string | null;
			errorMessage?: string | null;
			completedAt?: Date | null;
		},
	): Promise<SeoAnalysisRunRecord>;

	createSeoFinding(input: {
		runId: string;
		seoProjectId: string;
		category: SeoFindingCategory;
		severity: SeoFindingSeverity;
		title: string;
		description: string;
		recommendation: string;
		location?: string | null;
	}): Promise<SeoFindingRecord>;
	listSeoFindingsByRun(runId: string): Promise<SeoFindingRecord[]>;
	/** Unresolved findings across every run for the project, newest first. */
	listOpenSeoFindingsByProject(
		seoProjectId: string,
	): Promise<SeoFindingRecord[]>;
	/** Every finding ever detected for the project (resolved and open), newest
	 * first — used for historical stats (resolution rate, category/severity
	 * totals over time) rather than "what needs attention now". */
	listSeoFindingsByProject(seoProjectId: string): Promise<SeoFindingRecord[]>;
	getSeoFinding(id: string): Promise<SeoFindingRecord | null>;
	setSeoFindingResolved(id: string, resolved: boolean): Promise<SeoFindingRecord>;

	createSeoBlogPost(input: {
		seoProjectId: string;
		workspaceId: string;
		keyword: string;
	}): Promise<SeoBlogPostRecord>;
	listSeoBlogPostsByProject(
		seoProjectId: string,
	): Promise<SeoBlogPostRecord[]>;
	getSeoBlogPost(id: string): Promise<SeoBlogPostRecord | null>;
	updateSeoBlogPost(
		id: string,
		patch: {
			title?: string | null;
			filePath?: string | null;
			status?: SeoBlogPostStatus;
			taskId?: string | null;
			errorMessage?: string | null;
		},
	): Promise<SeoBlogPostRecord>;
}
