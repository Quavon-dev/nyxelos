"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  CheckSquare,
  CircleAlert,
  Clock,
  ListTodo,
  Loader2,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { PageHeaderSkeleton, StatCardsSkeleton, TableSkeleton } from "@/components/loading";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { type TaskPriority, type TaskStatus, trpcClient } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const ALL_STATUSES: TaskStatus[] = [
  "pending",
  "planning",
  "ready",
  "running",
  "blocked",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
];

const ALL_PRIORITIES: TaskPriority[] = ["low", "normal", "high", "urgent"];

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

const OPEN_STATUSES: TaskStatus[] = [
  "pending",
  "planning",
  "ready",
  "running",
  "blocked",
  "waiting_approval",
];

function formatElapsed(startedAt: string | Date | null): string {
  if (!startedAt) return "–";
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** Last ~two lines of a run's live output — enough to see what the agent is
 * doing right now without dumping the whole growing answer into the board. */
function outputTail(finalOutput: string | null): string | null {
  const text = finalOutput?.trim();
  if (!text) return null;
  return text.length > 220 ? `…${text.slice(-220)}` : text;
}

export default function TasksPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");

  const tasksQuery = useQuery({
    queryKey: ["tasks", workspaceId, statusFilter],
    queryFn: () =>
      trpcClient.tasks.list.query({
        workspaceId,
        status: statusFilter === "all" ? undefined : statusFilter,
      }),
    refetchInterval: 10_000,
  });
  const agentsQuery = useQuery({
    queryKey: ["agents", workspaceId],
    queryFn: () => trpcClient.agents.list.query({ workspaceId }),
  });
  // Unfiltered task list for the "needs attention" strip — independent of the
  // status filter below so a paused question never hides behind a filter.
  const attentionTasksQuery = useQuery({
    queryKey: ["tasks", workspaceId, "attention"],
    queryFn: () => trpcClient.tasks.list.query({ workspaceId }),
    refetchInterval: 5_000,
  });
  const activeRunsQuery = useQuery({
    queryKey: ["agentRuns", workspaceId, "active"],
    queryFn: () => trpcClient.agentRuns.listActive.query({ workspaceId }),
    refetchInterval: 3_000,
  });
  const modelsQuery = useQuery({
    queryKey: ["models", workspaceId],
    queryFn: () => trpcClient.models.list.query({ workspaceId }),
  });

  const agents = agentsQuery.data ?? [];
  const models = modelsQuery.data ?? [];
  const agentName = (id: string | null) =>
    id ? (agents.find((a) => a.id === id)?.name ?? id) : "Unassigned";
  const agentDefaultModel = (id: string | null) =>
    id ? (agents.find((a) => a.id === id)?.modelId ?? null) : null;

  const allTasks = tasksQuery.data ?? [];
  const tasks =
    assigneeFilter === "all"
      ? allTasks
      : assigneeFilter === "unassigned"
        ? allTasks.filter((t) => !t.assignedAgentId)
        : allTasks.filter((t) => t.assignedAgentId === assigneeFilter);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["tasks", workspaceId] });

  const [assigningTaskId, setAssigningTaskId] = useState<string | null>(null);
  const assignTask = useMutation({
    mutationFn: (input: { taskId: string; assignedAgentId: string | null }) =>
      trpcClient.tasks.assign.mutate(input),
    onMutate: ({ taskId }) => setAssigningTaskId(taskId),
    onSuccess: invalidate,
    onSettled: () => setAssigningTaskId(null),
  });

  const [settingModelTaskId, setSettingModelTaskId] = useState<string | null>(null);
  const setTaskModel = useMutation({
    mutationFn: (input: { taskId: string; modelId: string | null }) =>
      trpcClient.tasks.setModel.mutate(input),
    onMutate: ({ taskId }) => setSettingModelTaskId(taskId),
    onSuccess: invalidate,
    onSettled: () => setSettingModelTaskId(null),
  });

  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const completeTask = useMutation({
    mutationFn: (taskId: string) =>
      trpcClient.tasks.complete.mutate({
        taskId,
        resultSummary: "Marked complete from task board.",
      }),
    onMutate: (taskId) => setBusyTaskId(taskId),
    onSuccess: invalidate,
    onSettled: () => setBusyTaskId(null),
  });
  const cancelTask = useMutation({
    mutationFn: (taskId: string) => trpcClient.tasks.cancel.mutate({ taskId }),
    onMutate: (taskId) => setBusyTaskId(taskId),
    onSuccess: invalidate,
    onSettled: () => setBusyTaskId(null),
  });

  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [assignedAgentId, setAssignedAgentId] = useState<string>("none");
  const [modelId, setModelId] = useState<string>("default");

  const createTask = useMutation({
    mutationFn: () =>
      trpcClient.tasks.create.mutate({
        workspaceId,
        title,
        instruction,
        priority,
        assignedAgentId: assignedAgentId === "none" ? null : assignedAgentId,
        modelId: modelId === "default" ? null : modelId,
      }),
    onSuccess: () => {
      invalidate();
      setTitle("");
      setInstruction("");
      setPriority("normal");
      setAssignedAgentId("none");
      setModelId("default");
    },
  });

  const cancelRun = useMutation({
    mutationFn: (runId: string) => trpcClient.agentRuns.cancel.mutate({ runId }),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["agentRuns", workspaceId] });
    },
  });

  const openCount = allTasks.filter((t) => OPEN_STATUSES.includes(t.status)).length;
  const waitingApprovalCount = allTasks.filter((t) => t.status === "waiting_approval").length;
  const completedCount = allTasks.filter((t) => t.status === "completed").length;

  const activeRuns = activeRunsQuery.data ?? [];
  const attentionTasks = (attentionTasksQuery.data ?? []).filter(
    (t) => t.status === "blocked" || t.status === "waiting_approval",
  );
  const taskTitle = (taskId: string | null) =>
    taskId ? (attentionTasksQuery.data?.find((t) => t.id === taskId)?.title ?? taskId) : null;

  if (tasksQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 md:p-8">
        <PageHeaderSkeleton actions={1} />
        <StatCardsSkeleton count={3} />
        <TableSkeleton rows={6} cols={4} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Tasks"
        description="Durable work items tracked across agents — created from chat, automations, or delegated by super-agents."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Running now"
          value={activeRuns.length}
          icon={<Activity className="size-4" />}
        />
        <StatCard label="Open" value={openCount} icon={<ListTodo className="size-4" />} />
        <StatCard
          label="Waiting on approval"
          value={waitingApprovalCount}
          icon={<Clock className="size-4" />}
        />
        <StatCard
          label="Completed"
          value={completedCount}
          icon={<CheckSquare className="size-4" />}
        />
      </div>

      {attentionTasks.length > 0 && (
        <Card className="border-amber-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CircleAlert className="size-4 text-amber-600 dark:text-amber-400" />
              Needs your attention
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {attentionTasks.map((task) => (
              <Link
                key={task.id}
                href={`/workspace/${workspaceId}/tasks/${task.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{task.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {task.status === "blocked"
                      ? "The agent asked a question and is waiting for your answer."
                      : "A tool call is waiting for your approval."}
                  </p>
                </div>
                <Badge variant="outline" className={cn(STATUS_BADGE[task.status], "shrink-0")}>
                  {task.status.replace("_", " ")}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {activeRuns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Loader2 className="size-4 animate-spin text-primary" />
              Live activity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeRuns.map((run) => {
              const tail = outputTail(run.finalOutput);
              return (
                <div key={run.id} className="space-y-2 rounded-lg border border-border/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="relative flex size-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                      <span className="relative inline-flex size-2 rounded-full bg-primary" />
                    </span>
                    <span className="text-sm font-medium">{agentName(run.agentId)}</span>
                    {run.taskId && (
                      <Link
                        href={`/workspace/${workspaceId}/tasks/${run.taskId}`}
                        className="truncate text-sm text-muted-foreground hover:underline"
                      >
                        {taskTitle(run.taskId)}
                      </Link>
                    )}
                    <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="border-0 bg-muted font-mono text-[10px]">
                        {run.trigger}
                      </Badge>
                      {formatElapsed(run.startedAt)}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => cancelRun.mutate(run.id)}
                        disabled={cancelRun.isPending}
                      >
                        Stop
                      </Button>
                    </span>
                  </div>
                  {tail && (
                    <pre className="max-h-24 overflow-hidden whitespace-pre-wrap rounded-md bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
                      {tail}
                    </pre>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>All tasks</CardTitle>
          <div className="flex gap-2">
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as TaskStatus | "all")}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {ALL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Assignee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All assignees</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks match these filters.</p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Assignee</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="w-[280px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell>
                        <Link
                          href={`/workspace/${workspaceId}/tasks/${task.id}`}
                          className="font-medium hover:underline"
                        >
                          {task.parentTaskId && (
                            <Workflow className="mr-1 inline size-3 text-muted-foreground" />
                          )}
                          {task.title}
                        </Link>
                        <div className="max-w-[280px] truncate text-xs text-muted-foreground">
                          {task.instruction}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(STATUS_BADGE[task.status])}>
                          {task.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(PRIORITY_BADGE[task.priority])}>
                          {task.priority}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <Select
                          value={task.assignedAgentId ?? "none"}
                          onValueChange={(v) =>
                            assignTask.mutate({
                              taskId: task.id,
                              assignedAgentId: v === "none" ? null : v,
                            })
                          }
                        >
                          <SelectTrigger
                            className="h-8 w-[160px]"
                            disabled={assignTask.isPending && assigningTaskId === task.id}
                          >
                            <SelectValue>{agentName(task.assignedAgentId)}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Unassigned</SelectItem>
                            {agents.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <Select
                          value={task.modelId ?? "default"}
                          onValueChange={(v) =>
                            setTaskModel.mutate({
                              taskId: task.id,
                              modelId: v === "default" ? null : v,
                            })
                          }
                        >
                          <SelectTrigger
                            className="h-8 w-[170px]"
                            disabled={setTaskModel.isPending && settingModelTaskId === task.id}
                          >
                            <SelectValue>
                              {task.modelId ??
                                (agentDefaultModel(task.assignedAgentId)
                                  ? `Agent default (${agentDefaultModel(task.assignedAgentId)})`
                                  : "Agent default")}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">Agent default</SelectItem>
                            {models.map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                {m.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" asChild>
                            <Link href={`/workspace/${workspaceId}/tasks/${task.id}`}>View</Link>
                          </Button>
                          {task.status !== "completed" && task.status !== "cancelled" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => completeTask.mutate(task.id)}
                              disabled={busyTaskId === task.id}
                            >
                              Complete
                            </Button>
                          )}
                          {task.status !== "cancelled" && task.status !== "completed" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => cancelTask.mutate(task.id)}
                              disabled={busyTaskId === task.id}
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create task</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="task-title">Title</Label>
            <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="task-instruction">Instruction</Label>
            <Textarea
              id="task-instruction"
              placeholder="What should the assigned agent accomplish?"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={3}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
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
            <div className="grid gap-2">
              <Label>Assign to (optional)</Label>
              <Select value={assignedAgentId} onValueChange={setAssignedAgentId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Leave unassigned</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Model (optional override)</Label>
            <Select value={modelId} onValueChange={setModelId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Use the agent's default model</SelectItem>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label} ({m.kind})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Run this specific task on a different model — e.g. a fast/cheap model for a simple
              task, or a stronger one for a hard one.
            </p>
          </div>
          <div className="flex items-center gap-3 border-t pt-4">
            <Button
              onClick={() => createTask.mutate()}
              disabled={createTask.isPending || !title || !instruction}
            >
              {createTask.isPending ? "Creating…" : "Create task"}
            </Button>
            {createTask.isError && (
              <p className="text-sm text-destructive">{(createTask.error as Error).message}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
