"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Loader2, MinusCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpcClient, type WorkflowRunSummary } from "@/lib/trpc";

const STATUS_VARIANT: Record<WorkflowRunSummary["status"], "default" | "destructive" | "outline"> =
  {
    queued: "outline",
    running: "outline",
    completed: "default",
    failed: "destructive",
    partial: "outline",
  };

function formatDate(d: Date | string | null) {
  return d ? new Date(d).toLocaleString() : "—";
}

export function ExecutionsTab({ workflowId }: { workflowId: string }) {
  const runsQuery = useQuery({
    queryKey: ["workflows", "runs", "listForWorkflow", workflowId],
    queryFn: () => trpcClient.workflows.runs.listForWorkflow.query({ workflowId }),
    refetchInterval: (query) => {
      const runs = query.state.data ?? [];
      return runs.some((r) => r.status === "queued" || r.status === "running") ? 2_000 : false;
    },
  });
  const runs = runsQuery.data ?? [];

  if (runs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <CheckCircle2 className="size-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">No executions yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Run this workflow from the Editor tab to see its history here.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Completed</TableHead>
            <TableHead>Error</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell>
                <Badge variant={STATUS_VARIANT[run.status]} className="gap-1 capitalize">
                  {run.status === "running" && <Loader2 className="size-3 animate-spin" />}
                  {run.status === "failed" && <AlertCircle className="size-3" />}
                  {run.status === "queued" && <MinusCircle className="size-3" />}
                  {run.status}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatDate(run.startedAt)}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatDate(run.completedAt)}
              </TableCell>
              <TableCell className="text-sm text-destructive">{run.errorMessage ?? ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
