"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Automations</h1>
        <p className="text-muted-foreground">
          Unattended scheduled runs for "autonomous"/"super_agent" agents (ARCHITECTURE.md section
          6). A DB-backed poll checks every 30 seconds for due runs — see ADR-0010.
        </p>
      </div>

      <Card className="space-y-2 p-4">
        <h2 className="font-medium">Configured automations</h2>
        {automationsQuery.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">No automations yet.</p>
        )}
        <ul className="space-y-2">
          {automationsQuery.data?.map((automation) => (
            <li key={automation.id} className="space-y-2 rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{automation.name}</span>{" "}
                  <span className="text-muted-foreground">({automation.cronExpression})</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runNow.mutate(automation.id)}
                    disabled={runNow.isPending && runningId === automation.id}
                  >
                    {runNow.isPending && runningId === automation.id ? "Running…" : "Run now"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      toggleEnabled.mutate({ id: automation.id, enabled: !automation.enabled })
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
              </div>
              <div className="text-muted-foreground">{automation.prompt}</div>
              <div className="text-muted-foreground">
                {automation.enabled ? "Enabled" : "Disabled"} · last run:{" "}
                {formatDate(automation.lastRunAt)} · next run: {formatDate(automation.nextRunAt)}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="font-medium">Create automation</h2>

        {schedulableAgents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No "autonomous" or "super_agent" agents in this workspace yet. Create one on the Agents
            page first — "chat" and "assisted" agents can't be scheduled.
          </p>
        ) : (
          <>
            <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />

            <select
              className="flex h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            >
              <option value="">Select an agent…</option>
              {schedulableAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.autonomyLevel})
                </option>
              ))}
            </select>

            <select
              className="flex h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none"
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
            >
              {CRON_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label} ({preset.value})
                </option>
              ))}
            </select>
            <Input
              placeholder="Or a custom cron expression"
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
            />

            <Textarea
              placeholder="The task to run each time, e.g. Summarize today's calendar and flag anything urgent."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
            />

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
          </>
        )}
      </Card>
    </div>
  );
}
