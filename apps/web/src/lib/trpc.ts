import { createTRPCClient, httpBatchLink } from "@trpc/client";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";

export type ModelSummary = {
  id: string;
  label: string;
  kind: "local" | "cloud";
};

type DemoUser = {
  id: string;
  name: string;
  email: string;
};

type WorkspaceSummary = {
  id: string;
  name: string;
  customInstructions: string | null;
};

type ChatSummary = {
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

type NyxelTrpcClient = {
  demoUser: {
    query(): Promise<DemoUser>;
  };
  models: {
    list: {
      query(): Promise<ModelSummary[]>;
    };
  };
  workspaces: {
    list: {
      query(input: { userId: string }): Promise<WorkspaceSummary[]>;
    };
    create: {
      mutate(input: { userId: string; name: string }): Promise<WorkspaceSummary>;
    };
  };
  chats: {
    create: {
      mutate(input: { workspaceId: string; title: string; modelId: string }): Promise<ChatSummary>;
    };
    messages: {
      query(input: { chatId: string }): Promise<MessageSummary[]>;
    };
  };
};

/**
 * A vanilla tRPC client (not the TanStack Query proxy integration) called
 * from inside plain `useQuery`/`useMutation` hooks. Keeps end-to-end type
 * safety from the `AppRouter` type without depending on a specific
 * tRPC/TanStack Query integration package version. See ARCHITECTURE.md
 * section 3.
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
