"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { useParams } from "next/navigation";
import { Area, AreaChart, XAxis } from "recharts";
import { PageHeaderSkeleton, StatCardsSkeleton, TableSkeleton } from "@/components/loading";
import { PageHeader, StatCard } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type AuditLogSummary, type AuditStatus, trpcClient } from "@/lib/trpc";

const STATUS_LABEL: Record<string, string> = {
  success: "Success",
  error: "Error",
  pending_approval: "Pending approval",
  rejected: "Rejected",
};

const STATUS_BADGE: Record<AuditStatus, string> = {
  success: "border-0 bg-green-500/15 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  error: "border-0 bg-rose-500/15 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",
  pending_approval:
    "border-0 bg-amber-500/15 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  rejected: "border-0 bg-muted text-muted-foreground",
};

function truncate(value: unknown, max = 160): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "—";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Buckets audit entries into the last 14 calendar days for the activity sparkline. */
function buildDailyActivity(entries: AuditLogSummary[]) {
  const days: { date: string; calls: number }[] = [];
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = new Date(entry.createdAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    days.push({ date: key, calls: counts.get(key) ?? 0 });
  }
  return days;
}

export default function AuditLogPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;

  const logQuery = useQuery({
    queryKey: ["auditLog", workspaceId],
    queryFn: () => trpcClient.auditLog.list.query({ workspaceId, limit: 100 }),
    refetchInterval: 15_000,
  });

  const entries = logQuery.data ?? [];
  const successCount = entries.filter((e) => e.status === "success").length;
  const errorCount = entries.filter((e) => e.status === "error").length;
  const pendingCount = entries.filter((e) => e.status === "pending_approval").length;
  const dailyActivity = buildDailyActivity(entries);

  if (logQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
        <PageHeaderSkeleton />
        <StatCardsSkeleton count={4} />
        <Skeleton className="h-48 w-full rounded-xl" />
        <TableSkeleton rows={6} cols={5} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Audit log"
        description="Every tool call any agent has made — from a live chat, a scheduled automation, a resolved approval, or a delegated sub-agent — most recent first."
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Total" value={entries.length} icon={<Clock className="size-4" />} />
        <StatCard label="Success" value={successCount} icon={<CheckCircle2 className="size-4" />} />
        <StatCard label="Errors" value={errorCount} icon={<XCircle className="size-4" />} />
        <StatCard
          label="Pending approval"
          value={pendingCount}
          icon={<AlertCircle className="size-4" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tool calls, last 14 days</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer
            className="aspect-auto h-32 w-full"
            config={{ calls: { label: "Tool calls", color: "var(--chart-1)" } }}
          >
            <AreaChart data={dailyActivity} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="auditActivityGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24} />
              <Area
                dataKey="calls"
                type="monotone"
                stroke="var(--chart-1)"
                fill="url(#auditActivityGradient)"
                strokeWidth={1.5}
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity logged yet.</p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Tool</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead>Output</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-medium">{entry.toolLabel}</TableCell>
                      <TableCell className="text-muted-foreground capitalize">
                        {entry.actor}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_BADGE[entry.status]}>
                          {STATUS_LABEL[entry.status] ?? entry.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground">
                        {entry.output != null ? truncate(entry.output) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
