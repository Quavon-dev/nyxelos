"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, ListChecks } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { PageHeaderSkeleton, StatCardsSkeleton, TableSkeleton } from "@/components/loading";
import { PageHeader, StatCard } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type AutomationSummary,
  type AutomationTriggerType,
  trpcClient,
} from "@/lib/trpc";

const TRIGGER_TYPES: { value: AutomationTriggerType; label: string }[] = [
  { value: "cron", label: "Schedule (cron)" },
  { value: "file_watch", label: "File change" },
];

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
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>("cron");
  const [cronExpression, setCronExpression] = useState(CRON_PRESETS[1]?.value ?? "");
  const [watchPath, setWatchPath] = useState("");
  const [watchGlob, setWatchGlob] = useState("");
  const [prompt, setPrompt] = useState("");

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["automations", workspaceId] });

  const createAutomation = useMutation({
    mutationFn: () =>
      trpcClient.automations.create.mutate({
        workspaceId,
        agentId,
        name,
        triggerType,
        cronExpression: triggerType === "cron" ? cronExpression : undefined,
        watchPath: triggerType === "file_watch" ? watchPath : undefined,
        watchGlob: triggerType === "file_watch" && watchGlob ? watchGlob : undefined,
        prompt,
      }),
    onSuccess: () => {
      invalidate();
      setName("");
      setPrompt("");
      setWatchPath("");
      setWatchGlob("");
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

  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<AutomationSummary | null>(null);

  const [runningId, setRunningId] = useState<string | null>(null);
  const runNow = useMutation({
    mutationFn: (id: string) => trpcClient.automations.runNow.mutate({ id }),
    onMutate: (id) => setRunningId(id),
    onSuccess: invalidate,
    onSettled: () => setRunningId(null),
  });

  const [editing, setEditing] = useState<AutomationSummary | null>(null);
  const [editName, setEditName] = useState("");
  const [editAgentId, setEditAgentId] = useState("");
  const [editSchedule, setEditSchedule] = useState("");
  const [editPrompt, setEditPrompt] = useState("");

  const openEdit = (automation: AutomationSummary) => {
    setEditing(automation);
    setEditName(automation.name);
    setEditAgentId(automation.agentId);
    setEditSchedule(
      automation.triggerType === "file_watch"
        ? automation.watchPath ?? ""
        : automation.cronExpression,
    );
    setEditPrompt(automation.prompt);
  };

  const updateAutomation = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error("No automation selected");
      return trpcClient.automations.update.mutate({
        id: editing.id,
        name: editName,
        agentId: editAgentId,
        prompt: editPrompt,
        ...(editing.triggerType === "file_watch"
          ? { watchPath: editSchedule }
          : { cronExpression: editSchedule }),
      });
    },
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
  });

  const automations = automationsQuery.data ?? [];
  const enabledCount = automations.filter((a) => a.enabled).length;

  if (automationsQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
        <PageHeaderSkeleton actions={1} />
        <StatCardsSkeleton count={3} />
        <TableSkeleton rows={5} cols={4} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
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
                        {automation.triggerType === "file_watch"
                          ? `watch: ${automation.watchPath ?? "?"}${automation.watchGlob ? ` (${automation.watchGlob})` : ""}`
                          : automation.cronExpression}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
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
                          {automation.lastRunStatus === "error" ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant="outline"
                                  className="cursor-default border-0 bg-red-500/15 text-red-700 dark:bg-red-500/10 dark:text-red-400"
                                >
                                  Last run failed
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                {automation.lastErrorMessage ?? "Unknown error"}
                              </TooltipContent>
                            </Tooltip>
                          ) : automation.lastRunStatus === "pending_approval" ? (
                            <Badge
                              variant="outline"
                              className="border-0 bg-amber-500/15 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                            >
                              Awaiting approval
                            </Badge>
                          ) : null}
                        </div>
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
                            variant="outline"
                            size="sm"
                            onClick={() => openEdit(automation)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteConfirmTarget(automation)}
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
                  <Label>Trigger</Label>
                  <Select
                    value={triggerType}
                    onValueChange={(v) => setTriggerType(v as AutomationTriggerType)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRIGGER_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {triggerType === "cron" ? (
                <>
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
                </>
              ) : (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="automation-watch-path">Directory to watch</Label>
                    <Input
                      id="automation-watch-path"
                      placeholder="e.g. knowledge-base or /absolute/path"
                      value={watchPath}
                      onChange={(e) => setWatchPath(e.target.value)}
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                      Checked every 30s. The agent runs when a file under this directory changes,
                      with the list of changed files appended to the prompt.
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="automation-watch-glob">File suffix filter (optional)</Label>
                    <Input
                      id="automation-watch-glob"
                      placeholder="e.g. .md"
                      value={watchGlob}
                      onChange={(e) => setWatchGlob(e.target.value)}
                      className="font-mono"
                    />
                  </div>
                </>
              )}

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
                    createAutomation.isPending ||
                    !name ||
                    !agentId ||
                    !prompt ||
                    (triggerType === "cron" ? !cronExpression : !watchPath)
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

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit automation</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-automation-name">Name</Label>
                <Input
                  id="edit-automation-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label>Agent</Label>
                <Select value={editAgentId} onValueChange={setEditAgentId}>
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
                <Label htmlFor="edit-automation-schedule">
                  {editing.triggerType === "file_watch"
                    ? "Directory to watch"
                    : "Cron expression"}
                </Label>
                <Input
                  id="edit-automation-schedule"
                  value={editSchedule}
                  onChange={(e) => setEditSchedule(e.target.value)}
                  className="font-mono"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="edit-automation-prompt">Prompt</Label>
                <Textarea
                  id="edit-automation-prompt"
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  rows={3}
                />
              </div>

              {updateAutomation.isError && (
                <p className="text-sm text-destructive">
                  {(updateAutomation.error as Error).message}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => updateAutomation.mutate()}
              disabled={
                updateAutomation.isPending || !editName || !editAgentId || !editPrompt || !editSchedule
              }
            >
              {updateAutomation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleteConfirmTarget)}
        onOpenChange={(open) => !open && setDeleteConfirmTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete automation</DialogTitle>
            <DialogDescription>
              This permanently deletes &quot;{deleteConfirmTarget?.name}&quot;. This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteConfirmTarget) {
                  deleteAutomation.mutate(deleteConfirmTarget.id);
                  setDeleteConfirmTarget(null);
                }
              }}
              disabled={deleteAutomation.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
