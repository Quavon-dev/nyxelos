"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, Clock, ListTodo, Workflow } from "lucide-react";
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

  const agents = agentsQuery.data ?? [];
  const agentName = (id: string | null) =>
    id ? (agents.find((a) => a.id === id)?.name ?? id) : "Unassigned";

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

  const createTask = useMutation({
    mutationFn: () =>
      trpcClient.tasks.create.mutate({
        workspaceId,
        title,
        instruction,
        priority,
        assignedAgentId: assignedAgentId === "none" ? null : assignedAgentId,
      }),
    onSuccess: () => {
      invalidate();
      setTitle("");
      setInstruction("");
      setPriority("normal");
      setAssignedAgentId("none");
    },
  });

  const openCount = allTasks.filter((t) => OPEN_STATUSES.includes(t.status)).length;
  const waitingApprovalCount = allTasks.filter((t) => t.status === "waiting_approval").length;
  const completedCount = allTasks.filter((t) => t.status === "completed").length;

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

      <div className="grid gap-4 sm:grid-cols-3">
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
