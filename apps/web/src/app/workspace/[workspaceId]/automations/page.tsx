"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, ListChecks } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
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
import { trpcClient } from "@/lib/trpc";

const CRON_PRESETS = [
  { label: "Every 5 minutes (testing)", value: "*/5 * * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every day at 7am", value: "0 7 * * *" },
  { label: "Every Monday at 9am", value: "0 9 * * 1" },
];

function formatDate(d: Date | string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export default function AutomationsPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const queryClient = useQueryClient();

  const automationsQuery = useQuery({
    queryKey: ["automations", workspaceId],
    queryFn: () => trpcClient.automations.list.query({ workspaceId }),
  });
  const agentsQuery = useQuery({
    queryKey: ["agents", workspaceId],
    queryFn: () => trpcClient.agents.list.query({ workspaceId }),
  });

  // Only "autonomous" and "super_agent" agents can run unattended.
  const schedulableAgents = (agentsQuery.data ?? []).filter(
    (a) => a.autonomyLevel === "autonomous" || a.autonomyLevel === "super_agent",
  );

  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState("");
  const [cronExpression, setCronExpression] = useState(CRON_PRESETS[1]?.value ?? "");
  const [prompt, setPrompt] = useState("");

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["automations", workspaceId] });

  const createAutomation = useMutation({
    mutationFn: () =>
      trpcClient.automations.create.mutate({ workspaceId, agentId, name, cronExpression, prompt }),
    onSuccess: () => {
      invalidate();
      setName("");
      setPrompt("");
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      trpcClient.automations.setEnabled.mutate(input),
    onSuccess: invalidate,
  });

  const deleteAutomation = useMutation({
    mutationFn: (id: string) => trpcClient.automations.delete.mutate({ id }),
    onSuccess: invalidate,
  });

  const [runningId, setRunningId] = useState<string | null>(null);
  const runNow = useMutation({
    mutationFn: (id: string) => trpcClient.automations.runNow.mutate({ id }),
    onMutate: (id) => setRunningId(id),
    onSuccess: invalidate,
    onSettled: () => setRunningId(null),
  });

  const automations = automationsQuery.data ?? [];
  const enabledCount = automations.filter((a) => a.enabled).length;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-8">
      <PageHeader
        title="Automations"
        description={
          'Unattended scheduled runs for "autonomous"/"super_agent" agents. A DB-backed poll checks every 30 seconds for due runs.'
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Total automations"
          value={automations.length}
          icon={<ListChecks className="size-4" />}
        />
        <StatCard label="Enabled" value={enabledCount} icon={<CheckCircle2 className="size-4" />} />
        <StatCard
          label="Schedulable agents"
          value={schedulableAgents.length}
          icon={<CalendarClock className="size-4" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configured automations</CardTitle>
        </CardHeader>
        <CardContent>
          {automations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No automations yet.</p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last / next run</TableHead>
                    <TableHead className="w-[260px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {automations.map((automation) => (
                    <TableRow key={automation.id}>
                      <TableCell>
                        <div className="font-medium">{automation.name}</div>
                        <div className="max-w-[220px] truncate text-xs text-muted-foreground">
                          {automation.prompt}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {automation.cronExpression}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            automation.enabled
                              ? "border-0 bg-green-500/15 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                              : "border-0 bg-muted text-muted-foreground"
                          }
                        >
                          {automation.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(automation.lastRunAt)} → {formatDate(automation.nextRunAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => runNow.mutate(automation.id)}
                            disabled={runNow.isPending && runningId === automation.id}
                          >
                            {runNow.isPending && runningId === automation.id
                              ? "Running…"
                              : "Run now"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              toggleEnabled.mutate({
                                id: automation.id,
                                enabled: !automation.enabled,
                              })
                            }
                          >
                            {automation.enabled ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteAutomation.mutate(automation.id)}
                          >
                            Delete
                          </Button>
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
          <CardTitle>Create automation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {schedulableAgents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No "autonomous" or "super_agent" agents in this workspace yet. Create one on the
              Agents page first — "chat" and "assisted" agents can't be scheduled.
            </p>
          ) : (
            <>
              <div className="grid gap-2">
                <Label htmlFor="automation-name">Name</Label>
                <Input
                  id="automation-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Agent</Label>
                  <Select value={agentId} onValueChange={setAgentId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select an agent…" />
                    </SelectTrigger>
                    <SelectContent>
                      {schedulableAgents.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name} ({a.autonomyLevel})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>Schedule preset</Label>
                  <Select value={cronExpression} onValueChange={setCronExpression}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CRON_PRESETS.map((preset) => (
                        <SelectItem key={preset.value} value={preset.value}>
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="automation-cron">Cron expression</Label>
                <Input
                  id="automation-cron"
                  placeholder="Or a custom cron expression"
                  value={cronExpression}
                  onChange={(e) => setCronExpression(e.target.value)}
                  className="font-mono"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="automation-prompt">Prompt</Label>
                <Textarea
                  id="automation-prompt"
                  placeholder="The task to run each time, e.g. Summarize today's calendar and flag anything urgent."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="flex items-center gap-3 border-t pt-4">
                <Button
                  onClick={() => createAutomation.mutate()}
                  disabled={
                    createAutomation.isPending || !name || !agentId || !cronExpression || !prompt
                  }
                >
                  {createAutomation.isPending ? "Creating…" : "Create automation"}
                </Button>
                {createAutomation.isError && (
                  <p className="text-sm text-destructive">
                    {(createAutomation.error as Error).message}
                  </p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
