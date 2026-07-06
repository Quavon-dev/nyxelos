import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { getServerUrl } from "./server-url";

const SERVER_URL = getServerUrl();

export type ModelSummary = {
  id: string;
  label: string;
  kind: "local" | "cloud" | "custom";
  provider: string;
  providerLabel: string;
  capabilities?: ModelCapabilities;
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

export type AutonomyBudgetRiskLevel = "low" | "medium" | "high";

/** Autonomy Budgets v1 — see apps/server/src/autonomy-budget.ts for which of
 * these are actually enforced today vs. only prepared. Every field null
 * means "no limit," matching an agent's behavior before this feature
 * existed. */
export type AutonomyBudget = {
  maxToolCallsPerRun: number | null;
  maxRuntimeMinutes: number | null;
  maxEstimatedCostUsd: number | null;
  maxFileWritesPerRun: number | null;
  allowedToolKinds: ToolKind[] | null;
  blockedToolKinds: ToolKind[] | null;
  requiresApprovalAboveRisk: AutonomyBudgetRiskLevel | null;
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
  /** Null means "no autonomy budget configured" — see AutonomyBudget. */
  autonomyBudget: AutonomyBudget | null;
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
export type AgentRunTrigger = "chat" | "task" | "automation" | "delegate" | "extension";
export type AgentRunStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "dead_letter";

export type GoalStatus = "active" | "paused" | "blocked" | "completed" | "archived";
export type GoalMilestoneStatus = "pending" | "completed";
export type GoalEventKind =
  | "created"
  | "status_changed"
  | "milestone_added"
  | "milestone_status_changed"
  | "plan_created"
  | "task_created"
  | "task_status_changed"
  | "review";

export type TaskSummary = {
  id: string;
  workspaceId: string;
  parentTaskId: string | null;
  sourceChatId: string | null;
  createdByAgentId: string | null;
  assignedAgentId: string | null;
  /** Set when the Goal Orchestrator generated this task from a goal's plan. */
  goalId: string | null;
  goalMilestoneId: string | null;
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

export type GoalMilestoneSummary = {
  id: string;
  goalId: string;
  workspaceId: string;
  title: string;
  status: GoalMilestoneStatus;
  order: number;
  createdAt: Date;
  updatedAt: Date;
};

export type GoalSummary = {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  status: GoalStatus;
  priority: TaskPriority;
  /** Goal Engine additions — see ADR-0018. */
  defaultAgentId: string | null;
  successCriteria: string[] | null;
  orchestrationEnabled: boolean;
  nextReviewAt: Date | null;
  lastReviewedAt: Date | null;
  blockedReason: string | null;
  planGeneratedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  milestones: GoalMilestoneSummary[];
};

export type GoalProgressEventSummary = {
  id: string;
  goalId: string;
  workspaceId: string;
  kind: GoalEventKind;
  message: string;
  payload: Record<string, unknown> | null;
  createdAt: Date;
};

export type GoalOverview = {
  goal: Omit<GoalSummary, "milestones">;
  milestones: GoalMilestoneSummary[];
  tasks: TaskSummary[];
  latestRun: AgentRunSummary | null;
  blockers: { taskId: string; title: string; reason: string }[];
  nextAction: string;
  progressEvents: GoalProgressEventSummary[];
};

export type ModelCapabilities = {
  nativeImageInput: boolean;
  nativeDocumentInput: boolean;
  toolCalling: boolean;
  imageOutput: boolean;
  reasoning: boolean;
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
  | "generate_image"
  | "generate_video"
  | "edit_video"
  | "generate_speech"
  | "transcribe_audio";

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
  generate_video: "web",
  edit_video: "web",
  generate_speech: "web",
  transcribe_audio: "web",
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
  ref: string;
  resolvedSha: string | null;
  refPinned: boolean;
  riskFindings: string[];
  createdAt: Date;
};

/** One static-scan hit (docs/PLUGIN_SECURITY.md stage 4) — deliberately
 * naive pattern matching, not a security boundary. */
export type PluginRiskFinding = { file: string; pattern: string };

/** Ref-pinning + static-scan result for one install attempt (stages 3-4). */
export type PluginRiskSummary = {
  ref: string;
  resolvedSha: string | null;
  refPinned: boolean;
  branchWarning: boolean;
  isMovingBranch: boolean;
  findings: PluginRiskFinding[];
};

/** The static scan found risky patterns and the install was not confirmed —
 * nothing was installed. The caller should show `riskSummary` and retry the
 * same mutation with `acknowledgeRisk: true` if the user proceeds. */
export type InstallPluginNeedsConfirmation = {
  status: "needs_confirmation";
  riskSummary: PluginRiskSummary;
};

export type InstallPluginInstalled = {
  status: "installed";
  plugin: PluginSummary;
  skills: { id: string; name: string; description: string }[];
  skippedFiles: string[];
  riskSummary: PluginRiskSummary;
};

export type InstallPluginResult = InstallPluginInstalled | InstallPluginNeedsConfirmation;

/** A folder in the workspace's document/image library. `parentId` null
 * means "at the library root". See apps/server/src/library.ts. */
export type LibraryFolderSummary = {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  createdAt: Date;
};

export type LibraryItemKind = "image" | "document" | "video" | "other";

/** Metadata for one uploaded library file — the bytes live on disk, fetched
 * through libraryFileUrl()/libraryDownloadUrl() below, not through tRPC. */
export type LibraryFileSummary = {
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
};

export type LibraryListing = {
  folders: LibraryFolderSummary[];
  files: LibraryFileSummary[];
};

/** Inline preview URL (renders in an <img>/<iframe> when the browser
 * supports the mime type) for a library file — see GET
 * /api/library/files/:id/content in apps/server/src/routes/library.ts. */
export function libraryFileUrl(id: string): string {
  return `${SERVER_URL}/api/library/files/${id}/content`;
}

/** Forces a "Save As" download instead of an inline render. */
export function libraryDownloadUrl(id: string): string {
  return `${SERVER_URL}/api/library/files/${id}/content?download=1`;
}

/** POST target for multipart uploads (see registerLibraryRoutes in
 * apps/server/src/routes/library.ts) — a plain fetch, not a tRPC mutation. */
export function libraryUploadUrl(): string {
  return `${SERVER_URL}/api/library/upload`;
}

export type VideoGenerationJobStatus = "queued" | "in_progress" | "completed" | "failed";

/** One text-to-video generation request — see apps/server/src/video.ts.
 * `libraryFileId`/`posterLibraryFileId` are set once generation finishes;
 * resolve them to playable URLs with libraryFileUrl(). */
export type VideoGenerationJobSummary = {
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
};

export type VideoEditOperation =
  | "trim"
  | "concat"
  | "mute"
  | "volume"
  | "speed"
  | "extractFrame"
  | "toGif";

/** A video-capable model from the fixed Sora catalog — see
 * packages/model-providers/src/video.ts's OPENAI_VIDEO_MODELS. */
export type VideoModelSummary = {
  id: string;
  label: string;
  sizes: string[];
  durations: number[];
  tier: "standard" | "pro";
};

/** Node kinds the canvas builder renders and the runner executes — keep in
 * sync with WorkflowNodeKind in @nyxel/db / apps/server/src/trpc/router.ts's
 * workflowNodeKindSchema. */
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

/** A workflow's graph — plain JSON matching React Flow's own node/edge
 * shape, `data` untyped per node kind (validated by each node's own
 * inspector panel, not here). */
export type WorkflowDefinition = {
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
};

export type WorkflowSummary = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  definition: WorkflowDefinition;
  createdAt: Date;
  updatedAt: Date;
};

/** Result of workflows.generateFromPrompt — an unsaved draft the caller
 * reviews (and may edit) before ever calling workflows.create. `warnings`
 * flags anything the model got wrong (unknown node types dropped, required
 * fields left blank) so the UI can surface it instead of silently trusting
 * the generated JSON. */
export type WorkflowDraftResult = {
  definition: WorkflowDefinition;
  suggestedName: string;
  warnings: string[];
};

export type WorkflowRunStatus = "queued" | "running" | "completed" | "failed" | "partial";
export type WorkflowRunNodeStatus = "queued" | "running" | "completed" | "failed" | "skipped";

export type WorkflowRunSummary = {
  id: string;
  workflowId: string;
  workspaceId: string;
  status: WorkflowRunStatus;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
};

export type WorkflowRunNodeSummary = {
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
};

export type AutomationTriggerType = "cron" | "file_watch";
export type AutomationTargetKind = "agent" | "workflow";
export type AutomationRunStatus = "success" | "error" | "pending_approval";

export type AutomationSummary = {
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
  title: string | null;
  description: string | null;
  riskLevel: string | null;
  affectedResources: string[] | null;
  diffPreview: string | null;
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
  inputHash: string | null;
  permissionSnapshot: Record<string, unknown> | null;
};

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

export type MemoryEntrySummary = {
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
};

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

export type ArtifactSummary = {
  id: string;
  workspaceId: string;
  type: ArtifactType;
  title: string;
  content: string;
  taskId: string | null;
  agentRunId: string | null;
  agentId: string | null;
  createdAt: Date;
};

export type DailyStatPoint = {
  date: string;
  messages: number;
  tokens: number;
  costUsd: number;
  thinkingSeconds: number;
  linesGenerated: number;
};

export type ModelUsageStat = {
  modelId: string;
  label: string;
  messages: number;
  tokens: number;
  costUsd: number;
};

export type ToolUsageStat = {
  toolLabel: string;
  count: number;
  successCount: number;
  errorCount: number;
};

export type GenerationKindStat = {
  kind: "code_blocks" | "images" | "documents" | "other_files";
  label: string;
  count: number;
};

export type AgentRunStatusStat = {
  status: string;
  count: number;
};

export type WorkspaceStatsOverview = {
  windowDays: number;
  totals: {
    assistantMessages: number;
    messagesWithUsage: number;
    userMessages: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheReadTokens: number;
    totalTokens: number;
    costUsd: number;
    costUnknownMessages: number;
    thinkingSeconds: number;
    avgResponseSeconds: number;
    linesGenerated: number;
    codeLinesGenerated: number;
    codeBlocksGenerated: number;
    imagesGenerated: number;
    documentsGenerated: number;
    otherFilesGenerated: number;
    toolCalls: number;
    toolCallSuccessRate: number;
    agentRuns: number;
    agentRunSuccessRate: number;
  };
  dailySeries: DailyStatPoint[];
  modelUsage: ModelUsageStat[];
  toolUsage: ToolUsageStat[];
  generationBreakdown: GenerationKindStat[];
  agentRunStatus: AgentRunStatusStat[];
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
  /** Neither the raw stdio env vars nor the OAuth session ever leave the
   * server (SECURITY_AUDIT.md SEC-01) — these booleans are all the UI needs
   * to show "configured"/"not configured". */
  hasEnv: boolean;
  hasOAuthState: boolean;
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
  pluginRepoUrl?: string;
};

export type ExtensionPluginInstallResult = {
  status: "installed" | "already_installed" | "failed";
  plugin?: PluginSummary;
  skillCount?: number;
  agentCount?: number;
  error?: string;
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

export type LeadScoutProvider = "manual_csv" | "google_places_api" | "osm_overpass" | "custom_api";
export type LeadScoutOutreachMode = "draft_only" | "review_and_send";
export type LeadScoutWebsiteStatus =
  | "unknown"
  | "has_website"
  | "missing_website"
  | "invalid_website";
export type LeadScoutLeadStatus =
  | "new"
  | "reviewed"
  | "prototype_requested"
  | "prototype_ready"
  | "email_drafted"
  | "approved_to_send"
  | "sending"
  | "sent"
  | "rejected"
  | "suppressed";
export type LeadScoutScanRunStatus = "running" | "completed" | "failed";
export type LeadScoutPrototypeStatus = "pending" | "ready" | "failed";
export type LeadScoutDraftStatus =
  | "draft"
  | "approved"
  | "rejected"
  | "sending"
  | "sent"
  | "failed";
export type LeadScoutEmailProvider = "smtp" | "resend" | "mailgun" | "custom";

export type LeadScoutCampaignSummary = {
  id: string;
  workspaceId: string;
  extensionId: string;
  name: string;
  postalCode: string;
  country: string;
  radiusKm: number;
  niches: string[];
  maxResultsPerRun: number;
  provider: LeadScoutProvider;
  minConfidence: number;
  outreachMode: LeadScoutOutreachMode;
  scheduleEnabled: boolean;
  scheduleCronExpression: string | null;
  nextScanAt: Date | null;
  lastScanAt: Date | null;
  autoGeneratePrototype: boolean;
  autoDraftEmail: boolean;
  autoSendAfterApproval: boolean;
  requireApprovalBeforePrototype: boolean;
  requireApprovalBeforeEmailSend: boolean;
  prototypeAgentId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// The raw apiKey never leaves the server — hasApiKey is all the UI needs.
export type LeadScoutSourceConfigSummary = {
  id: string;
  workspaceId: string;
  provider: LeadScoutProvider;
  config: Record<string, unknown>;
  hasApiKey: boolean;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type LeadScoutScanRunSummary = {
  id: string;
  campaignId: string;
  workspaceId: string;
  provider: LeadScoutProvider;
  status: LeadScoutScanRunStatus;
  resultCount: number;
  newLeadCount: number;
  missingWebsiteCount: number;
  summary: string | null;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
};

export type LeadScoutLeadSummary = {
  id: string;
  workspaceId: string;
  campaignId: string;
  scanRunId: string | null;
  sourceProvider: LeadScoutProvider;
  sourceId: string;
  businessName: string;
  category: string | null;
  niche: string | null;
  formattedAddress: string | null;
  postalCode: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  websiteStatus: LeadScoutWebsiteStatus;
  confidence: number;
  evidenceSummary: string | null;
  missingReason: string | null;
  status: LeadScoutLeadStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type LeadScoutPrototypeSummary = {
  id: string;
  workspaceId: string;
  leadId: string;
  taskId: string | null;
  status: LeadScoutPrototypeStatus;
  concept: string | null;
  heroCopy: string | null;
  sections: string[];
  callToAction: string | null;
  styleDirection: string | null;
  artifactMarkdown: string | null;
  approved: boolean;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LeadScoutOutreachDraftSummary = {
  id: string;
  workspaceId: string;
  leadId: string;
  prototypeId: string | null;
  taskId: string | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  status: LeadScoutDraftStatus;
  errorMessage: string | null;
  approvedAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LeadScoutSuppressionSummary = {
  id: string;
  workspaceId: string;
  email: string | null;
  domain: string | null;
  reason: string;
  createdAt: Date;
};

// The raw credentials blob never leaves the server — hasCredentials is all
// the UI needs (same convention as LeadScoutSourceConfigSummary.hasApiKey).
export type LeadScoutEmailSettingsSummary = {
  id: string;
  workspaceId: string;
  provider: LeadScoutEmailProvider;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  hasCredentials: boolean;
  dailySendLimit: number;
  perCampaignSendLimit: number;
  dryRunMode: boolean;
  legalFooter: string | null;
  unsubscribeText: string;
  sendCountToday: number;
  sendCountDate: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// The raw obsidianApiKey never leaves the server (SECURITY_AUDIT.md SEC-01) —
// both knowledgeBase.overview and knowledgeBase.updateConfig return
// `obsidianApiKeySet` instead; the UI only needs "configured"/"not configured".
export type KnowledgeBaseConfigSummary = {
  workspaceId: string;
  vaultPath: string;
  obsidianRestUrl: string | null;
  obsidianApiKeySet: boolean;
  docsAgentEnabled: boolean;
  injectIntoPrompts: boolean;
  lastDocsSyncAt: Date | null;
  lastDocsSyncError: string | null;
  updatedAt: Date;
};

export type KnowledgeBaseOverview = {
  config: KnowledgeBaseConfigSummary & {
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

/** Shape returned by `models.installations` — the server strips the raw
 * provider secret before this leaves the process (SECURITY_AUDIT.md SEC-02);
 * `hasApiKey` is all the UI needs to render "configured"/"not configured". */
export type ModelInstallationClientSummary = Omit<ModelInstallationSummary, "apiKey"> & {
  hasApiKey: boolean;
};

/** Per-(workspace, model) generation overrides — see models.getParameters. */
export type ModelParameterSummary = {
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
      query(input: { workspaceId: string }): Promise<ModelInstallationClientSummary[]>;
    };
    generationCatalog: {
      query(): Promise<{
        image: { id: string; label: string }[];
        speech: { id: string; label: string }[];
        transcription: { id: string; label: string }[];
      }>;
    };
    capabilities: {
      query(input: { workspaceId: string; modelId: string }): Promise<ModelCapabilities>;
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
      }): Promise<ModelInstallationClientSummary>;
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
      }): Promise<ModelInstallationClientSummary>;
    };
    deleteInstallation: {
      mutate(input: { id: string }): Promise<void>;
    };
    setModelEnabled: {
      mutate(input: {
        id: string;
        modelId: string;
        enabled: boolean;
      }): Promise<ModelInstallationClientSummary>;
    };
    removeModelFromInstallation: {
      mutate(input: {
        id: string;
        modelId: string;
      }): Promise<ModelInstallationClientSummary | null>;
    };
    addModelToInstallation: {
      mutate(input: { id: string; modelId: string }): Promise<ModelInstallationClientSummary>;
    };
    listCatalogForInstallation: {
      query(input: { id: string }): Promise<string[]>;
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
      }): Promise<ModelInstallationClientSummary>;
    };
    scanImportSources: {
      query(): Promise<ProviderImportSource[]>;
    };
    importSource: {
      mutate(input: {
        workspaceId: string;
        sourceId: string;
      }): Promise<ModelInstallationClientSummary>;
    };
    getParameters: {
      query(input: { workspaceId: string; modelId: string }): Promise<ModelParameterSummary | null>;
    };
    saveParameters: {
      mutate(input: {
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
      }): Promise<ModelParameterSummary>;
    };
    resetParameters: {
      mutate(input: { workspaceId: string; modelId: string }): Promise<void>;
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
      mutate(input: {
        workspaceId: string;
        repoUrl: string;
        acknowledgeRisk?: boolean;
      }): Promise<InstallPluginResult>;
    };
    setEnabled: {
      mutate(input: { id: string; enabled: boolean }): Promise<PluginSummary>;
    };
    uninstall: {
      mutate(input: { id: string }): Promise<{ ok: boolean }>;
    };
  };
  library: {
    list: {
      query(input: { workspaceId: string }): Promise<LibraryListing>;
    };
    createFolder: {
      mutate(input: {
        workspaceId: string;
        parentId: string | null;
        name: string;
      }): Promise<LibraryFolderSummary>;
    };
    renameFolder: {
      mutate(input: { id: string; name: string }): Promise<LibraryFolderSummary>;
    };
    moveFolder: {
      mutate(input: { id: string; parentId: string | null }): Promise<LibraryFolderSummary>;
    };
    deleteFolder: {
      mutate(input: { id: string }): Promise<{ ok: boolean }>;
    };
    renameFile: {
      mutate(input: { id: string; name: string }): Promise<LibraryFileSummary>;
    };
    moveFile: {
      mutate(input: { id: string; folderId: string | null }): Promise<LibraryFileSummary>;
    };
    deleteFile: {
      mutate(input: { id: string }): Promise<{ ok: boolean }>;
    };
  };
  video: {
    models: {
      query(): Promise<VideoModelSummary[]>;
    };
    generate: {
      mutate(input: {
        workspaceId: string;
        folderId?: string | null;
        prompt: string;
        model?: string;
        size?: string;
        seconds?: number;
      }): Promise<VideoGenerationJobSummary>;
    };
    list: {
      query(input: { workspaceId: string }): Promise<VideoGenerationJobSummary[]>;
    };
    get: {
      query(input: { id: string }): Promise<VideoGenerationJobSummary | null>;
    };
    edit: {
      mutate(input: {
        workspaceId: string;
        folderId?: string | null;
        operation: VideoEditOperation;
        libraryFileId?: string;
        libraryFileIds?: string[];
        startSeconds?: number;
        endSeconds?: number;
        volume?: number;
        speed?: number;
        timestampSeconds?: number;
        fps?: number;
      }): Promise<LibraryFileSummary>;
    };
  };
  workflows: {
    list: {
      query(input: { workspaceId: string }): Promise<WorkflowSummary[]>;
    };
    get: {
      query(input: { id: string }): Promise<WorkflowSummary | null>;
    };
    create: {
      mutate(input: {
        workspaceId: string;
        name: string;
        description?: string;
        definition?: WorkflowDefinition;
      }): Promise<WorkflowSummary>;
    };
    update: {
      mutate(input: {
        id: string;
        name?: string;
        description?: string | null;
        definition?: WorkflowDefinition;
      }): Promise<WorkflowSummary>;
    };
    duplicate: {
      mutate(input: { id: string }): Promise<WorkflowSummary>;
    };
    delete: {
      mutate(input: { id: string }): Promise<{ ok: boolean }>;
    };
    generateFromPrompt: {
      mutate(input: { workspaceId: string; prompt: string }): Promise<WorkflowDraftResult>;
    };
    runs: {
      start: {
        mutate(input: { workflowId: string }): Promise<WorkflowRunSummary>;
      };
      get: {
        query(input: {
          id: string;
        }): Promise<{ run: WorkflowRunSummary; nodes: WorkflowRunNodeSummary[] } | null>;
      };
      listForWorkflow: {
        query(input: { workflowId: string }): Promise<WorkflowRunSummary[]>;
      };
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
      mutate(input: { userId: string; name: string }): Promise<WorkspaceSummary>;
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
      mutate(input: { chatId: string; archived: boolean }): Promise<ChatSummary>;
    };
    setPinned: {
      mutate(input: { chatId: string; pinned: boolean }): Promise<ChatSummary>;
    };
    setProject: {
      mutate(input: { chatId: string; projectId: string | null }): Promise<ChatSummary>;
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
      mutate(input: { chatId: string; agentId: string | null }): Promise<ChatSummary>;
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
      mutate(input: { projectId: string; name: string }): Promise<ProjectSummary>;
    };
    setAppearance: {
      mutate(input: { projectId: string; color: string; icon: string }): Promise<ProjectSummary>;
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
        autonomyBudget?: AutonomyBudget | null;
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
        autonomyBudget?: AutonomyBudget | null;
      }): Promise<AgentSummary>;
    };
    delete: {
      mutate(input: { id: string }): Promise<{ ok: boolean }>;
    };
    deleteMany: {
      mutate(input: { ids: string[] }): Promise<{
        deletedCount: number;
        errors: { id: string; name: string; message: string }[];
      }>;
    };
    listUnusedChatAgentIds: {
      query(input: { workspaceId: string }): Promise<string[]>;
    };
    cleanupUnusedChatAgents: {
      mutate(input: { workspaceId: string }): Promise<number>;
    };
  };
  healthCheck: {
    run: {
      mutate(input: { workspaceId: string }): Promise<TaskSummary>;
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
      mutate(input: { taskId: string; assignedAgentId: string | null }): Promise<TaskSummary>;
    };
    setModel: {
      mutate(input: { taskId: string; modelId: string | null }): Promise<TaskSummary>;
    };
    complete: {
      mutate(input: { taskId: string; resultSummary: string }): Promise<TaskSummary>;
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
    retry: {
      mutate(input: { taskId: string }): Promise<TaskSummary>;
    };
    events: {
      query(input: { taskId: string }): Promise<TaskEventSummary[]>;
    };
  };
  goals: {
    list: {
      query(input: { workspaceId: string }): Promise<GoalSummary[]>;
    };
    create: {
      mutate(input: {
        workspaceId: string;
        title: string;
        description?: string | null;
        priority?: TaskPriority;
      }): Promise<Omit<GoalSummary, "milestones">>;
    };
    updateStatus: {
      mutate(input: {
        goalId: string;
        status: GoalStatus;
      }): Promise<Omit<GoalSummary, "milestones">>;
    };
    addMilestone: {
      mutate(input: {
        goalId: string;
        title: string;
        order?: number;
      }): Promise<GoalMilestoneSummary>;
    };
    updateMilestoneStatus: {
      mutate(input: {
        milestoneId: string;
        status: GoalMilestoneStatus;
      }): Promise<GoalMilestoneSummary>;
    };
    update: {
      mutate(input: {
        goalId: string;
        title?: string;
        description?: string | null;
        priority?: TaskPriority;
        defaultAgentId?: string | null;
        successCriteria?: string[] | null;
      }): Promise<Omit<GoalSummary, "milestones">>;
    };
    overview: {
      query(input: { goalId: string }): Promise<GoalOverview>;
    };
    startOrchestration: {
      mutate(input: { goalId: string }): Promise<{
        goal: Omit<GoalSummary, "milestones">;
        action: "no_change" | "planned" | "progressed" | "blocked" | "unblocked" | "completed";
        detail: string;
      }>;
    };
    setOrchestrationEnabled: {
      mutate(input: { goalId: string; enabled: boolean }): Promise<Omit<GoalSummary, "milestones">>;
    };
  };
  agentRuns: {
    list: {
      query(input: { workspaceId: string }): Promise<AgentRunSummary[]>;
    };
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
      mutate(input: { workspaceId: string; key: string }): Promise<{
        extension: ExtensionSummary;
        pluginInstall: ExtensionPluginInstallResult | null;
      }>;
    };
    setEnabled: {
      mutate(input: { id: string; enabled: boolean }): Promise<ExtensionSummary>;
    };
    updateConfig: {
      mutate(input: { id: string; config: Record<string, unknown> }): Promise<ExtensionSummary>;
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
      mutate(input: { id: string; domain?: string; repoPath?: string }): Promise<SeoProjectSummary>;
    };
    deleteProject: {
      mutate(input: { id: string }): Promise<void>;
    };
    setFixerAgent: {
      mutate(input: { id: string; agentId: string | null }): Promise<SeoProjectSummary>;
    };
    setSchedule: {
      mutate(input: { id: string; cronExpression: string | null }): Promise<SeoProjectSummary>;
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
    listAllFindings: {
      query(input: { seoProjectId: string }): Promise<SeoFindingSummary[]>;
    };
    listBlogPosts: {
      query(input: { seoProjectId: string }): Promise<SeoBlogPostSummary[]>;
    };
    runAnalysis: {
      mutate(input: { seoProjectId: string }): Promise<SeoAnalysisRunSummary>;
    };
    dispatchFix: {
      mutate(input: { seoProjectId: string; findingIds: string[] }): Promise<{
        taskId: string;
        runId: string;
        output: string;
        modelId: string;
        pluginSkillsUsed: string[];
      }>;
    };
    generateBlogPost: {
      mutate(input: { seoProjectId: string; keyword: string }): Promise<SeoBlogPostSummary>;
    };
  };
  leadScout: {
    listCampaigns: {
      query(input: { workspaceId: string }): Promise<LeadScoutCampaignSummary[]>;
    };
    createCampaign: {
      mutate(input: {
        workspaceId: string;
        name: string;
        postalCode: string;
        country?: string;
        radiusKm?: number;
        niches?: string[];
        maxResultsPerRun?: number;
        provider: LeadScoutProvider;
        minConfidence?: number;
        outreachMode?: LeadScoutOutreachMode;
      }): Promise<LeadScoutCampaignSummary>;
    };
    updateCampaign: {
      mutate(input: {
        id: string;
        name?: string;
        postalCode?: string;
        country?: string;
        radiusKm?: number;
        niches?: string[];
        maxResultsPerRun?: number;
        provider?: LeadScoutProvider;
        minConfidence?: number;
        outreachMode?: LeadScoutOutreachMode;
        autoGeneratePrototype?: boolean;
        autoDraftEmail?: boolean;
        autoSendAfterApproval?: boolean;
        requireApprovalBeforePrototype?: boolean;
        requireApprovalBeforeEmailSend?: boolean;
        prototypeAgentId?: string | null;
      }): Promise<LeadScoutCampaignSummary>;
    };
    deleteCampaign: {
      mutate(input: { id: string }): Promise<void>;
    };
    setCampaignSchedule: {
      mutate(input: {
        id: string;
        cronExpression: string | null;
      }): Promise<LeadScoutCampaignSummary>;
    };
    listSourceConfigs: {
      query(input: { workspaceId: string }): Promise<LeadScoutSourceConfigSummary[]>;
    };
    upsertSourceConfig: {
      mutate(input: {
        workspaceId: string;
        provider: LeadScoutProvider;
        config?: Record<string, unknown>;
        apiKey?: string | null;
        enabled?: boolean;
      }): Promise<LeadScoutSourceConfigSummary>;
    };
    runScan: {
      mutate(input: { campaignId: string; csvText?: string }): Promise<LeadScoutScanRunSummary>;
    };
    listScanRuns: {
      query(input: { campaignId: string }): Promise<LeadScoutScanRunSummary[]>;
    };
    listLeads: {
      query(input: { campaignId: string }): Promise<LeadScoutLeadSummary[]>;
    };
    getLead: {
      query(input: { id: string }): Promise<LeadScoutLeadSummary>;
    };
    markLeadReviewed: {
      mutate(input: { id: string }): Promise<LeadScoutLeadSummary | null>;
    };
    resetLeadForResend: {
      mutate(input: { id: string }): Promise<LeadScoutLeadSummary>;
    };
    listPrototypes: {
      query(input: { leadId: string }): Promise<LeadScoutPrototypeSummary[]>;
    };
    generatePrototype: {
      mutate(input: { leadId: string }): Promise<LeadScoutPrototypeSummary>;
    };
    approvePrototype: {
      mutate(input: { id: string }): Promise<LeadScoutPrototypeSummary>;
    };
    listDrafts: {
      query(input: { leadId: string }): Promise<LeadScoutOutreachDraftSummary[]>;
    };
    generateDraft: {
      mutate(input: { leadId: string }): Promise<LeadScoutOutreachDraftSummary>;
    };
    approveDraft: {
      mutate(input: { id: string }): Promise<LeadScoutOutreachDraftSummary>;
    };
    rejectDraft: {
      mutate(input: { id: string }): Promise<LeadScoutOutreachDraftSummary>;
    };
    sendDraft: {
      mutate(input: { id: string }): Promise<LeadScoutOutreachDraftSummary>;
    };
    listSuppressions: {
      query(input: { workspaceId: string }): Promise<LeadScoutSuppressionSummary[]>;
    };
    addSuppression: {
      mutate(input: {
        workspaceId: string;
        email?: string | null;
        domain?: string | null;
        reason: string;
      }): Promise<LeadScoutSuppressionSummary>;
    };
    getEmailSettings: {
      query(input: { workspaceId: string }): Promise<LeadScoutEmailSettingsSummary | null>;
    };
    upsertEmailSettings: {
      mutate(input: {
        workspaceId: string;
        provider?: LeadScoutEmailProvider;
        fromName: string;
        fromEmail: string;
        replyTo?: string | null;
        credentials?: Record<string, string> | null;
        dailySendLimit?: number;
        perCampaignSendLimit?: number;
        dryRunMode?: boolean;
        legalFooter?: string | null;
        unsubscribeText?: string;
      }): Promise<LeadScoutEmailSettingsSummary>;
    };
    testEmailConnection: {
      mutate(input: { workspaceId: string }): Promise<{ ok: boolean; message: string }>;
    };
    sendTestEmail: {
      mutate(input: {
        workspaceId: string;
        toEmail: string;
      }): Promise<{ sent: boolean; dryRun: boolean }>;
    };
  };
  automations: {
    list: {
      query(input: { workspaceId: string }): Promise<AutomationSummary[]>;
    };
    create: {
      mutate(input: {
        workspaceId: string;
        targetKind?: AutomationTargetKind;
        agentId?: string;
        workflowId?: string;
        name: string;
        triggerType?: AutomationTriggerType;
        cronExpression?: string;
        watchPath?: string;
        watchGlob?: string;
        prompt?: string;
        enabled?: boolean;
      }): Promise<AutomationSummary>;
    };
    update: {
      mutate(input: {
        id: string;
        name?: string;
        agentId?: string;
        workflowId?: string;
        cronExpression?: string;
        watchPath?: string;
        watchGlob?: string;
        prompt?: string;
      }): Promise<AutomationSummary>;
    };
    setEnabled: {
      mutate(input: { id: string; enabled: boolean }): Promise<AutomationSummary>;
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
      query(input: { workspaceId: string; status?: ApprovalStatus }): Promise<ApprovalSummary[]>;
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
      query(input: { workspaceId: string; limit?: number }): Promise<AuditLogSummary[]>;
    };
  };
  stats: {
    overview: {
      query(input: { workspaceId: string; days?: number }): Promise<WorkspaceStatsOverview>;
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
  memory: {
    list: {
      query(input: { workspaceId: string; type?: MemoryType }): Promise<MemoryEntrySummary[]>;
    };
    create: {
      mutate(input: {
        workspaceId: string;
        type: MemoryType;
        content: string;
        source?: MemorySource;
        confidence?: number;
        expiresAt?: Date | null;
      }): Promise<MemoryEntrySummary>;
    };
    update: {
      mutate(input: {
        id: string;
        content?: string;
        confidence?: number;
        expiresAt?: Date | null;
      }): Promise<MemoryEntrySummary>;
    };
    delete: {
      mutate(input: { id: string }): Promise<void>;
    };
  };
  artifacts: {
    list: {
      query(input: { workspaceId: string }): Promise<ArtifactSummary[]>;
    };
    listByTask: {
      query(input: { taskId: string }): Promise<ArtifactSummary[]>;
    };
    get: {
      query(input: { id: string }): Promise<ArtifactSummary>;
    };
  };
  coding: {
    repoInfo: {
      query(input: {
        workspaceId: string;
        rootDir: string;
      }): Promise<{ isGitRepo: boolean; branch: string | null; error: string | null }>;
    };
    status: {
      query(input: { workspaceId: string; rootDir: string }): Promise<GitStatusEntry[]>;
    };
    diff: {
      query(input: { workspaceId: string; rootDir: string; filePath?: string }): Promise<string>;
    };
    listDirectory: {
      query(input: {
        workspaceId: string;
        rootDir: string;
        relativePath?: string;
      }): Promise<{ name: string; isDirectory: boolean }[]>;
    };
    searchFiles: {
      query(input: {
        workspaceId: string;
        rootDir: string;
        query: string;
      }): Promise<FileSearchMatch[]>;
    };
  };
};

export type GitFileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked" | "unknown";
export type GitStatusEntry = { path: string; status: GitFileStatus; staged: boolean };
export type FileSearchMatch = {
  path: string;
  matchedOn: "filename" | "content";
  snippet: string | null;
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
