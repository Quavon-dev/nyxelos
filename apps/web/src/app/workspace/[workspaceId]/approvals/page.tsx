"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { trpcClient } from "@/lib/trpc";

export default function ApprovalsPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const queryClient = useQueryClient();

  const pendingQuery = useQuery({
    queryKey: ["approvals", workspaceId, "pending"],
    queryFn: () => trpcClient.approvals.list.query({ workspaceId, status: "pending" }),
    refetchInterval: 10_000,
  });
  const resolvedQuery = useQuery({
    queryKey: ["approvals", workspaceId, "resolved"],
    queryFn: () => trpcClient.approvals.list.query({ workspaceId }),
    select: (all) => all.filter((a) => a.status !== "pending").slice(0, 20),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["approvals", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["auditLog", workspaceId] });
  };

  const [actingId, setActingId] = useState<string | null>(null);
  const approve = useMutation({
    mutationFn: (id: string) => trpcClient.approvals.approve.mutate({ id }),
    onMutate: (id) => setActingId(id),
    onSuccess: invalidate,
    onSettled: () => setActingId(null),
  });
  const reject = useMutation({
    mutationFn: (id: string) => trpcClient.approvals.reject.mutate({ id }),
    onMutate: (id) => setActingId(id),
    onSuccess: invalidate,
    onSettled: () => setActingId(null),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-muted-foreground">
          Sensitive tool calls — writing a file, or any MCP tool, since its side effects aren't
          declared — wait here for a human decision before they run (ADR-0009). Nothing has happened
          yet for anything listed as pending.
        </p>
      </div>

      <Card className="space-y-2 p-4">
        <h2 className="font-medium">Pending</h2>
        {pendingQuery.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing awaiting approval.</p>
        )}
        <ul className="space-y-2">
          {pendingQuery.data?.map((approval) => (
            <li key={approval.id} className="space-y-2 rounded-md border p-3 text-sm">
              <div className="font-medium">{approval.toolLabel}</div>
              <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
                {JSON.stringify(approval.input, null, 2)}
              </pre>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => approve.mutate(approval.id)}
                  disabled={actingId === approval.id}
                >
                  Approve
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => reject.mutate(approval.id)}
                  disabled={actingId === approval.id}
                >
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-2 p-4">
        <h2 className="font-medium">Recently resolved</h2>
        {resolvedQuery.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing resolved yet.</p>
        )}
        <ul className="space-y-1">
          {resolvedQuery.data?.map((approval) => (
            <li key={approval.id} className="rounded-md border p-2 text-sm">
              <div className="flex justify-between">
                <span>{approval.toolLabel}</span>
                <span className="text-muted-foreground">
                  {approval.status}
                  {approval.errorMessage ? " (failed)" : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
