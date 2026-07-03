"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Circle, Clock, PlayCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeaderSkeleton } from "@/components/loading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { GoalStatus, TaskPriority, TaskStatus } from "@/lib/trpc";
import { trpcClient } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const GOAL_STATUS_BADGE: Record<GoalStatus, string> = {
  active: "border-0 bg-sky-500/15 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400",
  paused: "border-0 bg-muted text-muted-foreground",
  blocked: "border-0 bg-orange-500/15 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400",
  completed: "border-0 bg-green-500/15 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  archived: "border-0 bg-muted text-muted-foreground line-through",
};

const PRIORITY_BADGE: Record<TaskPriority, string> = {
  low: "border-0 bg-muted text-muted-foreground",
  normal: "border-0 bg-blue-500/15 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  high: "border-0 bg-amber-500/15 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  urgent: "border-0 bg-rose-500/15 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",
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

function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export default function GoalDetailPage() {
  const params = useParams<{ workspaceId: string; goalId: string }>();
  const { workspaceId, goalId } = params;
  const queryClient = useQueryClient();

  const overviewQuery = useQuery({
    queryKey: ["goal-overview", goalId],
    queryFn: () => trpcClient.goals.overview.query({ goalId }),
    refetchInterval: (query) => (query.state.data?.goal.status === "active" ? 5_000 : 15_000),
  });
  const agentsQuery = useQuery({
    queryKey: ["agents", workspaceId],
    queryFn: () => trpcClient.agents.list.query({ workspaceId }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["goal-overview", goalId] });

  const startOrchestration = useMutation({
    mutationFn: () => trpcClient.goals.startOrchestration.mutate({ goalId }),
    onSuccess: invalidate,
  });
  const setOrchestrationEnabled = useMutation({
    mutationFn: (enabled: boolean) =>
      trpcClient.goals.setOrchestrationEnabled.mutate({ goalId, enabled }),
    onSuccess: invalidate,
  });

  if (overviewQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
        <Skeleton className="h-4 w-28" />
        <PageHeaderSkeleton actions={2} />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  const overview = overviewQuery.data;
  if (!overview) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4 p-4 sm:p-6 md:p-8">
        <Link
          href={`/workspace/${workspaceId}/goals`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Back to goals
        </Link>
        <p className="text-sm text-destructive">Goal not found.</p>
      </div>
    );
  }

  const { goal, milestones, tasks, latestRun, blockers, nextAction, progressEvents } = overview;
  const agents = agentsQuery.data ?? [];
  const agentName = (id: string | null) =>
    id ? (agents.find((a) => a.id === id)?.name ?? id) : "Unassigned";
  const tasksByMilestone = new Map<string, typeof tasks>();
  const unattachedTasks: typeof tasks = [];
  for (const task of tasks) {
    if (task.goalMilestoneId) {
      tasksByMilestone.set(task.goalMilestoneId, [
        ...(tasksByMilestone.get(task.goalMilestoneId) ?? []),
        task,
      ]);
    } else {
      unattachedTasks.push(task);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
      <Link
        href={`/workspace/${workspaceId}/goals`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Back to goals
      </Link>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-xl">{goal.title}</CardTitle>
              <Badge variant="outline" className={cn(GOAL_STATUS_BADGE[goal.status])}>
                {goal.status}
              </Badge>
              <Badge variant="outline" className={cn(PRIORITY_BADGE[goal.priority])}>
                {goal.priority}
              </Badge>
            </div>
            {goal.description && (
              <p className="text-sm text-muted-foreground">{goal.description}</p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Orchestration</span>
              <Switch
                checked={goal.orchestrationEnabled}
                disabled={setOrchestrationEnabled.isPending}
                onCheckedChange={(checked) => setOrchestrationEnabled.mutate(checked)}
              />
            </div>
            {goal.orchestrationEnabled && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => startOrchestration.mutate()}
                disabled={startOrchestration.isPending}
              >
                <PlayCircle className="size-3.5" />
                {startOrchestration.isPending ? "Reviewing…" : "Review now"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Next action
            </p>
            <p className="mt-1">{nextAction}</p>
          </div>
          {goal.successCriteria && goal.successCriteria.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Success criteria
              </p>
              <ul className="mt-1 list-inside list-disc text-sm">
                {goal.successCriteria.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
            <span>Created {formatDate(goal.createdAt)}</span>
            <span>Last reviewed {formatDate(goal.lastReviewedAt)}</span>
            <span>Next review {formatDate(goal.nextReviewAt)}</span>
          </div>
        </CardContent>
      </Card>

      {blockers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-orange-700 dark:text-orange-400">
              Blockers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {blockers.map((blocker) => (
              <Link
                key={blocker.taskId}
                href={`/workspace/${workspaceId}/tasks/${blocker.taskId}`}
                className="block rounded-lg border border-orange-500/25 bg-orange-500/10 p-3 text-sm text-orange-700 hover:bg-orange-500/15 dark:text-orange-400"
              >
                <p className="font-medium">{blocker.title}</p>
                <p className="mt-0.5 text-xs opacity-90">{blocker.reason}</p>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {latestRun && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Latest run</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{agentName(latestRun.agentId)}</span>
              <Badge variant="outline" className="border-0 bg-muted text-muted-foreground">
                {latestRun.status}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {formatDate(latestRun.createdAt)}
              </span>
            </div>
            {latestRun.finalOutput && (
              <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                {latestRun.finalOutput.slice(0, 400)}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Milestones &amp; tasks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {milestones.length === 0 && unattachedTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {goal.orchestrationEnabled
                ? "Waiting for the Goal Orchestrator to generate a plan."
                : "Turn on orchestration above to have the Goal Engine plan this goal."}
            </p>
          ) : (
            <>
              {milestones.map((milestone) => (
                <div key={milestone.id} className="space-y-2">
                  <div className="flex items-center gap-2">
                    {milestone.status === "completed" ? (
                      <CheckCircle2 className="size-4 shrink-0 text-green-600 dark:text-green-400" />
                    ) : (
                      <Circle className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span
                      className={cn(
                        "font-medium",
                        milestone.status === "completed" && "text-muted-foreground line-through",
                      )}
                    >
                      {milestone.title}
                    </span>
                  </div>
                  <div className="ml-6 space-y-1.5">
                    {(tasksByMilestone.get(milestone.id) ?? []).map((task) => (
                      <Link
                        key={task.id}
                        href={`/workspace/${workspaceId}/tasks/${task.id}`}
                        className="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-sm hover:bg-muted/50"
                      >
                        <span className="min-w-0 truncate">{task.title}</span>
                        <Badge
                          variant="outline"
                          className={cn("shrink-0", TASK_STATUS_BADGE[task.status])}
                        >
                          {task.status.replace("_", " ")}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
              {unattachedTasks.length > 0 && (
                <div className="space-y-1.5">
                  {unattachedTasks.map((task) => (
                    <Link
                      key={task.id}
                      href={`/workspace/${workspaceId}/tasks/${task.id}`}
                      className="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-sm hover:bg-muted/50"
                    >
                      <span className="min-w-0 truncate">{task.title}</span>
                      <Badge
                        variant="outline"
                        className={cn("shrink-0", TASK_STATUS_BADGE[task.status])}
                      >
                        {task.status.replace("_", " ")}
                      </Badge>
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {progressEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <div className="space-y-3">
              {[...progressEvents].reverse().map((event) => (
                <div key={event.id} className="flex gap-3 text-sm">
                  <div className="mt-0.5 shrink-0 text-muted-foreground">
                    <Clock className="size-4" />
                  </div>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {event.kind.replace(/_/g, " ")}
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
