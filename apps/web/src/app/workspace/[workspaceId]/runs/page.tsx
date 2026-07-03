"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Clock, HelpCircle, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { PageHeaderSkeleton, StatCardsSkeleton, TableSkeleton } from "@/components/loading";
import { PageHeader, StatCard } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  type AgentRunSummary,
  type AgentRunTrigger,
  type TaskSummary,
  trpcClient,
} from "@/lib/trpc";
import { cn } from "@/lib/utils";

/**
 * "Runs" is a view over `agentRun` rows, not a separate entity — see
 * packages/db/src/schema/sqlite/app.ts. The DB only tracks
 * pending/running/waiting_approval/completed/failed/cancelled on the run
 * itself; "waiting for input" is a *task*-level state (task.status ===
 * "blocked", the agent asked a question) that doesn't have a matching
 * agentRun status. This page derives a display status per run by combining
 * the run's own status with its linked task's status, so a run whose task
 * is blocked shows as "waiting for input" instead of just "running". Pausing
 * and manual retry aren't modelled anywhere yet (no schema field, no runtime
 * support in agent-runtime.ts) — real support for those is a follow-up, not
 * something this page fakes.
 */
type RunViewStatus =
  | "running"
  | "waiting_for_approval"
  | "waiting_for_input"
  | "failed"
  | "completed"
  | "other";

const VIEW_STATUS_FILTERS: RunViewStatus[] = [
  "running",
  "waiting_for_approval",
  "waiting_for_input",
  "failed",
  "completed",
];

const VIEW_STATUS_LABEL: Record<RunViewStatus, string> = {
  running: "Running",
  waiting_for_approval: "Waiting for approval",
  waiting_for_input: "Waiting for input",
  failed: "Failed",
  completed: "Completed",
  other: "Other",
};

const VIEW_STATUS_BADGE: Record<RunViewStatus, string> = {
  running: "border-0 bg-violet-500/15 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300",
  waiting_for_approval:
    "border-0 bg-amber-500/15 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  waiting_for_input:
    "border-0 bg-orange-500/15 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400",
  failed: "border-0 bg-rose-500/15 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",
  completed: "border-0 bg-green-500/15 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  other: "border-0 bg-muted text-muted-foreground",
};

const ALL_TRIGGERS: AgentRunTrigger[] = ["chat", "task", "automation", "delegate", "extension"];

function deriveViewStatus(run: AgentRunSummary, task: TaskSummary | null): RunViewStatus {
  if (run.status === "failed") return "failed";
  if (run.status === "completed") return "completed";
  if (run.status === "waiting_approval") return "waiting_for_approval";
  if (run.status === "running" || run.status === "pending") {
    return task?.status === "blocked" ? "waiting_for_input" : "running";
  }
  return "other"; // cancelled, or pending with no linked task
}

function formatDuration(start: string | Date | null, end: string | Date | null): string {
  if (!start) return "–";
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const totalSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatTimestamp(value: string | Date | null): string {
  if (!value) return "–";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Last ~two lines of a run's live output — enough to see what the agent is
 * doing right now without dumping the whole growing answer into the row. */
function outputTail(finalOutput: string | null): string | null {
  const text = finalOutput?.trim();
  if (!text) return null;
  return text.length > 160 ? `…${text.slice(-160)}` : text;
}

export default function RunsPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<RunViewStatus | "all">("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [triggerFilter, setTriggerFilter] = useState<AgentRunTrigger | "all">("all");

  const runsQuery = useQuery({
    queryKey: ["agentRuns", workspaceId, "all"],
    queryFn: () => trpcClient.agentRuns.list.query({ workspaceId }),
    refetchInterval: 5_000,
  });
  const tasksQuery = useQuery({
    queryKey: ["tasks", workspaceId, "all-for-runs"],
    queryFn: () => trpcClient.tasks.list.query({ workspaceId }),
    refetchInterval: 10_000,
  });
  const agentsQuery = useQuery({
    queryKey: ["agents", workspaceId],
    queryFn: () => trpcClient.agents.list.query({ workspaceId }),
  });
  // Pending approvals, cross-referenced by agentRunId, so a
  // "waiting_for_approval" run can be approved/rejected right from this
  // table instead of forcing a trip to the Approvals page for every run.
  const approvalsQuery = useQuery({
    queryKey: ["approvals", workspaceId, "pending"],
    queryFn: () => trpcClient.approvals.list.query({ workspaceId, status: "pending" }),
    refetchInterval: 10_000,
  });

  const agents = agentsQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const runs = runsQuery.data ?? [];
  const pendingApprovals = approvalsQuery.data ?? [];

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const taskById = (id: string | null) => (id ? (tasks.find((t) => t.id === id) ?? null) : null);
  const approvalForRun = (runId: string) =>
    pendingApprovals.find((a) => a.agentRunId === runId) ?? null;

  const rows = runs
    .map((run) => ({
      run,
      task: taskById(run.taskId),
      view: deriveViewStatus(run, taskById(run.taskId)),
    }))
    .sort((a, b) => new Date(b.run.createdAt).getTime() - new Date(a.run.createdAt).getTime());

  const filteredRows = rows
    .filter((r) => statusFilter === "all" || r.view === statusFilter)
    .filter((r) => agentFilter === "all" || r.run.agentId === agentFilter)
    .filter((r) => triggerFilter === "all" || r.run.trigger === triggerFilter);

  const counts = VIEW_STATUS_FILTERS.reduce(
    (acc, status) => {
      acc[status] = rows.filter((r) => r.view === status).length;
      return acc;
    },
    {} as Record<RunViewStatus, number>,
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["agentRuns", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["tasks", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["approvals", workspaceId] });
  };
  const cancelRun = useMutation({
    mutationFn: (runId: string) => trpcClient.agentRuns.cancel.mutate({ runId }),
    onSuccess: invalidate,
  });

  const [actingApprovalId, setActingApprovalId] = useState<string | null>(null);
  const approveRun = useMutation({
    mutationFn: (approvalId: string) => trpcClient.approvals.approve.mutate({ id: approvalId }),
    onMutate: (id) => setActingApprovalId(id),
    onSuccess: invalidate,
    onSettled: () => setActingApprovalId(null),
  });
  const rejectRun = useMutation({
    mutationFn: (approvalId: string) => trpcClient.approvals.reject.mutate({ id: approvalId }),
    onMutate: (id) => setActingApprovalId(id),
    onSuccess: invalidate,
    onSettled: () => setActingApprovalId(null),
  });

  if (runsQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 md:p-8">
        <PageHeaderSkeleton />
        <StatCardsSkeleton count={5} />
        <TableSkeleton rows={6} cols={5} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Runs"
        description="Every agent run across chat, tasks, automations, and delegated hand-offs — one board for what's live, stuck, or done."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Running" value={counts.running} icon={<Loader2 className="size-4" />} />
        <StatCard
          label="Waiting on approval"
          value={counts.waiting_for_approval}
          icon={<Clock className="size-4" />}
        />
        <StatCard
          label="Waiting on input"
          value={counts.waiting_for_input}
          icon={<HelpCircle className="size-4" />}
        />
        <StatCard label="Failed" value={counts.failed} icon={<XCircle className="size-4" />} />
        <StatCard
          label="Completed"
          value={counts.completed}
          icon={<CheckCircle2 className="size-4" />}
        />
      </div>

      {counts.waiting_for_approval > 0 && (
        <Card className="border-amber-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CircleAlert className="size-4 text-amber-600 dark:text-amber-400" />
              Waiting on your approval
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {rows
              .filter((r) => r.view === "waiting_for_approval")
              .map(({ run, task }) => {
                const approval = approvalForRun(run.id);
                return (
                  <div
                    key={run.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {agentName(run.agentId)}
                        {task && <span className="text-muted-foreground"> — {task.title}</span>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {approval?.title ??
                          approval?.toolLabel ??
                          "A tool call is waiting for your decision."}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {approval ? (
                        <>
                          <Button
                            size="sm"
                            onClick={() => approveRun.mutate(approval.id)}
                            disabled={actingApprovalId === approval.id}
                          >
                            Approve
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => rejectRun.mutate(approval.id)}
                            disabled={actingApprovalId === approval.id}
                          >
                            Reject
                          </Button>
                        </>
                      ) : (
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/workspace/${workspaceId}/approvals`}>Review</Link>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <CardTitle>All runs</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as RunViewStatus | "all")}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {VIEW_STATUS_FILTERS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {VIEW_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All agents</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={triggerFilter}
              onValueChange={(v) => setTriggerFilter(v as AgentRunTrigger | "all")}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Trigger" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All triggers</SelectItem>
                {ALL_TRIGGERS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {filteredRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs match these filters.</p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Status</TableHead>
                    <TableHead>Agent / Task</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Last activity</TableHead>
                    <TableHead className="w-[260px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map(({ run, task, view }) => {
                    const approval =
                      view === "waiting_for_approval" ? approvalForRun(run.id) : null;
                    const tail =
                      view === "running" || view === "waiting_for_input"
                        ? outputTail(run.finalOutput)
                        : null;
                    return (
                      <TableRow
                        key={run.id}
                        className={view === "waiting_for_approval" ? "bg-amber-500/5" : undefined}
                      >
                        <TableCell className="align-top">
                          <Badge variant="outline" className={cn(VIEW_STATUS_BADGE[view])}>
                            {VIEW_STATUS_LABEL[view]}
                          </Badge>
                          {view === "failed" && run.errorMessage && (
                            <p
                              className="mt-1 max-w-[160px] truncate text-[11px] text-muted-foreground"
                              title={run.errorMessage}
                            >
                              {run.errorMessage}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          <p className="font-medium">{agentName(run.agentId)}</p>
                          {task ? (
                            <Link
                              href={`/workspace/${workspaceId}/tasks/${task.id}`}
                              className="truncate text-xs text-muted-foreground hover:underline"
                            >
                              {task.title}
                            </Link>
                          ) : (
                            <p className="text-xs text-muted-foreground">No linked task</p>
                          )}
                          {tail && (
                            <pre className="mt-1 max-h-16 max-w-[320px] overflow-hidden whitespace-pre-wrap rounded-md bg-muted/40 px-2 py-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
                              {tail}
                            </pre>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge
                            variant="outline"
                            className="border-0 bg-muted font-mono text-[10px]"
                          >
                            {run.trigger}
                          </Badge>
                        </TableCell>
                        <TableCell className="align-top text-muted-foreground text-xs">
                          {formatTimestamp(run.startedAt ?? run.createdAt)}
                        </TableCell>
                        <TableCell className="align-top text-muted-foreground text-xs">
                          {formatDuration(run.startedAt, run.completedAt)}
                        </TableCell>
                        <TableCell className="align-top text-muted-foreground text-xs">
                          {formatTimestamp(run.updatedAt)}
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex flex-wrap gap-2">
                            {task && (
                              <Button variant="outline" size="sm" asChild>
                                <Link href={`/workspace/${workspaceId}/tasks/${task.id}`}>
                                  View
                                </Link>
                              </Button>
                            )}
                            {(run.status === "running" || run.status === "pending") && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => cancelRun.mutate(run.id)}
                                disabled={cancelRun.isPending}
                              >
                                Stop
                              </Button>
                            )}
                            {approval && (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => approveRun.mutate(approval.id)}
                                  disabled={actingApprovalId === approval.id}
                                >
                                  Approve
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => rejectRun.mutate(approval.id)}
                                  disabled={actingApprovalId === approval.id}
                                >
                                  Reject
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
