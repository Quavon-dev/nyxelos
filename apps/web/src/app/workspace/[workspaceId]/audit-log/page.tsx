"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { trpcClient } from "@/lib/trpc";

const STATUS_LABEL: Record<string, string> = {
  success: "Success",
  error: "Error",
  pending_approval: "Pending approval",
  rejected: "Rejected",
};

function truncate(value: unknown, max = 200): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "—";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export default function AuditLogPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;

  const logQuery = useQuery({
    queryKey: ["auditLog", workspaceId],
    queryFn: () => trpcClient.auditLog.list.query({ workspaceId, limit: 100 }),
    refetchInterval: 15_000,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-muted-foreground">
          Every tool call any agent has made — from a live chat, a scheduled automation, a resolved
          approval, or a delegated sub-agent — most recent first (ARCHITECTURE.md section 5).
        </p>
      </div>

      <Card className="space-y-2 p-4">
        {logQuery.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">No activity logged yet.</p>
        )}
        <ul className="divide-y">
          {logQuery.data?.map((entry) => (
            <li key={entry.id} className="space-y-1 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{entry.toolLabel}</span>
                <span className="text-muted-foreground">
                  {entry.actor} · {STATUS_LABEL[entry.status] ?? entry.status} ·{" "}
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </div>
              {entry.output != null && (
                <div className="text-muted-foreground">{truncate(entry.output)}</div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
