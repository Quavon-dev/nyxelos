import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { getServerUrl } from "./server-url";

const SERVER_URL = getServerUrl();

export type ModelSummary = {
	id: string;
	label: string;
	kind: "local" | "cloud" | "custom";
	provider: string;
	providerLabel: string;
};

export type AutonomyLevel = "chat" | "assisted" | "autonomous" | "super_agent";
export type McpTransportKind = "stdio" | "http";
export type InstallationMode = "pc" | "server";

type DemoUser = {
	id: string;
	name: string;
	email: string;
};

export type InstallationSummary = {
	id: string;
	mode: InstallationMode;
	ownerUserId: string;
	primaryWorkspaceId: string;
	appUrl: string | null;
	createdAt: Date;
	updatedAt: Date;
};

export type InstallationStatus = {
	isInstalled: boolean;
	driver: "pg" | "sqlite";
	recommendedMode: InstallationMode;
	defaultAppUrl: string;
	defaultWorkingDirectory: string;
	record: InstallationSummary | null;
};

export type WorkspaceSummary = {
	id: string;
	name: string;
	customInstructions: string | null;
	icon: string | null;
	color: string | null;
	defaultModelId: string | null;
	defaultAutonomyLevel: AutonomyLevel;
	defaultToolPolicy: ChatToolPolicy;
};

export type ChatToolMode = "default" | "automatic" | "auto";

export type ChatToolPolicy = {
	mode: ChatToolMode;
	approveFileWrites: boolean;
	approveFileDeletes: boolean;
	approveCustomCode: boolean;
	approveMcpTools: boolean;
};

export const DEFAULT_CHAT_TOOL_POLICY: ChatToolPolicy = {
	mode: "default",
	approveFileWrites: true,
	approveFileDeletes: true,
	approveCustomCode: true,
	approveMcpTools: true,
};

export type ChatSummary = {
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
};

export type ProjectSummary = {
	id: string;
	workspaceId: string;
	name: string;
	color: string;
	icon: string;
	createdAt: Date;
};

type MessageSummary = {
	id: string;
	chatId: string;
	role: "user" | "assistant" | "system" | "tool";
	content: string;
	createdAt: Date;
};

export type AgentSummary = {
	id: string;
	workspaceId: string;
	name: string;
	systemPrompt: string | null;
	role: string | null;
	goalTemplate: string | null;
	modelId: string;
	autonomyLevel: AutonomyLevel;
	/** Real runtime skills (packages/skills-sdk), process-wide and read-only. */
	skillIds: string[];
	/** DB-backed, workspace-configurable tools — see tools.* below. */
	toolIds: string[];
	mcpServerIds: string[];
	/** Entries shaped "serverId::toolName"; null means every tool from every
	 * server in mcpServerIds. */
	mcpToolFilter: string[] | null;
	delegateAgentIds: string[];
	createdAt: Date;
};

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
export type AgentRunTrigger = "chat" | "task" | "automation" | "delegate";
export type AgentRunStatus =
	| "pending"
	| "running"
	| "waiting_approval"
	| "completed"
	| "failed"
	| "cancelled";

export type TaskSummary = {
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
};

export type TaskEventSummary = {
	id: string;
	taskId: string;
	workspaceId: string;
	agentRunId: string | null;
	agentId: string | null;
	kind: TaskEventKind;
	message: string;
	payload: Record<string, unknown> | null;
	createdAt: Date;
};

export type AgentRunSummary = {
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
};

export type TaskDetail = {
	task: TaskSummary | null;
	children: TaskSummary[];
	events: TaskEventSummary[];
	runs: AgentRunSummary[];
};

export type ModelCapabilities = {
	nativeImageInput: boolean;
	nativeDocumentInput: boolean;
};

export type UserSummary = {
	id: string;
	name: string;
	email: string;
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
	| "generate_image";

export type ToolCategory = "edit" | "read" | "search" | "execute" | "browser" | "web";

/** Mirrors apps/server/src/tools-dynamic.ts's TOOL_KIND_CATEGORY — the
 * single source of truth is the backend; this copy is for client-side
 * grouping/rendering only. */
export const TOOL_KIND_CATEGORY: Record<ToolKind, ToolCategory> = {
	http_fetch: "web",
	file_read: "read",
	file_write: "edit",
	file_list: "search",
	file_delete: "edit",
	kb_search: "search",
	custom_code: "execute",
	file_create: "edit",
	file_patch: "edit",
	file_move: "edit",
	directory_create: "edit",
	notebook_edit: "edit",
	file_stat: "read",
	file_view_image: "read",
	notebook_summary: "read",
	notebook_cell_output: "read",
	terminal_last_command: "read",
	terminal_output: "read",
	problems: "read",
	file_search: "search",
	text_search: "search",
	usages: "search",
	codebase_search: "search",
	changes: "search",
	terminal_run: "execute",
	terminal_send_input: "execute",
	terminal_kill: "execute",
	task_run: "execute",
	test_run: "execute",
	browser_navigate: "browser",
	browser_click: "browser",
	browser_drag: "browser",
	browser_hover: "browser",
	browser_type: "browser",
	browser_handle_dialog: "browser",
	browser_screenshot: "browser",
	browser_read_page: "browser",
	browser_run_playwright_code: "browser",
	github_repo_fetch: "web",
	github_code_search: "web",
	generate_image: "web",
};

/** A DB-backed, workspace-configurable tool (the old "Skills" tab concept —
 * see docs/frontend-migration-tools-vs-skills.md). `builtin` tools are
 * seeded per workspace and can be disabled but not deleted. */
export type ToolSummary = {
	id: string;
	name: string;
	description: string;
	permissions: { network: string[]; filesystem: string[] };
	sensitive: boolean;
	enabled: boolean;
	source: "workspace";
	kind: ToolKind;
	builtin: boolean;
};

/** A real skill — process-wide/hand-written (source: "builtin", read-only),
 * a workspace's own file-based skill (source: "file", created/edited/deleted
 * from the Skills page — a real markdown file with frontmatter, matching
 * Anthropic's Agent Skills format), or a folder-based bundle contributed by
 * an installed plugin (source: "plugin" — see PluginSummary). */
export type SkillSummary = {
	id: string;
	name: string;
	description: string;
	permissions: { network: string[]; filesystem: string[] };
	sensitive: boolean;
	enabled: boolean;
	source: "builtin" | "file" | "plugin";
	/** Only set for source: "file". */
	slug?: string;
	/** Only set for source: "file" — the skill's markdown body. */
	body?: string;
	/** Only set for source: "plugin". */
	pluginId?: string;
	pluginName?: string;
};

/** One SKILL.md hit from searching the known skill libraries on GitHub —
 * `rawUrl` is what gets passed to `skills.importFromUrl`. */
export type SkillLibraryResult = {
	name: string;
	description: string;
	repo: string;
	path: string;
	rawUrl: string;
	htmlUrl: string;
};

/** A sub-agent bundled in a plugin's agents/*.md directory — parsed for
 * display only, see PluginSummary. */
export type PluginAgentDefinition = {
	slug: string;
	name: string;
	description: string;
	body: string;
};

/** An installed plugin — a full folder-based bundle (Claude Code plugin
 * format: .claude-plugin/plugin.json + skills/ + agents/ + arbitrary
 * supporting files) pulled whole from a GitHub repo, as opposed to the
 * single-file skills above. See apps/server/src/plugins.ts. */
export type PluginSummary = {
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
	createdAt: Date;
};

export type InstallPluginResult = {
	plugin: PluginSummary;
	skills: { id: string; name: string; description: string }[];
	skippedFiles: string[];
};

export type AutomationTriggerType = "cron" | "file_watch";
export type AutomationRunStatus = "success" | "error" | "pending_approval";

export type AutomationSummary = {
	id: string;
	workspaceId: string;
	agentId: string;
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
};

export type ApprovalStatus = "pending" | "approved" | "rejected";
export type ApprovalKind = "skill" | "tool" | "mcp";

export type ApprovalSummary = {
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
};

export type AuditActor = "chat" | "automation" | "approval" | "delegate";
export type AuditStatus = "success" | "error" | "pending_approval" | "rejected";

export type AuditLogSummary = {
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
};

export type McpConnectorConfigField = {
	key: string;
	label: string;
	description?: string;
	placeholder?: string;
	kind: "secret-file" | "secret-value";
	envVar: string;
};

export type McpConnectorCatalogEntry = {
	key: string;
	name: string;
	description: string;
	category: string;
	transport?: "http" | "stdio";
	url?: string;
	command?: string;
	args?: string[];
	configFields?: McpConnectorConfigField[];
};

export type McpServerSummary = {
	id: string;
	workspaceId: string;
	name: string;
	transport: McpTransportKind;
	command: string | null;
	args: string[] | null;
	url: string | null;
	enabled: boolean;
	createdAt: Date;
};

export type McpToolSummary = {
	serverId: string;
	serverName: string;
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
};

export type McpToolListResult =
	| {
			status: "ready";
			tools: McpToolSummary[];
	  }
	| {
			status: "auth_required";
			authorizationUrl: string;
			callbackUrl: string;
			message: string;
	  }
	| {
			status: "invalid_config";
			message: string;
	  };

export type ExtensionCatalogEntry = {
	key: string;
	name: string;
	description: string;
	category: string;
	icon: string;
	route: string;
};

export type ExtensionSummary = {
	id: string;
	workspaceId: string;
	key: string;
	enabled: boolean;
	config: Record<string, unknown>;
	installedAt: Date;
};

export type SeoAnalysisRunStatus = "running" | "completed" | "failed";
export type SeoFindingCategory = "seo" | "geo" | "aeo";
export type SeoFindingSeverity = "info" | "warning" | "critical";
export type SeoBlogPostStatus = "suggested" | "generating" | "written" | "failed";

export type SeoProjectSummary = {
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
};

export type SeoAnalysisRunSummary = {
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
};

export type SeoFindingSummary = {
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
};

export type SeoBlogPostSummary = {
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
};

export type KnowledgeBaseConfigSummary = {
	workspaceId: string;
	vaultPath: string;
	obsidianRestUrl: string | null;
	obsidianApiKey: string | null;
	docsAgentEnabled: boolean;
	injectIntoPrompts: boolean;
	lastDocsSyncAt: Date | null;
	lastDocsSyncError: string | null;
	updatedAt: Date;
};

export type KnowledgeBaseOverview = {
	config: KnowledgeBaseConfigSummary & {
		obsidianApiKeySet: boolean;
		absoluteVaultPath: string;
	};
	stats: {
		noteCount: number;
		edgeCount: number;
	};
	recentDocuments: KnowledgeBaseDocument[];
	obsidian: {
		reachable: boolean;
		error: string | null;
	};
};

export type KnowledgeBaseDocument = {
	path: string;
	title: string;
	modifiedAt: Date;
	links: string[];
};

export type KnowledgeBaseGraph = {
	nodes: { id: string; label: string; group: string }[];
	edges: { source: string; target: string }[];
};

export type ModelProviderKind =
	| "anthropic"
	| "openai"
	| "openrouter"
	| "openai_compatible"
	| "claude_cli"
	| "codex_cli";

/** claude_cli/codex_cli only — see apps/server/src/cli-providers.ts. Auth
 * state is host-wide (the server's OS user login), not per-workspace. */
export type CliProviderKind = "claude_cli" | "codex_cli";

export type CliAuthStatus = {
	status: "not_installed" | "needs_login" | "connected" | "error";
	binaryPath: string | null;
	message?: string;
};

export type CliLoginOutput = {
	status: "running" | "exited";
	exitCode: number | null;
	output: string;
	url: string | null;
};

export type ModelInstallationSummary = {
	id: string;
	workspaceId: string;
	label: string;
	providerKind: ModelProviderKind;
	baseUrl: string;
	apiKey: string | null;
	modelIds: string[];
	/** Subset of modelIds hidden from the model picker without removing them. */
	disabledModelIds: string[];
	enabled: boolean;
	createdAt: Date;
	updatedAt: Date;
};

export type ProbedModelProvider = {
	providerKey: string;
	providerLabel: string;
	baseUrl: string;
	modelIds: string[];
};

export type OpenRouterModel = {
	id: string;
	label: string;
	contextLength: number | null;
};

export type ProviderImportSource = {
	id: string;
	label: string;
	details: string;
	kind: "api_key" | "desktop_auth" | "local_runtime";
	status: "importable" | "detected" | "auto";
	importableProvider?: {
		label: string;
		providerKind: ModelProviderKind;
		baseUrl: string;
		apiKey: string | null;
		modelIds: string[];
	};
};

type NyxelTrpcClient = {
	demoUser: {
		query(): Promise<DemoUser>;
	};
	users: {
		get: {
			query(input: { userId: string }): Promise<UserSummary | null>;
		};
	};
	installation: {
		status: {
			query(): Promise<InstallationStatus>;
		};
		complete: {
			mutate(input: {
				mode: InstallationMode;
				ownerName: string;
				ownerEmail: string;
				ownerPassword: string;
				workspaceName: string;
				appUrl?: string;
			}): Promise<InstallationSummary>;
		};
	};
	models: {
		list: {
			query(input?: { workspaceId?: string }): Promise<ModelSummary[]>;
		};
		installations: {
			query(input: {
				workspaceId: string;
			}): Promise<ModelInstallationSummary[]>;
		};
		capabilities: {
			query(input: {
				workspaceId: string;
				modelId: string;
			}): Promise<ModelCapabilities>;
		};
		probe: {
			query(input: {
				label?: string;
				baseUrl: string;
				apiKey?: string;
			}): Promise<ProbedModelProvider>;
		};
		installCustom: {
			mutate(input: {
				workspaceId: string;
				label: string;
				providerKind?: ModelProviderKind;
				baseUrl: string;
				apiKey?: string;
				modelIds?: string[];
			}): Promise<ModelInstallationSummary>;
		};
		listOpenRouterModels: {
			query(input?: { apiKey?: string }): Promise<OpenRouterModel[]>;
		};
		installOpenRouter: {
			mutate(input: {
				workspaceId: string;
				label?: string;
				apiKey: string;
				modelIds?: string[];
			}): Promise<ModelInstallationSummary>;
		};
		deleteInstallation: {
			mutate(input: { id: string }): Promise<void>;
		};
		setModelEnabled: {
			mutate(input: {
				id: string;
				modelId: string;
				enabled: boolean;
			}): Promise<ModelInstallationSummary>;
		};
		removeModelFromInstallation: {
			mutate(input: { id: string; modelId: string }): Promise<ModelInstallationSummary | null>;
		};
		cliStatus: {
			query(input: { providerKind: CliProviderKind }): Promise<CliAuthStatus>;
		};
		cliLoginStart: {
			mutate(input: {
				providerKind: CliProviderKind;
				apiKey?: string;
			}): Promise<{ execId: string }>;
		};
		cliLoginOutput: {
			query(input: { execId: string }): Promise<CliLoginOutput>;
		};
		installCli: {
			mutate(input: {
				workspaceId: string;
				providerKind: CliProviderKind;
				label: string;
				modelIds: string[];
			}): Promise<ModelInstallationSummary>;
		};
		scanImportSources: {
			query(): Promise<ProviderImportSource[]>;
		};
		importSource: {
			mutate(input: {
				workspaceId: string;
				sourceId: string;
			}): Promise<ModelInstallationSummary>;
		};
	};
	skills: {
		list: {
			query(input: { workspaceId: string }): Promise<SkillSummary[]>;
		};
		create: {
			mutate(input: {
				workspaceId: string;
				name: string;
				description: string;
				body: string;
			}): Promise<SkillSummary>;
		};
		update: {
			mutate(input: {
				workspaceId: string;
				slug: string;
				name: string;
				description: string;
				body: string;
			}): Promise<SkillSummary>;
		};
		delete: {
			mutate(input: { workspaceId: string; slug: string }): Promise<void>;
		};
		searchLibrary: {
			query(input: { query: string }): Promise<SkillLibraryResult[]>;
		};
		importFromUrl: {
			mutate(input: { workspaceId: string; url: string }): Promise<SkillSummary>;
		};
	};
	plugins: {
		list: {
			query(input: { workspaceId: string }): Promise<PluginSummary[]>;
		};
		get: {
			query(input: { id: string }): Promise<PluginSummary | null>;
		};
		install: {
			mutate(input: { workspaceId: string; repoUrl: string }): Promise<InstallPluginResult>;
		};
		setEnabled: {
			mutate(input: { id: string; enabled: boolean }): Promise<PluginSummary>;
		};
		uninstall: {
			mutate(input: { id: string }): Promise<{ ok: boolean }>;
		};
	};
	tools: {
		list: {
			query(input: { workspaceId: string }): Promise<ToolSummary[]>;
		};
		create: {
			mutate(input: {
				workspaceId: string;
				name: string;
				description: string;
				kind: ToolKind;
				config: Record<string, unknown>;
				sensitive?: boolean;
				enabled?: boolean;
			}): Promise<ToolSummary>;
		};
		setEnabled: {
			mutate(input: { id: string; enabled: boolean }): Promise<ToolSummary>;
		};
		delete: {
			mutate(input: { id: string }): Promise<void>;
		};
	};
	workspaces: {
		list: {
			query(input: { userId: string }): Promise<WorkspaceSummary[]>;
		};
		create: {
			mutate(input: {
				userId: string;
				name: string;
			}): Promise<WorkspaceSummary>;
		};
		get: {
			query(input: { workspaceId: string }): Promise<WorkspaceSummary | null>;
		};
		updateSettings: {
			mutate(input: {
				workspaceId: string;
				name?: string;
				customInstructions?: string | null;
				icon?: string | null;
				color?: string | null;
				defaultModelId?: string | null;
				defaultAutonomyLevel?: AutonomyLevel;
				defaultToolPolicy?: ChatToolPolicy;
			}): Promise<WorkspaceSummary>;
		};
	};
	chats: {
		list: {
			query(input: { workspaceId: string }): Promise<ChatSummary[]>;
		};
		listArchived: {
			query(input: { workspaceId: string }): Promise<ChatSummary[]>;
		};
		listByProject: {
			query(input: { projectId: string }): Promise<ChatSummary[]>;
		};
		create: {
			mutate(input: {
				workspaceId: string;
				workingDirectory: string;
				title: string;
				modelId?: string;
				agentId?: string;
				projectId?: string | null;
				toolMode?: ChatToolMode;
				toolPolicy?: ChatToolPolicy;
			}): Promise<ChatSummary>;
		};
		rename: {
			mutate(input: { chatId: string; title: string }): Promise<ChatSummary>;
		};
		setArchived: {
			mutate(input: {
				chatId: string;
				archived: boolean;
			}): Promise<ChatSummary>;
		};
		setPinned: {
			mutate(input: { chatId: string; pinned: boolean }): Promise<ChatSummary>;
		};
		setProject: {
			mutate(input: {
				chatId: string;
				projectId: string | null;
			}): Promise<ChatSummary>;
		};
		duplicate: {
			mutate(input: { chatId: string }): Promise<ChatSummary>;
		};
		share: {
			mutate(input: { chatId: string }): Promise<ChatSummary>;
		};
		unshare: {
			mutate(input: { chatId: string }): Promise<ChatSummary>;
		};
		getShared: {
			query(input: {
				shareId: string;
			}): Promise<{ chat: ChatSummary; messages: MessageSummary[] } | null>;
		};
		delete: {
			mutate(input: { chatId: string }): Promise<void>;
		};
		messages: {
			query(input: { chatId: string }): Promise<MessageSummary[]>;
		};
		setAgent: {
			mutate(input: {
				chatId: string;
				agentId: string | null;
			}): Promise<ChatSummary>;
		};
		setToolPolicy: {
			mutate(input: {
				chatId: string;
				toolMode: ChatToolMode;
				toolPolicy: ChatToolPolicy;
			}): Promise<ChatSummary>;
		};
	};
	projects: {
		list: {
			query(input: { workspaceId: string }): Promise<ProjectSummary[]>;
		};
		get: {
			query(input: { projectId: string }): Promise<ProjectSummary | null>;
		};
		create: {
			mutate(input: {
				workspaceId: string;
				name: string;
				color?: string;
				icon?: string;
			}): Promise<ProjectSummary>;
		};
		rename: {
			mutate(input: {
				projectId: string;
				name: string;
			}): Promise<ProjectSummary>;
		};
		setAppearance: {
			mutate(input: {
				projectId: string;
				color: string;
				icon: string;
			}): Promise<ProjectSummary>;
		};
		duplicate: {
			mutate(input: { projectId: string }): Promise<ProjectSummary>;
		};
		delete: {
			mutate(input: { projectId: string }): Promise<void>;
		};
	};
	agents: {
		list: {
			query(input: { workspaceId: string }): Promise<AgentSummary[]>;
		};
		get: {
			query(input: { id: string }): Promise<AgentSummary | null>;
		};
		create: {
			mutate(input: {
				workspaceId: string;
				name: string;
				role?: string;
				goalTemplate?: string;
				systemPrompt?: string;
				modelId: string;
				autonomyLevel?: AutonomyLevel;
				skillIds?: string[];
				toolIds?: string[];
				mcpServerIds?: string[];
				mcpToolFilter?: string[] | null;
				autoAttachWorkspaceTools?: boolean;
				delegateAgentIds?: string[];
			}): Promise<AgentSummary>;
		};
		update: {
			mutate(input: {
				id: string;
				name?: string;
				role?: string | null;
				goalTemplate?: string | null;
				systemPrompt?: string | null;
				modelId?: string;
				autonomyLevel?: AutonomyLevel;
				skillIds?: string[];
				toolIds?: string[];
				mcpServerIds?: string[];
				mcpToolFilter?: string[] | null;
				delegateAgentIds?: string[];
			}): Promise<AgentSummary>;
		};
		delete: {
			mutate(input: { id: string }): Promise<{ ok: boolean }>;
		};
		cleanupUnusedChatAgents: {
			mutate(input: { workspaceId: string }): Promise<number>;
		};
	};
	tasks: {
		list: {
			query(input: {
				workspaceId: string;
				status?: TaskStatus;
				assignedAgentId?: string | null;
			}): Promise<TaskSummary[]>;
		};
		get: {
			query(input: { taskId: string }): Promise<TaskDetail>;
		};
		create: {
			mutate(input: {
				workspaceId: string;
				parentTaskId?: string | null;
				sourceChatId?: string | null;
				createdByAgentId?: string | null;
				assignedAgentId?: string | null;
				title: string;
				instruction: string;
				modelId?: string | null;
				priority?: TaskPriority;
				input?: Record<string, unknown>;
			}): Promise<TaskSummary>;
		};
		assign: {
			mutate(input: {
				taskId: string;
				assignedAgentId: string | null;
			}): Promise<TaskSummary>;
		};
		setModel: {
			mutate(input: {
				taskId: string;
				modelId: string | null;
			}): Promise<TaskSummary>;
		};
		complete: {
			mutate(input: {
				taskId: string;
				resultSummary: string;
			}): Promise<TaskSummary>;
		};
		cancel: {
			mutate(input: { taskId: string }): Promise<TaskSummary>;
		};
		start: {
			mutate(input: { taskId: string }): Promise<TaskSummary>;
		};
		reply: {
			mutate(input: { taskId: string; instruction: string }): Promise<TaskSummary | null>;
		};
		events: {
			query(input: { taskId: string }): Promise<TaskEventSummary[]>;
		};
	};
	agentRuns: {
		listByTask: {
			query(input: { taskId: string }): Promise<AgentRunSummary[]>;
		};
		listByAgent: {
			query(input: { agentId: string }): Promise<AgentRunSummary[]>;
		};
		listActive: {
			query(input: { workspaceId: string }): Promise<AgentRunSummary[]>;
		};
		cancel: {
			mutate(input: { runId: string }): Promise<AgentRunSummary>;
		};
	};
	mcpServers: {
		catalog: {
			query(): Promise<McpConnectorCatalogEntry[]>;
		};
		list: {
			query(input: { workspaceId: string }): Promise<McpServerSummary[]>;
		};
		create: {
			mutate(input: {
				workspaceId: string;
				name: string;
				transport: McpTransportKind;
				command?: string;
				args?: string[];
				url?: string;
				env?: Record<string, string>;
			}): Promise<McpServerSummary>;
		};
		connectWithConfig: {
			mutate(input: {
				workspaceId: string;
				key: string;
				values: Record<string, string>;
			}): Promise<McpServerSummary>;
		};
		delete: {
			mutate(input: { id: string }): Promise<void>;
		};
		listTools: {
			query(input: { id: string }): Promise<McpToolListResult>;
		};
		finishAuth: {
			mutate(input: { id: string; code: string }): Promise<{ ok: boolean }>;
		};
	};
	extensions: {
		catalog: {
			query(): Promise<ExtensionCatalogEntry[]>;
		};
		list: {
			query(input: { workspaceId: string }): Promise<ExtensionSummary[]>;
		};
		install: {
			mutate(input: { workspaceId: string; key: string }): Promise<ExtensionSummary>;
		};
		setEnabled: {
			mutate(input: { id: string; enabled: boolean }): Promise<ExtensionSummary>;
		};
		updateConfig: {
			mutate(input: {
				id: string;
				config: Record<string, unknown>;
			}): Promise<ExtensionSummary>;
		};
		uninstall: {
			mutate(input: { id: string }): Promise<void>;
		};
	};
	seoAnalyzer: {
		listProjects: {
			query(input: { workspaceId: string }): Promise<SeoProjectSummary[]>;
		};
		createProject: {
			mutate(input: {
				workspaceId: string;
				domain: string;
				repoPath: string;
			}): Promise<SeoProjectSummary>;
		};
		updateProject: {
			mutate(input: {
				id: string;
				domain?: string;
				repoPath?: string;
			}): Promise<SeoProjectSummary>;
		};
		deleteProject: {
			mutate(input: { id: string }): Promise<void>;
		};
		setFixerAgent: {
			mutate(input: {
				id: string;
				agentId: string | null;
			}): Promise<SeoProjectSummary>;
		};
		setSchedule: {
			mutate(input: {
				id: string;
				cronExpression: string | null;
			}): Promise<SeoProjectSummary>;
		};
		listRuns: {
			query(input: { seoProjectId: string }): Promise<SeoAnalysisRunSummary[]>;
		};
		listFindings: {
			query(input: { runId: string }): Promise<SeoFindingSummary[]>;
		};
		listOpenFindings: {
			query(input: { seoProjectId: string }): Promise<SeoFindingSummary[]>;
		};
		listBlogPosts: {
			query(input: { seoProjectId: string }): Promise<SeoBlogPostSummary[]>;
		};
		runAnalysis: {
			mutate(input: { seoProjectId: string }): Promise<SeoAnalysisRunSummary>;
		};
		dispatchFix: {
			mutate(input: {
				seoProjectId: string;
				findingIds: string[];
			}): Promise<{ taskId: string; runId: string; output: string }>;
		};
		generateBlogPost: {
			mutate(input: {
				seoProjectId: string;
				keyword: string;
			}): Promise<SeoBlogPostSummary>;
		};
	};
	automations: {
		list: {
			query(input: { workspaceId: string }): Promise<AutomationSummary[]>;
		};
		create: {
			mutate(input: {
				workspaceId: string;
				agentId: string;
				name: string;
				triggerType?: AutomationTriggerType;
				cronExpression?: string;
				watchPath?: string;
				watchGlob?: string;
				prompt: string;
				enabled?: boolean;
			}): Promise<AutomationSummary>;
		};
		update: {
			mutate(input: {
				id: string;
				name?: string;
				agentId?: string;
				cronExpression?: string;
				watchPath?: string;
				watchGlob?: string;
				prompt?: string;
			}): Promise<AutomationSummary>;
		};
		setEnabled: {
			mutate(input: {
				id: string;
				enabled: boolean;
			}): Promise<AutomationSummary>;
		};
		delete: {
			mutate(input: { id: string }): Promise<void>;
		};
		runNow: {
			mutate(input: { id: string }): Promise<{
				automation: AutomationSummary | null;
				taskId: string;
				runId: string;
				output: string;
			}>;
		};
	};
	approvals: {
		list: {
			query(input: {
				workspaceId: string;
				status?: ApprovalStatus;
			}): Promise<ApprovalSummary[]>;
		};
		approve: {
			mutate(input: { id: string }): Promise<ApprovalSummary>;
		};
		reject: {
			mutate(input: { id: string }): Promise<ApprovalSummary>;
		};
	};
	auditLog: {
		list: {
			query(input: {
				workspaceId: string;
				limit?: number;
			}): Promise<AuditLogSummary[]>;
		};
	};
	knowledgeBase: {
		overview: {
			query(input: { workspaceId: string }): Promise<KnowledgeBaseOverview>;
		};
		updateConfig: {
			mutate(input: {
				workspaceId: string;
				vaultPath: string;
				obsidianRestUrl?: string | null;
				obsidianApiKey?: string | null;
				docsAgentEnabled?: boolean;
				injectIntoPrompts?: boolean;
			}): Promise<KnowledgeBaseConfigSummary>;
		};
		documents: {
			query(input: { workspaceId: string }): Promise<KnowledgeBaseDocument[]>;
		};
		graph: {
			query(input: { workspaceId: string }): Promise<KnowledgeBaseGraph>;
		};
		runDocsAgent: {
			mutate(input: {
				workspaceId: string;
			}): Promise<{ ok: boolean; skipped: boolean; notePath?: string }>;
		};
	};
	notifications: {
		vapidPublicKey: {
			query(): Promise<string>;
		};
		subscribe: {
			mutate(input: {
				userId: string;
				endpoint: string;
				keys: { p256dh: string; auth: string };
				userAgent?: string;
			}): Promise<void>;
		};
		unsubscribe: {
			mutate(input: { endpoint: string }): Promise<void>;
		};
	};
};

/**
 * A vanilla tRPC client (not the TanStack Query proxy integration) called
 * from inside plain `useQuery`/`useMutation` hooks, cast to a hand-written
 * interface mirroring apps/server's AppRouter. See ARCHITECTURE.md section
 * 3 — this interface must be kept in sync by hand whenever a router
 * procedure is added or changed.
 */
export const trpcClient = createTRPCClient({
	links: [
		httpBatchLink({
			url: `${SERVER_URL}/trpc`,
			fetch(url, options) {
				return fetch(url, { ...options, credentials: "include" });
			},
		}),
	],
}) as unknown as NyxelTrpcClient;
