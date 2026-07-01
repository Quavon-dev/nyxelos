export type MessageRole = "user" | "assistant" | "system" | "tool";

export type AgentAutonomyLevel = "chat" | "assisted" | "autonomous" | "super_agent";

export type McpTransport = "stdio" | "http";

export interface WorkspaceRecord {
  id: string;
  name: string;
  customInstructions: string | null;
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

  createWorkspace(input: { userId: string; name: string }): Promise<WorkspaceRecord>;
  listWorkspacesByUser(userId: string): Promise<WorkspaceRecord[]>;
  getWorkspace(workspaceId: string): Promise<WorkspaceRecord | null>;
  updateWorkspaceInstructions(input: {
    workspaceId: string;
    customInstructions: string | null;
  }): Promise<WorkspaceRecord>;

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
}
