"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot, CheckCircle2, Clock, ListTree, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { MultiSelectPromptCard } from "@/components/chat/multi-select-prompt";
import { parseAssistantContent } from "@/lib/chat-prompts";
import type { AgentRunStatus, TaskPriority, TaskStatus } from "@/lib/trpc";
import { trpcClient } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const STATUS_BADGE: Record<TaskStatus, string> = {
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

const PRIORITY_BADGE: Record<TaskPriority, string> = {
  low: "border-0 bg-muted text-muted-foreground",
  normal: "border-0 bg-blue-500/15 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  high: "border-0 bg-amber-500/15 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  urgent: "border-0 bg-rose-500/15 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",
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

function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export default function TaskDetailPage() {
  const params = useParams<{ workspaceId: string; taskId: string }>();
  const { workspaceId, taskId } = params;
  const queryClient = useQueryClient();

  const taskQuery = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => trpcClient.tasks.get.query({ taskId }),
    refetchInterval: 8_000,
  });
  const agentsQuery = useQuery({
    queryKey: ["agents", workspaceId],
    queryFn: () => trpcClient.agents.list.query({ workspaceId }),
  });
  const approvalsQuery = useQuery({
    queryKey: ["approvals", workspaceId, "all"],
    queryFn: () => trpcClient.approvals.list.query({ workspaceId }),
    refetchInterval: 8_000,
  });

  const agents = agentsQuery.data ?? [];
  const agentName = (id: string | null) =>
    id ? (agents.find((a) => a.id === id)?.name ?? id) : "Unassigned";

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    queryClient.invalidateQueries({ queryKey: ["tasks", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["agentRuns", taskId] });
  };

  const completeTask = useMutation({
    mutationFn: (resultSummary: string) =>
      trpcClient.tasks.complete.mutate({ taskId, resultSummary }),
    onSuccess: invalidate,
  });
  const cancelTask = useMutation({
    mutationFn: () => trpcClient.tasks.cancel.mutate({ taskId }),
    onSuccess: invalidate,
  });
  const startTask = useMutation({
    mutationFn: () => trpcClient.tasks.start.mutate({ taskId }),
    onSuccess: invalidate,
  });
  const [followUpInstruction, setFollowUpInstruction] = useState("");
  const followUpTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const followUpTask = useMutation({
    mutationFn: () =>
      trpcClient.tasks.reply.mutate({
        taskId,
        instruction: followUpInstruction,
      }),
    onSuccess: () => {
      setFollowUpInstruction("");
      invalidate();
    },
  });

  const [actingApprovalId, setActingApprovalId] = useState<string | null>(null);
  const invalidateApprovals = () => {
    queryClient.invalidateQueries({ queryKey: ["approvals", workspaceId] });
    invalidate();
  };
  const approveApproval = useMutation({
    mutationFn: (id: string) => trpcClient.approvals.approve.mutate({ id }),
    onMutate: (id: string) => setActingApprovalId(id),
    onSuccess: invalidateApprovals,
    onSettled: () => setActingApprovalId(null),
  });
  const rejectApproval = useMutation({
    mutationFn: (id: string) => trpcClient.approvals.reject.mutate({ id }),
    onMutate: (id: string) => setActingApprovalId(id),
    onSuccess: invalidateApprovals,
    onSettled: () => setActingApprovalId(null),
  });

  const task = taskQuery.data?.task;
  const children = taskQuery.data?.children ?? [];
  const events = taskQuery.data?.events ?? [];
  const runs = taskQuery.data?.runs ?? [];
  const linkedApprovals = (approvalsQuery.data ?? []).filter((a) => a.taskId === taskId);
  const followUpPrompt = task?.resultSummary
    ? parseAssistantContent(task.resultSummary).prompt
    : null;
  const autoStartRef = useRef(false);

  useEffect(() => {
    if (!task) return;
    if (task.status === "completed" || task.status === "cancelled") return;
    if (runs.length > 0) return;
    if (task.status !== "pending" && task.status !== "ready") return;
    if (autoStartRef.current) return;
    if (startTask.isPending) return;
    autoStartRef.current = true;
    void startTask.mutateAsync();
  }, [task, runs.length, startTask]);

  if (taskQuery.isLoading) {
    return <div className="mx-auto w-full max-w-4xl p-8 text-sm text-muted-foreground">Loading task…</div>;
  }

  if (!task) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4 p-8">
        <Link
          href={`/workspace/${workspaceId}/tasks`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Back to tasks
        </Link>
        <p className="text-sm text-destructive">Task not found.</p>
      </div>
    );
  }

  const canResolve = task.status !== "completed" && task.status !== "cancelled";
  const isBlocked = task.status === "blocked" || task.status === "waiting_approval";

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-8">
      <Link
        href={`/workspace/${workspaceId}/tasks`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Back to tasks
      </Link>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-xl">{task.title}</CardTitle>
              <Badge variant="outline" className={cn(STATUS_BADGE[task.status])}>
                {task.status.replace("_", " ")}
              </Badge>
              <Badge variant="outline" className={cn(PRIORITY_BADGE[task.priority])}>
                {task.priority}
              </Badge>
            </div>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Bot className="size-3.5" /> {agentName(task.assignedAgentId)}
            </p>
          </div>
          {canResolve && (
            <div className="flex shrink-0 gap-2">
              {task.status !== "completed" && task.status !== "cancelled" && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => startTask.mutate()}
                  disabled={startTask.isPending}
                >
                  {startTask.isPending ? "Starting…" : "Start session"}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => completeTask.mutate("Marked complete from task detail.")}
                disabled={completeTask.isPending}
              >
                Mark complete
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => cancelTask.mutate()}
                disabled={cancelTask.isPending}
              >
                Cancel
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Instruction
            </p>
            <p className="whitespace-pre-wrap text-sm">{task.instruction}</p>
          </div>

          {isBlocked && (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              This task is {task.status.replace("_", " ")}
              {task.errorMessage ? `: ${task.errorMessage}` : "."}
              {linkedApprovals.some((a) => a.status === "pending") &&
                " Resolve the pending approval below to let it resume."}
            </div>
          )}

          {task.plan && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Plan
              </p>
              <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs leading-relaxed">
                {JSON.stringify(task.plan, null, 2)}
              </pre>
            </div>
          )}

          {(task.resultSummary || task.errorMessage) && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {task.errorMessage ? "Error" : "Result"}
              </p>
              <p
                className={cn(
                  "whitespace-pre-wrap text-sm",
                  task.errorMessage && "text-destructive",
                )}
              >
                {task.errorMessage ?? task.resultSummary}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-x-6 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
            <span>Created {formatDate(task.createdAt)}</span>
            <span>Started {formatDate(task.startedAt)}</span>
            <span>Completed {formatDate(task.completedAt)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Continue with agent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Give the same agent a new instruction. The task stays the same and the agent
            continues on a fresh run automatically.
          </p>
          {followUpPrompt && (
            <MultiSelectPromptCard
              prompt={followUpPrompt}
              mode="interactive"
              onPickOption={(_, label) => setFollowUpInstruction(label)}
              onChooseCustomAnswer={() => {
                requestAnimationFrame(() => followUpTextareaRef.current?.focus());
              }}
              note="Wähle einen Vorschlag oder schreibe eine eigene Antwort unten."
            />
          )}
          <Textarea
            ref={followUpTextareaRef}
            value={followUpInstruction}
            onChange={(e) => setFollowUpInstruction(e.target.value)}
            placeholder={followUpPrompt ? "Eigene Antwort schreiben..." : "Add the next instruction for this agent..."}
            rows={followUpPrompt ? 3 : 4}
          />
          <div className="flex items-center gap-2">
            <Button
              onClick={() => followUpTask.mutate()}
              disabled={followUpTask.isPending || followUpInstruction.trim().length === 0}
            >
              {followUpTask.isPending ? "Starting…" : "Send follow-up"}
            </Button>
            <p className="text-xs text-muted-foreground">
              This keeps the agent session going without creating a new task.
            </p>
          </div>
        </CardContent>
      </Card>

      {linkedApprovals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Approvals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {linkedApprovals.map((approval) => (
              <div
                key={approval.id}
                className="space-y-2 rounded-lg border p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <code className="text-xs">{approval.toolLabel}</code>
                  <Badge
                    variant="outline"
                    className={
                      approval.status === "pending"
                        ? "border-0 bg-amber-500/15 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                        : approval.status === "approved"
                          ? "border-0 bg-green-500/15 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                          : "border-0 bg-rose-500/15 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400"
                    }
                  >
                    {approval.status}
                  </Badge>
                </div>
                <pre className="max-h-40 overflow-auto rounded-lg bg-muted p-2 text-xs leading-relaxed">
                  {JSON.stringify(approval.input, null, 2)}
                </pre>
                {approval.status === "pending" && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => approveApproval.mutate(approval.id)}
                      disabled={actingApprovalId === approval.id}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => rejectApproval.mutate(approval.id)}
                      disabled={actingApprovalId === approval.id}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {children.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListTree className="size-4" /> Child tasks
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {children.map((child) => (
              <Link
                key={child.id}
                href={`/workspace/${workspaceId}/tasks/${child.id}`}
                className="flex items-center justify-between rounded-lg border p-3 text-sm hover:bg-muted/50"
              >
                <span className="font-medium">{child.title}</span>
                <Badge variant="outline" className={cn(STATUS_BADGE[child.status])}>
                  {child.status.replace("_", " ")}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agent runs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs recorded yet.</p>
          ) : (
            runs.map((run) => (
              <div key={run.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{agentName(run.agentId)}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-0 bg-muted text-muted-foreground">
                      {run.trigger}
                    </Badge>
                    <Badge variant="outline" className={cn(RUN_STATUS_BADGE[run.status])}>
                      {run.status.replace("_", " ")}
                    </Badge>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {run.stepCount} step{run.stepCount === 1 ? "" : "s"} · {formatDate(run.createdAt)}
                </p>
                {run.finalOutput && (
                  <p className="mt-1 whitespace-pre-wrap text-xs">{run.finalOutput}</p>
                )}
                {run.errorMessage && (
                  <p className="mt-1 text-xs text-destructive">{run.errorMessage}</p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : (
            <div className="space-y-3">
              {events.map((event) => (
                <div key={event.id} className="flex gap-3 text-sm">
                  <div className="mt-0.5 shrink-0 text-muted-foreground">
                    {event.kind === "completed" ? (
                      <CheckCircle2 className="size-4 text-green-600" />
                    ) : event.kind === "failed" ? (
                      <XCircle className="size-4 text-destructive" />
                    ) : (
                      <Clock className="size-4" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {event.kind.replace("_", " ")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(event.createdAt)}
                      </span>
                    </div>
                    <p>{event.message}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
