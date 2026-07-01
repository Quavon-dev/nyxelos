import { createTRPCClient, httpBatchLink } from "@trpc/client";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";

export type ModelSummary = {
  id: string;
  label: string;
  kind: "local" | "cloud";
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
  record: InstallationSummary | null;
};

export type WorkspaceSummary = {
  id: string;
  name: string;
  customInstructions: string | null;
};

export type ChatSummary = {
  id: string;
  workspaceId: string;
  agentId: string | null;
  title: string;
  modelId: string;
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
  modelId: string;
  autonomyLevel: AutonomyLevel;
  skillIds: string[];
  mcpServerIds: string[];
  delegateAgentIds: string[];
  createdAt: Date;
};

export type SkillSummary = {
  id: string;
  name: string;
  description: string;
  permissions: { network: string[]; filesystem: string[] };
  sensitive: boolean;
};

export type AutomationSummary = {
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
};

export type ApprovalStatus = "pending" | "approved" | "rejected";
export type ApprovalKind = "skill" | "mcp";

export type ApprovalSummary = {
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

export type KnowledgeBaseConfigSummary = {
  workspaceId: string;
  vaultPath: string;
  obsidianRestUrl: string | null;
  obsidianApiKey: string | null;
  docsAgentEnabled: boolean;
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

type NyxelTrpcClient = {
  demoUser: {
    query(): Promise<DemoUser>;
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
      query(): Promise<ModelSummary[]>;
    };
  };
  skills: {
    list: {
      query(): Promise<SkillSummary[]>;
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
    updateInstructions: {
      mutate(input: {
        workspaceId: string;
        customInstructions: string | null;
      }): Promise<WorkspaceSummary>;
    };
  };
  chats: {
    list: {
      query(input: { workspaceId: string }): Promise<ChatSummary[]>;
    };
    create: {
      mutate(input: {
        workspaceId: string;
        title: string;
        modelId?: string;
        agentId?: string;
      }): Promise<ChatSummary>;
    };
    messages: {
      query(input: { chatId: string }): Promise<MessageSummary[]>;
    };
  };
  agents: {
    list: {
      query(input: { workspaceId: string }): Promise<AgentSummary[]>;
    };
    create: {
      mutate(input: {
        workspaceId: string;
        name: string;
        systemPrompt?: string;
        modelId: string;
        autonomyLevel?: AutonomyLevel;
        skillIds?: string[];
        mcpServerIds?: string[];
        delegateAgentIds?: string[];
      }): Promise<AgentSummary>;
    };
  };
  mcpServers: {
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
      }): Promise<McpServerSummary>;
    };
    delete: {
      mutate(input: { id: string }): Promise<void>;
    };
    listTools: {
      query(input: { id: string }): Promise<McpToolSummary[]>;
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
        cronExpression: string;
        prompt: string;
        enabled?: boolean;
      }): Promise<AutomationSummary>;
    };
    setEnabled: {
      mutate(input: { id: string; enabled: boolean }): Promise<AutomationSummary>;
    };
    delete: {
      mutate(input: { id: string }): Promise<void>;
    };
    runNow: {
      mutate(input: { id: string }): Promise<AutomationSummary>;
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
