export type MessageRole = "user" | "assistant" | "system" | "tool";

export type AgentAutonomyLevel = "chat" | "assisted" | "autonomous" | "super_agent";
export type InstallationMode = "pc" | "server";
export type ModelProviderKind = "anthropic" | "openai" | "openai_compatible";

export type McpTransport = "stdio" | "http";

export type ApprovalStatus = "pending" | "approved" | "rejected";
export type ApprovalKind = "skill" | "mcp";
export type AuditActor = "chat" | "automation" | "approval" | "delegate";
export type AuditStatus = "success" | "error" | "pending_approval" | "rejected";

export interface WorkspaceRecord {
  id: string;
  name: string;
  customInstructions: string | null;
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
  agentId: string | null;
  title: string;
  modelId: string;
  createdAt: Date;
}

export interface MessageRecord {
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
  modelId: string;
  autonomyLevel: AgentAutonomyLevel;
  skillIds: string[];
  mcpServerIds: string[];
  /** Only meaningful for autonomyLevel "super_agent" — see ADR-0011. */
  delegateAgentIds: string[];
  createdAt: Date;
}

export interface AutomationRecord {
  id: string;
  workspaceId: string;
  agentId: string;
  name: string;
  cronExpression: string;
  prompt: string;
  enabled: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
}

export interface ApprovalRequestRecord {
  id: string;
  workspaceId: string;
  agentId: string;
  chatId: string | null;
  automationId: string | null;
  kind: ApprovalKind;
  skillId: string | null;
  mcpServerId: string | null;
  mcpToolName: string | null;
  toolLabel: string;
  input: Record<string, unknown>;
  status: ApprovalStatus;
  resultOutput: unknown;
  errorMessage: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
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
}

export interface McpServerRecord {
  id: string;
  workspaceId: string;
  name: string;
  transport: McpTransport;
  command: string | null;
  args: string[] | null;
  url: string | null;
  enabled: boolean;
  createdAt: Date;
}

export interface KnowledgeBaseConfigRecord {
  workspaceId: string;
  vaultPath: string;
  obsidianRestUrl: string | null;
  obsidianApiKey: string | null;
  docsAgentEnabled: boolean;
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
  enabled: boolean;
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
  getInstallation(): Promise<InstallationRecord | null>;
  completeInstallation(input: {
    mode: InstallationMode;
    ownerUserId: string;
    primaryWorkspaceId: string;
    appUrl?: string | null;
  }): Promise<InstallationRecord>;

  createWorkspace(input: { userId: string; name: string }): Promise<WorkspaceRecord>;
  listWorkspacesByUser(userId: string): Promise<WorkspaceRecord[]>;
  listWorkspaces(): Promise<WorkspaceRecord[]>;
  getWorkspace(workspaceId: string): Promise<WorkspaceRecord | null>;
  updateWorkspaceInstructions(input: {
    workspaceId: string;
    customInstructions: string | null;
  }): Promise<WorkspaceRecord>;

  createModelInstallation(input: {
    workspaceId: string;
    label: string;
    providerKind: ModelProviderKind;
    baseUrl: string;
    apiKey?: string | null;
    modelIds: string[];
    enabled?: boolean;
  }): Promise<ModelInstallationRecord>;
  listModelInstallationsByWorkspace(workspaceId: string): Promise<ModelInstallationRecord[]>;
  getModelInstallation(id: string): Promise<ModelInstallationRecord | null>;
  deleteModelInstallation(id: string): Promise<void>;

  createChat(input: {
    workspaceId: string;
    title: string;
    modelId: string;
    agentId?: string | null;
  }): Promise<ChatRecord>;
  listChatsByWorkspace(workspaceId: string): Promise<ChatRecord[]>;
  getChat(chatId: string): Promise<ChatRecord | null>;

  addMessage(input: { chatId: string; role: MessageRole; content: string }): Promise<MessageRecord>;
  listMessages(chatId: string): Promise<MessageRecord[]>;

  createAgent(input: {
    workspaceId: string;
    name: string;
    systemPrompt?: string | null;
    modelId: string;
    autonomyLevel?: AgentAutonomyLevel;
    skillIds?: string[];
    mcpServerIds?: string[];
    delegateAgentIds?: string[];
  }): Promise<AgentRecord>;
  listAgentsByWorkspace(workspaceId: string): Promise<AgentRecord[]>;
  getAgent(agentId: string): Promise<AgentRecord | null>;

  createMcpServer(input: {
    workspaceId: string;
    name: string;
    transport: McpTransport;
    command?: string | null;
    args?: string[] | null;
    url?: string | null;
  }): Promise<McpServerRecord>;
  listMcpServersByWorkspace(workspaceId: string): Promise<McpServerRecord[]>;
  getMcpServer(id: string): Promise<McpServerRecord | null>;
  deleteMcpServer(id: string): Promise<void>;

  getKnowledgeBaseConfig(workspaceId: string): Promise<KnowledgeBaseConfigRecord | null>;
  listKnowledgeBaseConfigs(): Promise<KnowledgeBaseConfigRecord[]>;
  upsertKnowledgeBaseConfig(input: {
    workspaceId: string;
    vaultPath: string;
    obsidianRestUrl?: string | null;
    obsidianApiKey?: string | null;
    docsAgentEnabled?: boolean;
  }): Promise<KnowledgeBaseConfigRecord>;
  updateKnowledgeBaseSyncStatus(input: {
    workspaceId: string;
    lastDocsSyncAt?: Date | null;
    lastDocsSyncError?: string | null;
  }): Promise<KnowledgeBaseConfigRecord>;

  createAutomation(input: {
    workspaceId: string;
    agentId: string;
    name: string;
    cronExpression: string;
    prompt: string;
    enabled?: boolean;
    nextRunAt?: Date | null;
  }): Promise<AutomationRecord>;
  listAutomationsByWorkspace(workspaceId: string): Promise<AutomationRecord[]>;
  listDueAutomations(now: Date): Promise<AutomationRecord[]>;
  getAutomation(id: string): Promise<AutomationRecord | null>;
  updateAutomationRun(input: {
    id: string;
    lastRunAt: Date;
    nextRunAt: Date | null;
  }): Promise<AutomationRecord>;
  setAutomationNextRun(id: string, nextRunAt: Date | null): Promise<AutomationRecord>;
  setAutomationEnabled(id: string, enabled: boolean): Promise<AutomationRecord>;
  deleteAutomation(id: string): Promise<void>;

  createApprovalRequest(input: {
    workspaceId: string;
    agentId: string;
    chatId?: string | null;
    automationId?: string | null;
    kind: ApprovalKind;
    skillId?: string | null;
    mcpServerId?: string | null;
    mcpToolName?: string | null;
    toolLabel: string;
    input: Record<string, unknown>;
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
  }): Promise<AuditLogRecord>;
  listAuditLogByWorkspace(workspaceId: string, limit?: number): Promise<AuditLogRecord[]>;
}
