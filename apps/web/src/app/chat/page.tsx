"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUp, Code2, FileText, Globe, Palette, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  type AttachedFile,
  ChatComposerToolbar,
  type ChatToolSelection,
} from "@/components/chat/chat-composer-toolbar";
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
  { label: "Summary", icon: FileText, prompt: "Summarize " },
  { label: "Code", icon: Code2, prompt: "Write code to " },
  { label: "Design", icon: Palette, prompt: "Design " },
  { label: "Research", icon: Search, prompt: "Research " },
];

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** The soft multi-color orb above the greeting — a purely decorative brand
 * mark built from the app's own theme colors (primary + chart palette from
 * globals.css) rather than an unrelated palette, so it actually looks like
 * it belongs to this app. */
function GreetingOrb() {
  return (
    <div
      className="relative size-16 shrink-0 rounded-full"
      style={{
        backgroundImage:
          "radial-gradient(circle at 30% 28%, var(--chart-1) 0%, transparent 55%)," +
          "radial-gradient(circle at 68% 65%, var(--primary) 0%, transparent 60%)," +
          "radial-gradient(circle at 45% 80%, var(--chart-3) 0%, transparent 55%)," +
          "radial-gradient(circle at 60% 30%, var(--chart-5) 0%, transparent 50%)",
        boxShadow: "0 0 32px oklch(0.841 0.238 128.85 / 30%)",
      }}
    >
      <span className="absolute left-[38%] top-[30%] size-1 rounded-full bg-white/90" />
      <span className="absolute left-[58%] top-[55%] size-0.5 rounded-full bg-white/70" />
    </div>
  );
}

export default function ChatLandingPage() {
  const router = useRouter();
  const installationQuery = useInstallation();
  const workspaceId = installationQuery.data?.record?.primaryWorkspaceId;
  const ownerUserId = installationQuery.data?.record?.ownerUserId;

  // The real account name tied to this installation — not the demoUser
  // stub, which is a fixed "Demo User" fallback for local dev only.
  const ownerQuery = useQuery({
    queryKey: ["users", "get", ownerUserId],
    queryFn: () => trpcClient.users.get.query({ userId: ownerUserId! }),
    enabled: Boolean(ownerUserId),
  });
  const modelsQuery = useQuery({
    queryKey: ["models", "list", workspaceId],
    queryFn: () => trpcClient.models.list.query({ workspaceId }),
    enabled: Boolean(workspaceId),
  });
  const skillsQuery = useQuery({
    queryKey: ["skills", "list", workspaceId],
    queryFn: () => trpcClient.skills.list.query({ workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
  });

  const [message, setMessage] = useState("");
  const [modelId, setModelId] = useState("");
  const [toolSelection, setToolSelection] = useState<ChatToolSelection | null>(null);
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);

  useEffect(() => {
    if (!modelId && modelsQuery.data?.[0]) setModelId(modelsQuery.data[0].id);
  }, [modelId, modelsQuery.data]);

  const createChat = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error("Installation is incomplete.");
      if (!modelId) throw new Error("No model selected.");

      // A plain chat (toolSelection === null) gets the workspace's default
      // agent — every skill, every enabled MCP server — provisioned
      // automatically server-side (see chats.create / auto-agent.ts). Only
      // when the toolbar was actually touched do we create a narrower,
      // one-off agent here and pin the chat to it.
      let agentId: string | undefined;
      if (toolSelection) {
        const agent = await trpcClient.agents.create.mutate({
          workspaceId,
          name: "Chat — custom tools",
          modelId,
          autonomyLevel: "assisted",
          skillIds: toolSelection.skillsEnabled ? (skillsQuery.data ?? []).map((s) => s.id) : [],
          mcpServerIds: toolSelection.mcpServerIds,
          mcpToolFilter: toolSelection.mcpToolFilter,
          autoAttachWorkspaceTools: false,
        });
        agentId = agent.id;
      }

      // A file attached via the "File search" pill isn't uploaded anywhere —
      // its text content is read client-side and folded straight into the
      // first message so the model sees it as context.
      const outgoing = attachedFile
        ? `${message.trim()}\n\n---\nAttached file: ${attachedFile.name}\n\`\`\`\n${attachedFile.content}\n\`\`\``
        : message.trim();

      const chat = await trpcClient.chats.create.mutate({
        workspaceId,
        title: message.trim().slice(0, 60) || "New chat",
        modelId,
        agentId,
      });
      return { chat, outgoing };
    },
    onSuccess: ({ chat, outgoing }) => {
      router.push(`/chat/${chat.id}?draft=${encodeURIComponent(outgoing)}`);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim() || !modelId || createChat.isPending) return;
    createChat.mutate();
  }

  const name = ownerQuery.data?.name?.split(" ")[0];

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center gap-8 p-6">
      <div className="flex flex-col items-center gap-5 text-center">
        <GreetingOrb />
        <h1 className="text-3xl font-semibold tracking-tight">
          {getGreeting()}
          {name ? `, ${name}` : ""}
        </h1>
        <p className="-mt-4 text-3xl font-semibold tracking-tight">
          How can I{" "}
          <span className="bg-gradient-to-r from-primary to-[var(--chart-2)] bg-clip-text text-transparent">
            help you today?
          </span>
        </p>
      </div>

      <form className="w-full space-y-3" onSubmit={handleSubmit}>
        <div className="space-y-2 rounded-2xl border bg-card p-3 shadow-sm">
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
            rows={2}
            className="resize-none border-0 p-1 text-base shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center gap-2">
            {/* Small, icon-led trigger with a capped width — this sits in the
             * same row as the composer's own icon-sized pills, so a
             * full-height "Model" label + long model name would dwarf
             * everything next to it. line-clamp-1 (already wired into
             * SelectTrigger's *:data-[slot=select-value] styles) truncates
             * long labels once max-w-28 caps the box. */}
            <Select value={modelId} onValueChange={setModelId}>
              <SelectTrigger
                size="sm"
                className="h-8 max-w-28 shrink-0 gap-1 rounded-full border-none bg-muted px-2.5 text-xs"
              >
                <Globe className="size-3.5 shrink-0 text-muted-foreground" />
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
            {/* Same compact toolbar used in an existing chat thread: Skills
             * and Artifacts only show up as pills once the user has pinned
             * them via the "..." menu, so this row stays uncluttered until
             * something is actually turned on, instead of always showing
             * every tool as a badge. */}
            <div className="min-w-0 flex-1">
              <ChatComposerToolbar
                mode="compact"
                workspaceId={workspaceId}
                toolSelection={toolSelection}
                onToolSelectionChange={setToolSelection}
                attachedFile={attachedFile}
                onAttachedFileChange={setAttachedFile}
                onVoiceResult={(text) => setMessage((prev) => (prev ? `${prev} ${text}` : text))}
              />
            </div>
            <button
              type="submit"
              disabled={!message.trim() || !modelId || createChat.isPending}
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-40"
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
