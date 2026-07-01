"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { CardListSkeleton, PageHeaderSkeleton, StatCardsSkeleton } from "@/components/loading";
import { PageHeader, StatCard } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpcClient } from "@/lib/trpc";

const STATUS_BADGE: Record<string, string> = {
  approved: "border-0 bg-green-500/15 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  rejected: "border-0 bg-rose-500/15 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",
};

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

  const pending = pendingQuery.data ?? [];
  const resolved = resolvedQuery.data ?? [];
  const approvedCount = resolved.filter((a) => a.status === "approved").length;
  const rejectedCount = resolved.filter((a) => a.status === "rejected").length;

  if (pendingQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
        <PageHeaderSkeleton />
        <StatCardsSkeleton count={3} />
        <Skeleton className="h-9 w-64 rounded-md" />
        <CardListSkeleton rows={3} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Approvals"
        description="Sensitive tool calls — writing a file, or any MCP tool, since its side effects aren't declared — wait here for a human decision before they run."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Pending" value={pending.length} icon={<Clock className="size-4" />} />
        <StatCard
          label="Approved"
          value={approvedCount}
          icon={<CheckCircle2 className="size-4" />}
        />
        <StatCard label="Rejected" value={rejectedCount} icon={<XCircle className="size-4" />} />
      </div>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="resolved">Recently resolved</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <Card>
            <CardContent className="space-y-2 pt-6">
              {pending.length === 0 && (
                <p className="text-sm text-muted-foreground">Nothing awaiting approval.</p>
              )}
              <ul className="space-y-2">
                {pending.map((approval) => (
                  <li key={approval.id} className="space-y-2 rounded-lg border p-3 text-sm">
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
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="resolved">
          <Card>
            <CardContent className="pt-6">
              {resolved.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing resolved yet.</p>
              ) : (
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Tool</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {resolved.map((approval) => (
                        <TableRow key={approval.id}>
                          <TableCell className="font-medium">{approval.toolLabel}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={STATUS_BADGE[approval.status]}>
                              {approval.status}
                              {approval.errorMessage ? " (failed)" : ""}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
