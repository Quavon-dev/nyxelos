"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUp, Clock, Code2, FileText, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpcClient } from "@/lib/trpc";
import { useInstallation } from "@/lib/use-installation";

const QUICK_ACTIONS = [
  { label: "Summarize", icon: FileText, prompt: "Summarize " },
  { label: "Code", icon: Code2, prompt: "Write code to " },
  { label: "Automate", icon: Clock, prompt: "Set up an automation that " },
  { label: "Research", icon: Search, prompt: "Research " },
];

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function ChatLandingPage() {
  const router = useRouter();
  const installationQuery = useInstallation();
  const workspaceId = installationQuery.data?.record?.primaryWorkspaceId;

  const demoUserQuery = useQuery({
    queryKey: ["demoUser"],
    queryFn: () => trpcClient.demoUser.query(),
  });
  const modelsQuery = useQuery({
    queryKey: ["models", "list", workspaceId],
    queryFn: () => trpcClient.models.list.query({ workspaceId }),
    enabled: Boolean(workspaceId),
  });

  const [message, setMessage] = useState("");
  const [modelId, setModelId] = useState("");

  useEffect(() => {
    if (!modelId && modelsQuery.data?.[0]) setModelId(modelsQuery.data[0].id);
  }, [modelId, modelsQuery.data]);

  const createChat = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error("Installation is incomplete.");
      const chat = await trpcClient.chats.create.mutate({
        workspaceId,
        title: message.trim().slice(0, 60) || "New chat",
        modelId: modelId || undefined,
      });
      return chat;
    },
    onSuccess: (chat) => {
      router.push(`/chat/${chat.id}?draft=${encodeURIComponent(message.trim())}`);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim() || createChat.isPending) return;
    createChat.mutate();
  }

  const name = demoUserQuery.data?.name?.split(" ")[0];

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-8 p-6">
      <div className="space-y-1 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          {getGreeting()}
          {name ? `, ${name}` : ""}
        </h1>
        <p className="text-muted-foreground">How can I help you today?</p>
      </div>

      <form className="w-full space-y-3" onSubmit={handleSubmit}>
        <div className="space-y-2 rounded-2xl border bg-card p-3 shadow-xs">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="Ask me anything…"
            rows={3}
            className="resize-none border-0 p-1 shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-between">
            <Select value={modelId} onValueChange={setModelId}>
              <SelectTrigger size="sm">
                <SelectValue placeholder="Model" />
              </SelectTrigger>
              <SelectContent>
                {modelsQuery.data?.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="submit"
              disabled={!message.trim() || createChat.isPending}
              className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => setMessage(action.prompt)}
              className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <action.icon className="size-3.5" />
              {action.label}
            </button>
          ))}
        </div>

        {createChat.isError && (
          <p className="text-center text-sm text-destructive">
            {(createChat.error as Error).message}
          </p>
        )}
      </form>
    </div>
  );
}
