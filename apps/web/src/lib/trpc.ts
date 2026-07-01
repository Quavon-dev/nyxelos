import { createTRPCClient, httpBatchLink } from "@trpc/client";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";

export type ModelSummary = {
  id: string;
  label: string;
  kind: "local" | "cloud";
};

export type AutonomyLevel = "chat" | "assisted" | "autonomous" | "super_agent";
export type McpTransportKind = "stdio" | "http";

type DemoUser = {
  id: string;
  name: string;
  email: string;
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
  createdAt: Date;
};

export type SkillSummary = {
  id: string;
  name: string;
  description: string;
  permissions: { network: string[]; filesystem: string[] };
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

type NyxelTrpcClient = {
  demoUser: {
    query(): Promise<DemoUser>;
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
