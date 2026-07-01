"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
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

  const startChat = useMutation({
    mutationFn: async () => {
      const user = await trpcClient.demoUser.query();
      const workspaces = await trpcClient.workspaces.list.query({ userId: user.id });
      const workspace =
        workspaces[0] ??
        (await trpcClient.workspaces.create.mutate({ userId: user.id, name: "Personal" }));
      const models = await trpcClient.models.list.query();
      const modelId = models[0]?.id;
      if (!modelId) {
        throw new Error("No models available. Start a local model or set an API key.");
      }
      return trpcClient.chats.create.mutate({
        workspaceId: workspace.id,
        title: "Demo chat",
        modelId,
      });
    },
    onSuccess: (chat) => {
      router.push(`/chat/${chat.id}`);
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nyxel</h1>
        <p className="text-muted-foreground">Self-hosted agentic OS — Phase 0 scaffold.</p>
      </div>

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
