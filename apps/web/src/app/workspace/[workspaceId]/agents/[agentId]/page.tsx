"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Square, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeaderSkeleton } from "@/components/loading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { AgentRunStatus, AutonomyLevel, TaskStatus } from "@/lib/trpc";
import { trpcClient } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const AUTONOMY_BADGE: Record<AutonomyLevel, string> = {
  chat: "border-0 bg-blue-500/15 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  assisted: "border-0 bg-amber-500/15 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  autonomous: "border-0 bg-green-500/15 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  super_agent:
    "border-0 bg-violet-500/15 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300",
};

const RUN_STATUS_BADGE: Record<AgentRunStatus, string> = {
  pending: "border-0 bg-muted text-muted-foreground",
  running: "border-0 bg-violet-500/15 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300",
  waiting_approval:
    "border-0 bg-amber-500/15 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  completed: "border-0 bg-green-500/15 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  failed: "border-0 bg-rose-500/15 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",
  cancelled: "border-0 bg-muted text-muted-foreground line-through",
};

const TASK_STATUS_BADGE: Record<TaskStatus, string> = {
  pending: "border-0 bg-muted text-muted-foreground",
  planning: "border-0 bg-blue-500/15 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  ready: "border-0 bg-sky-500/15 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400",
  running: "border-0 bg-violet-500/15 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300",
  blocked: "border-0 bg-orange-500/15 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400",
  waiting_approval:
    "border-0 bg-amber-500/15 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  completed: "border-0 bg-green-500/15 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  failed: "border-0 bg-rose-500/15 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",
  cancelled: "border-0 bg-muted text-muted-foreground line-through",
};

const ACTIVE_RUN_STATUSES = new Set<AgentRunStatus>(["pending", "running", "waiting_approval"]);

function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export default function AgentDetailPage() {
  const params = useParams<{ workspaceId: string; agentId: string }>();
  const { workspaceId, agentId } = params;
  const router = useRouter();
  const queryClient = useQueryClient();

  const agentQuery = useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => trpcClient.agents.get.query({ id: agentId }),
    refetchInterval: 5_000,
  });
  const agentsQuery = useQuery({
    queryKey: ["agents", workspaceId],
    queryFn: () => trpcClient.agents.list.query({ workspaceId }),
  });
  const skillsQuery = useQuery({
    queryKey: ["skills", "list", workspaceId],
    queryFn: () => trpcClient.skills.list.query({ workspaceId }),
  });
  const toolsQuery = useQuery({
    queryKey: ["tools", "list", workspaceId],
    queryFn: () => trpcClient.tools.list.query({ workspaceId }),
  });
  const mcpServersQuery = useQuery({
    queryKey: ["mcpServers", workspaceId],
    queryFn: () => trpcClient.mcpServers.list.query({ workspaceId }),
  });
  const runsQuery = useQuery({
    queryKey: ["agentRuns", "byAgent", agentId],
    queryFn: () => trpcClient.agentRuns.listByAgent.query({ agentId }),
    refetchInterval: 5_000,
  });
  const tasksQuery = useQuery({
    queryKey: ["tasks", workspaceId, "byAgent", agentId],
    queryFn: () => trpcClient.tasks.list.query({ workspaceId, assignedAgentId: agentId }),
    refetchInterval: 5_000,
  });

  const [instruction, setInstruction] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["agent", agentId] });
    queryClient.invalidateQueries({ queryKey: ["agents", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["agentRuns", "byAgent", agentId] });
    queryClient.invalidateQueries({ queryKey: ["tasks", workspaceId, "byAgent", agentId] });
  };

  const cancelRun = useMutation({
    mutationFn: (runId: string) => trpcClient.agentRuns.cancel.mutate({ runId }),
    onSuccess: invalidateAll,
  });

  const deleteAgent = useMutation({
    mutationFn: () => trpcClient.agents.delete.mutate({ id: agentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents", workspaceId] });
      router.push(`/workspace/${workspaceId}/agents`);
    },
  });

  const sendInstruction = useMutation({
    mutationFn: () =>
      trpcClient.tasks.create.mutate({
        workspaceId,
        assignedAgentId: agentId,
        title: instruction.trim().slice(0, 60) || "New instruction",
        instruction: instruction.trim(),
      }),
    onSuccess: (task) => {
      setInstruction("");
      router.push(`/workspace/${workspaceId}/tasks/${task.id}`);
    },
  });

  const agent = agentQuery.data;
  const runs = runsQuery.data ?? [];
  const tasks = [...(tasksQuery.data ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const activeRun = runs.find((run) => ACTIVE_RUN_STATUSES.has(run.status));

  const skillName = (id: string) => skillsQuery.data?.find((s) => s.id === id)?.name ?? id;
  const toolName = (id: string) => toolsQuery.data?.find((t) => t.id === id)?.name ?? id;
  const mcpName = (id: string) => mcpServersQuery.data?.find((m) => m.id === id)?.name ?? id;
  const delegateName = (id: string) => agentsQuery.data?.find((a) => a.id === id)?.name ?? id;

  if (agentQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
        <Skeleton className="h-4 w-28" />
        <PageHeaderSkeleton actions={2} />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4 p-4 sm:p-6 md:p-8">
        <Link
          href={`/workspace/${workspaceId}/agents`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Back to agents
        </Link>
        <p className="text-sm text-destructive">Agent not found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
      <Link
        href={`/workspace/${workspaceId}/agents`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Back to agents
      </Link>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-xl">{agent.name}</CardTitle>
              <Badge variant="outline" className={cn(AUTONOMY_BADGE[agent.autonomyLevel])}>
                {agent.autonomyLevel.replace("_", " ")}
              </Badge>
              {activeRun ? (
                <Badge variant="outline" className={cn(RUN_STATUS_BADGE[activeRun.status])}>
                  <Loader2 className="mr-1 size-3 animate-spin" />
                  running
                </Badge>
              ) : (
                <Badge variant="outline" className="border-0 bg-muted text-muted-foreground">
                  idle
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {agent.role ?? "No role set"} · {agent.modelId}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={deleteAgent.isPending}
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {deleteAgent.isError && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {(deleteAgent.error as Error).message}
            </p>
          )}

          {activeRun && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-violet-500/25 bg-violet-500/10 p-3 text-sm">
              <div>
                <p className="font-medium">This agent is currently running.</p>
                <p className="text-xs text-muted-foreground">
                  Started {formatDate(activeRun.startedAt)}
                  {activeRun.taskId && " — open the task to see live steps or add an instruction."}
                </p>
              </div>
              <div className="flex gap-2">
                {activeRun.taskId && (
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/workspace/${workspaceId}/tasks/${activeRun.taskId}`}>
                      Open task
                    </Link>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => cancelRun.mutate(activeRun.id)}
                  disabled={cancelRun.isPending}
                >
                  <Square className="size-3.5" />
                  Stop
                </Button>
              </div>
            </div>
          )}

          {agent.systemPrompt && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                System prompt
              </p>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {agent.systemPrompt}
              </p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Skills ({agent.skillIds.length})
              </p>
              <p className="text-sm text-muted-foreground">
                {agent.skillIds.length > 0 ? agent.skillIds.map(skillName).join(", ") : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Tools ({agent.toolIds.length})
              </p>
              <p className="text-sm text-muted-foreground">
                {agent.toolIds.length > 0 ? agent.toolIds.map(toolName).join(", ") : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                MCP servers ({agent.mcpServerIds.length})
              </p>
              <p className="text-sm text-muted-foreground">
                {agent.mcpServerIds.length > 0 ? agent.mcpServerIds.map(mcpName).join(", ") : "—"}
              </p>
            </div>
            {agent.autonomyLevel === "super_agent" && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Delegates ({agent.delegateAgentIds.length})
                </p>
                <p className="text-sm text-muted-foreground">
                  {agent.delegateAgentIds.length > 0
                    ? agent.delegateAgentIds.map(delegateName).join(", ")
                    : "—"}
                </p>
              </div>
            )}
          </div>

          <p className="border-t pt-3 text-xs text-muted-foreground">
            Created {formatDate(agent.createdAt)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Give this agent an instruction</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Starts a new task for this agent right away. To interject an instruction into a task
            that's already running, open it above and use "Continue with agent" instead.
          </p>
          <Textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="What should this agent do?"
            rows={3}
          />
          <div className="flex items-center gap-2">
            <Button
              onClick={() => sendInstruction.mutate()}
              disabled={sendInstruction.isPending || instruction.trim().length === 0}
            >
              {sendInstruction.isPending ? "Starting…" : "Send"}
            </Button>
            {sendInstruction.isError && (
              <p className="text-sm text-destructive">
                {(sendInstruction.error as Error).message}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent tasks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks yet.</p>
          ) : (
            tasks
              .slice(0, 15)
              .map((task) => (
                <Link
                  key={task.id}
                  href={`/workspace/${workspaceId}/tasks/${task.id}`}
                  className="flex items-center justify-between rounded-lg border p-3 text-sm hover:bg-muted/50"
                >
                  <span className="font-medium">{task.title}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(task.createdAt)}
                    </span>
                    <Badge variant="outline" className={cn(TASK_STATUS_BADGE[task.status])}>
                      {task.status.replace("_", " ")}
                    </Badge>
                  </div>
                </Link>
              ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent runs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            runs.slice(0, 15).map((run) => (
              <div key={run.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant="outline" className="border-0 bg-muted text-muted-foreground">
                    {run.trigger}
                  </Badge>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={cn(RUN_STATUS_BADGE[run.status])}>
                      {run.status.replace("_", " ")}
                    </Badge>
                    {ACTIVE_RUN_STATUSES.has(run.status) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => cancelRun.mutate(run.id)}
                        disabled={cancelRun.isPending}
                      >
                        Stop
                      </Button>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {run.stepCount} step{run.stepCount === 1 ? "" : "s"} · {formatDate(run.createdAt)}
                </p>
                {run.errorMessage && (
                  <p className="mt-1 text-xs text-destructive">{run.errorMessage}</p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete agent</DialogTitle>
            <DialogDescription>
              This permanently deletes &quot;{agent.name}&quot;. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button
              variant="destructive"
              onClick={() => {
                setDeleteConfirmOpen(false);
                deleteAgent.mutate();
              }}
              disabled={deleteAgent.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
