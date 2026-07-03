"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, ListTodo, Target } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { PageHeaderSkeleton, StatCardsSkeleton } from "@/components/loading";
import { PageHeader, StatCard } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  type GoalMilestoneStatus,
  type GoalStatus,
  type TaskPriority,
  trpcClient,
} from "@/lib/trpc";
import { cn } from "@/lib/utils";

const ALL_STATUSES: GoalStatus[] = ["active", "paused", "blocked", "completed", "archived"];
const ALL_PRIORITIES: TaskPriority[] = ["low", "normal", "high", "urgent"];

const STATUS_BADGE: Record<GoalStatus, string> = {
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

export default function GoalsPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const queryClient = useQueryClient();

  const goalsQuery = useQuery({
    queryKey: ["goals", workspaceId],
    queryFn: () => trpcClient.goals.list.query({ workspaceId }),
  });

  const goals = goalsQuery.data ?? [];
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["goals", workspaceId] });

  const [busyGoalId, setBusyGoalId] = useState<string | null>(null);
  const updateGoalStatus = useMutation({
    mutationFn: (input: { goalId: string; status: GoalStatus }) =>
      trpcClient.goals.updateStatus.mutate(input),
    onMutate: ({ goalId }) => setBusyGoalId(goalId),
    onSuccess: invalidate,
    onSettled: () => setBusyGoalId(null),
  });

  const [busyMilestoneId, setBusyMilestoneId] = useState<string | null>(null);
  const toggleMilestone = useMutation({
    mutationFn: (input: { milestoneId: string; status: GoalMilestoneStatus }) =>
      trpcClient.goals.updateMilestoneStatus.mutate(input),
    onMutate: ({ milestoneId }) => setBusyMilestoneId(milestoneId),
    onSuccess: invalidate,
    onSettled: () => setBusyMilestoneId(null),
  });

  const [milestoneDrafts, setMilestoneDrafts] = useState<Record<string, string>>({});
  const addMilestone = useMutation({
    mutationFn: (input: { goalId: string; title: string }) =>
      trpcClient.goals.addMilestone.mutate(input),
    onSuccess: (_data, { goalId }) => {
      invalidate();
      setMilestoneDrafts((prev) => ({ ...prev, [goalId]: "" }));
    },
  });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");

  const createGoal = useMutation({
    mutationFn: () =>
      trpcClient.goals.create.mutate({
        workspaceId,
        title,
        description: description || null,
        priority,
      }),
    onSuccess: () => {
      invalidate();
      setTitle("");
      setDescription("");
      setPriority("normal");
    },
  });

  const activeCount = goals.filter((g) => g.status === "active").length;
  const completedCount = goals.filter((g) => g.status === "completed").length;

  if (goalsQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 md:p-8">
        <PageHeaderSkeleton actions={1} />
        <StatCardsSkeleton count={2} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Goals"
        description="Long-term outcomes the workspace is tracking. Purely a record — nothing here runs automatically."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Active" value={activeCount} icon={<Target className="size-4" />} />
        <StatCard
          label="Completed"
          value={completedCount}
          icon={<CheckCircle2 className="size-4" />}
        />
      </div>

      {goals.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No goals yet. Create one below.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {goals.map((goal) => (
            <Card key={goal.id}>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <CardTitle className="text-base">{goal.title}</CardTitle>
                  {goal.description && (
                    <p className="text-sm text-muted-foreground">{goal.description}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className={cn(PRIORITY_BADGE[goal.priority])}>
                    {goal.priority}
                  </Badge>
                  <Select
                    value={goal.status}
                    onValueChange={(v) =>
                      updateGoalStatus.mutate({ goalId: goal.id, status: v as GoalStatus })
                    }
                  >
                    <SelectTrigger
                      className={cn("h-8 w-[140px]", STATUS_BADGE[goal.status])}
                      disabled={updateGoalStatus.isPending && busyGoalId === goal.id}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ALL_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {goal.milestones.length > 0 && (
                  <div className="space-y-1.5">
                    {goal.milestones.map((milestone) => (
                      <button
                        key={milestone.id}
                        type="button"
                        onClick={() =>
                          toggleMilestone.mutate({
                            milestoneId: milestone.id,
                            status: milestone.status === "completed" ? "pending" : "completed",
                          })
                        }
                        disabled={toggleMilestone.isPending && busyMilestoneId === milestone.id}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/50"
                      >
                        {milestone.status === "completed" ? (
                          <CheckCircle2 className="size-4 shrink-0 text-green-600 dark:text-green-400" />
                        ) : (
                          <Circle className="size-4 shrink-0 text-muted-foreground" />
                        )}
                        <span
                          className={cn(
                            milestone.status === "completed" &&
                              "text-muted-foreground line-through",
                          )}
                        >
                          {milestone.title}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <Input
                    placeholder="Add a milestone…"
                    value={milestoneDrafts[goal.id] ?? ""}
                    onChange={(e) =>
                      setMilestoneDrafts((prev) => ({ ...prev, [goal.id]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      const value = (milestoneDrafts[goal.id] ?? "").trim();
                      if (e.key === "Enter" && value) {
                        addMilestone.mutate({ goalId: goal.id, title: value });
                      }
                    }}
                    className="h-8"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!milestoneDrafts[goal.id]?.trim() || addMilestone.isPending}
                    onClick={() =>
                      addMilestone.mutate({
                        goalId: goal.id,
                        title: (milestoneDrafts[goal.id] ?? "").trim(),
                      })
                    }
                  >
                    <ListTodo className="size-3.5" />
                    Add
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Create goal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="goal-title">Title</Label>
            <Input id="goal-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="goal-description">Description (optional)</Label>
            <Textarea
              id="goal-description"
              placeholder="What outcome is this goal tracking?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="grid gap-2 sm:w-[200px]">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3 border-t pt-4">
            <Button onClick={() => createGoal.mutate()} disabled={createGoal.isPending || !title}>
              {createGoal.isPending ? "Creating…" : "Create goal"}
            </Button>
            {createGoal.isError && (
              <p className="text-sm text-destructive">{(createGoal.error as Error).message}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
