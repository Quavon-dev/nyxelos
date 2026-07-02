"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUp, Code2, FileText, Palette, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  type AttachedFile,
  ChatComposerToolbar,
  type ChatToolSelection,
} from "@/components/chat/chat-composer-toolbar";
import { ChatTopBar } from "@/components/chat/chat-top-bar";
import { WorkingDirectoryPicker } from "@/components/chat/working-directory-picker";
import { Textarea } from "@/components/ui/textarea";
import { serializeChatMessageContent } from "@/lib/chat-message";
import { type ChatToolMode, trpcClient } from "@/lib/trpc";
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
        animation: "orb-spin 10s ease-in-out infinite, orb-glow 4s ease-in-out infinite",
      }}
    >
      <span
        className="absolute left-[38%] top-[30%] size-1 rounded-full bg-white/90"
        style={{ animation: "orb-twinkle 2.4s ease-in-out infinite" }}
      />
      <span
        className="absolute left-[58%] top-[55%] size-0.5 rounded-full bg-white/70"
        style={{ animation: "orb-twinkle 3.1s ease-in-out infinite 0.6s" }}
      />
    </div>
  );
}

export default function ChatLandingPage() {
  return (
    <Suspense>
      <ChatLandingPageContent />
    </Suspense>
  );
}

function ChatLandingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const installationQuery = useInstallation();
  const workspaceId = installationQuery.data?.record?.primaryWorkspaceId;
  const ownerUserId = installationQuery.data?.record?.ownerUserId;
  const defaultWorkingDirectory = installationQuery.data?.defaultWorkingDirectory ?? "";
  const projectId = searchParams.get("projectId");

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
  const workspaceQuery = useQuery({
    queryKey: ["workspace", workspaceId],
    queryFn: () => trpcClient.workspaces.get.query({ workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
  });

  const [message, setMessage] = useState("");
  const [modelId, setModelId] = useState("");
  const [toolSelection, setToolSelection] = useState<ChatToolSelection | null>(null);
  const [toolMode, setToolMode] = useState<ChatToolMode | null>(null);
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const [workingDirectory, setWorkingDirectory] = useState("");

  useEffect(() => {
    const models = modelsQuery.data;
    const firstModel = models?.[0];
    if (modelId || !firstModel) return;
    const defaultModelId = workspaceQuery.data?.defaultModelId;
    const preferred =
      defaultModelId && models.some((model) => model.id === defaultModelId)
        ? defaultModelId
        : firstModel.id;
    setModelId(preferred);
  }, [modelId, modelsQuery.data, workspaceQuery.data]);

  useEffect(() => {
    if (!workingDirectory && defaultWorkingDirectory) {
      setWorkingDirectory(defaultWorkingDirectory);
    }
  }, [workingDirectory, defaultWorkingDirectory]);

  const createChat = useMutation({
    mutationFn: async (vars: { text: string; file: AttachedFile | null }) => {
      if (!workspaceId) throw new Error("Installation is incomplete.");
      if (!modelId) throw new Error("No model selected.");
      if (!workingDirectory.trim()) throw new Error("Choose a working directory.");
      if (!vars.text.trim() && !vars.file) {
        throw new Error("Add a message or attach a file.");
      }

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
          skillIds: toolSelection.skillIds,
          toolIds: toolSelection.toolIds,
          mcpServerIds: toolSelection.mcpServerIds,
          mcpToolFilter: toolSelection.mcpToolFilter,
          autoAttachWorkspaceTools: false,
        });
        agentId = agent.id;
      }

      const outgoing = vars.file
        ? serializeChatMessageContent(vars.text.trim(), [vars.file])
        : vars.text.trim();

      const chat = await trpcClient.chats.create.mutate({
        workspaceId,
        workingDirectory,
        title: vars.text.trim().slice(0, 60) || vars.file?.name || "New chat",
        modelId,
        agentId,
        projectId,
        toolMode: toolMode ?? undefined,
      });
      return { chat, outgoing };
    },
    onSuccess: ({ chat, outgoing }) => {
      sessionStorage.setItem(`nyxel:chat-draft:${chat.id}`, outgoing);
      router.push(`/chat/${chat.id}`);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if ((!message.trim() && !attachedFile) || !modelId || createChat.isPending) return;
    createChat.mutate({ text: message, file: attachedFile });
  }

  const name = ownerQuery.data?.name?.split(" ")[0];
  const effectiveToolMode = toolMode ?? workspaceQuery.data?.defaultToolPolicy.mode ?? "default";

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-3">
        <ChatTopBar models={modelsQuery.data ?? []} modelId={modelId} onModelChange={setModelId} />
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-8 p-6">
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
              <WorkingDirectoryPicker value={workingDirectory} onChange={setWorkingDirectory} />
              {/* Same compact toolbar used in an existing chat thread: Skills
               * and Artifacts only show up as pills once the user has pinned
               * them via the "..." menu, so this row stays uncluttered until
               * something is actually turned on, instead of always showing
               * every tool as a badge. */}
              <div className="min-w-0 flex-1">
                <ChatComposerToolbar
                  mode="compact"
                  workspaceId={workspaceId}
                  modelId={modelId}
                  toolSelection={toolSelection}
                  onToolSelectionChange={setToolSelection}
                  toolMode={effectiveToolMode}
                  onToolModeChange={setToolMode}
                  attachedFile={attachedFile}
                  onAttachedFileChange={setAttachedFile}
                  onVoiceResult={(text) => {
                    const combined = message ? `${message} ${text}` : text;
                    setMessage(combined);
                    if (!modelId || createChat.isPending) return;
                    createChat.mutate({ text: combined, file: attachedFile });
                  }}
                  showContextWindow={false}
                />
              </div>
              <button
                type="submit"
                disabled={(!message.trim() && !attachedFile) || !modelId || createChat.isPending}
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
    </div>
  );
}
