"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { trpcClient } from "@/lib/trpc";

export default function HomePage() {
  const router = useRouter();

  const modelsQuery = useQuery({
    queryKey: ["models", "list"],
    queryFn: () => trpcClient.models.list.query(),
  });

  // Resolves (and, on first run, creates) the demo user's workspace so the
  // rest of the page — including the settings/agents/MCP nav links — has
  // somewhere to point to without requiring a click first.
  const bootstrapQuery = useQuery({
    queryKey: ["bootstrap"],
    queryFn: async () => {
      const user = await trpcClient.demoUser.query();
      const workspaces = await trpcClient.workspaces.list.query({ userId: user.id });
      const workspace =
        workspaces[0] ??
        (await trpcClient.workspaces.create.mutate({ userId: user.id, name: "Personal" }));
      return { user, workspace };
    },
  });

  const startChat = useMutation({
    mutationFn: async () => {
      if (!bootstrapQuery.data) throw new Error("Still loading — try again in a moment.");
      const models = await trpcClient.models.list.query();
      const modelId = models[0]?.id;
      if (!modelId) {
        throw new Error("No models available. Start a local model or set an API key.");
      }
      return trpcClient.chats.create.mutate({
        workspaceId: bootstrapQuery.data.workspace.id,
        title: "Demo chat",
        modelId,
      });
    },
    onSuccess: (chat) => {
      router.push(`/chat/${chat.id}`);
    },
  });

  const workspaceId = bootstrapQuery.data?.workspace.id;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nyxel</h1>
        <p className="text-muted-foreground">Self-hosted agentic OS — Phase 1 scaffold.</p>
      </div>

      {workspaceId && (
        <nav className="flex gap-4 text-sm">
          <Link
            className="underline underline-offset-4"
            href={`/workspace/${workspaceId}/settings`}
          >
            Custom instructions
          </Link>
          <Link className="underline underline-offset-4" href={`/workspace/${workspaceId}/agents`}>
            Agents
          </Link>
          <Link
            className="underline underline-offset-4"
            href={`/workspace/${workspaceId}/mcp-servers`}
          >
            MCP servers
          </Link>
        </nav>
      )}

      <Card className="space-y-2 p-4">
        <h2 className="font-medium">Detected models</h2>
        {modelsQuery.isLoading && (
          <p className="text-sm text-muted-foreground">Checking for local models…</p>
        )}
        {modelsQuery.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No models detected. Start Ollama or LM Studio, or set ANTHROPIC_API_KEY.
          </p>
        )}
        <ul className="space-y-1">
          {modelsQuery.data?.map((m) => (
            <li key={m.id} className="flex justify-between text-sm">
              <span>{m.label}</span>
              <span className="text-muted-foreground">{m.kind}</span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="space-y-2">
        <Button onClick={() => startChat.mutate()} disabled={startChat.isPending}>
          {startChat.isPending ? "Starting…" : "Start demo chat"}
        </Button>
        {startChat.isError && (
          <p className="text-sm text-destructive">{(startChat.error as Error).message}</p>
        )}
      </div>
    </div>
  );
}
