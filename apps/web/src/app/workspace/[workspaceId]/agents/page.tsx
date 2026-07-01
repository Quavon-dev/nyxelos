"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2, Network, Sparkles, Square, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { CardListSkeleton, PageHeaderSkeleton, StatCardsSkeleton } from "@/components/loading";
import { PageHeader, StatCard } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { type AgentRunStatus, type AgentSummary, type AutonomyLevel, trpcClient } from "@/lib/trpc";

const AUTONOMY_LEVELS: AutonomyLevel[] = ["chat", "assisted", "autonomous", "super_agent"];

const AUTONOMY_BADGE: Record<AutonomyLevel, string> = {
  chat: "border-0 bg-blue-500/15 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  assisted: "border-0 bg-amber-500/15 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  autonomous: "border-0 bg-green-500/15 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  super_agent:
    "border-0 bg-violet-500/15 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300",
};

const ACTIVE_RUN_STATUSES = new Set<AgentRunStatus>(["pending", "running", "waiting_approval"]);

const ONE_OFF_CHAT_AGENT_NAME = "Chat — custom tools";

function AutonomyBadge({ level }: { level: AutonomyLevel }) {
  return (
    <Badge variant="outline" className={AUTONOMY_BADGE[level]}>
      {level.replace("_", " ")}
    </Badge>
  );
}

/** Header + "select all" toggle shared by the skills/tools/MCP checklists in
 * the create/edit form — lets a user attach everything in one click instead
 * of ticking each box, per the "mehr auf einmal auswählen" ask. */
function SelectAllRow({
  label,
  allIds,
  selectedIds,
  onChange,
}: {
  label: string;
  allIds: string[];
  selectedIds: string[];
  onChange: (next: string[]) => void;
}) {
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id));
  return (
    <div className="flex items-center justify-between">
      <Label>{label}</Label>
      <button
        type="button"
        className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        onClick={() => onChange(allSelected ? [] : allIds)}
      >
        {allSelected ? "Clear all" : "Select all"}
      </button>
    </div>
  );
}

export default function AgentsPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const queryClient = useQueryClient();

  const agentsQuery = useQuery({
    queryKey: ["agents", workspaceId],
    queryFn: () => trpcClient.agents.list.query({ workspaceId }),
  });
  const modelsQuery = useQuery({
    queryKey: ["models", "list", workspaceId],
    queryFn: () => trpcClient.models.list.query({ workspaceId }),
  });
  const skillsQuery = useQuery({
    queryKey: ["skills", "list", workspaceId],
    queryFn: () => trpcClient.skills.list.query({ workspaceId }),
  });
  const toolsQuery = useQuery({
    queryKey: ["tools", "list", workspaceId],
    queryFn: () => trpcClient.tools.list.query({ workspaceId }),
  });
  const mcpServersQuery = useQuery({
    queryKey: ["mcpServers", workspaceId],
    queryFn: () => trpcClient.mcpServers.list.query({ workspaceId }),
  });
  // Polled separately (short interval) so the "running" badge in the table
  // stays live without refetching every agent's full config on a timer too.
  const activeRunsQuery = useQuery({
    queryKey: ["agentRuns", "active", workspaceId],
    queryFn: () => trpcClient.agentRuns.listActive.query({ workspaceId }),
    refetchInterval: 5_000,
  });

  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [goalTemplate, setGoalTemplate] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [modelId, setModelId] = useState("");
  const [autonomyLevel, setAutonomyLevel] = useState<AutonomyLevel>("assisted");
  const [autoAttachWorkspaceTools, setAutoAttachWorkspaceTools] = useState(true);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [mcpServerIds, setMcpServerIds] = useState<string[]>([]);
  const [delegateAgentIds, setDelegateAgentIds] = useState<string[]>([]);

  function resetForm() {
    setEditingAgentId(null);
    setName("");
    setRole("");
    setGoalTemplate("");
    setSystemPrompt("");
    setAutoAttachWorkspaceTools(true);
    setSkillIds([]);
    setToolIds([]);
    setMcpServerIds([]);
    setDelegateAgentIds([]);
  }

  function startEditing(agent: AgentSummary) {
    setEditingAgentId(agent.id);
    setName(agent.name);
    setRole(agent.role ?? "");
    setGoalTemplate(agent.goalTemplate ?? "");
    setSystemPrompt(agent.systemPrompt ?? "");
    setModelId(agent.modelId);
    setAutonomyLevel(agent.autonomyLevel);
    setAutoAttachWorkspaceTools(false);
    setSkillIds(agent.skillIds);
    setToolIds(agent.toolIds);
    setMcpServerIds(agent.mcpServerIds);
    setDelegateAgentIds(agent.delegateAgentIds);
  }

  const createAgent = useMutation({
    mutationFn: () =>
      trpcClient.agents.create.mutate({
        workspaceId,
        name,
        role: role || undefined,
        goalTemplate: goalTemplate || undefined,
        systemPrompt: systemPrompt || undefined,
        modelId,
        autonomyLevel,
        skillIds: autoAttachWorkspaceTools ? undefined : skillIds,
        toolIds: autoAttachWorkspaceTools ? undefined : toolIds,
        mcpServerIds: autoAttachWorkspaceTools ? undefined : mcpServerIds,
        autoAttachWorkspaceTools,
        delegateAgentIds: autonomyLevel === "super_agent" ? delegateAgentIds : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents", workspaceId] });
      resetForm();
    },
  });

  const updateAgent = useMutation({
    mutationFn: () =>
      trpcClient.agents.update.mutate({
        id: editingAgentId as string,
        name,
        role: role || null,
        goalTemplate: goalTemplate || null,
        systemPrompt: systemPrompt || null,
        modelId,
        autonomyLevel,
        skillIds,
        toolIds,
        mcpServerIds,
        delegateAgentIds: autonomyLevel === "super_agent" ? delegateAgentIds : [],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents", workspaceId] });
      resetForm();
    },
  });

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<AgentSummary | null>(null);
  const deleteAgent = useMutation({
    mutationFn: (id: string) => trpcClient.agents.delete.mutate({ id }),
    onMutate: (id) => setDeletingId(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["agents", workspaceId] });
      if (editingAgentId === id) resetForm();
    },
    onSettled: () => setDeletingId(null),
  });

  const [stoppingRunId, setStoppingRunId] = useState<string | null>(null);
  const stopAgent = useMutation({
    mutationFn: (runId: string) => trpcClient.agentRuns.cancel.mutate({ runId }),
    onMutate: (runId) => setStoppingRunId(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agentRuns", "active", workspaceId] });
    },
    onSettled: () => setStoppingRunId(null),
  });

  const cleanupUnusedChatAgents = useMutation({
    mutationFn: () => trpcClient.agents.cleanupUnusedChatAgents.mutate({ workspaceId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents", workspaceId] });
    },
  });

  const isEditing = Boolean(editingAgentId);
  const saveAgent = isEditing ? updateAgent : createAgent;

  function toggle(list: string[], id: string, set: (next: string[]) => void) {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  const agents = agentsQuery.data ?? [];
  const schedulableCount = agents.filter(
    (a) => a.autonomyLevel === "autonomous" || a.autonomyLevel === "super_agent",
  ).length;
  const activeRunByAgentId = new Map(
    (activeRunsQuery.data ?? []).map((run) => [run.agentId, run]),
  );
  const oneOffChatAgentCount = agents.filter((a) => a.name === ONE_OFF_CHAT_AGENT_NAME).length;

  if (agentsQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
        <PageHeaderSkeleton actions={1} />
        <StatCardsSkeleton count={3} />
        <CardListSkeleton rows={4} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Agents"
        description="Saved configurations of system prompt, model, autonomy level, and attached skills/tools/MCP servers."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total agents" value={agents.length} icon={<Bot className="size-4" />} />
        <StatCard
          label="Schedulable"
          value={schedulableCount}
          icon={<Sparkles className="size-4" />}
        />
        <StatCard
          label="MCP servers wired"
          value={mcpServersQuery.data?.length ?? 0}
          icon={<Network className="size-4" />}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Existing agents</CardTitle>
            {oneOffChatAgentCount > 0 && (
              <CardDescription>
                {oneOffChatAgentCount} one-off "{ONE_OFF_CHAT_AGENT_NAME}" agent
                {oneOffChatAgentCount === 1 ? "" : "s"} from chat toolbar tweaks.
              </CardDescription>
            )}
          </div>
          {oneOffChatAgentCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => cleanupUnusedChatAgents.mutate()}
              disabled={cleanupUnusedChatAgents.isPending}
            >
              {cleanupUnusedChatAgents.isPending
                ? "Cleaning up…"
                : `Clean up unused chat agents (${oneOffChatAgentCount})`}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {cleanupUnusedChatAgents.isSuccess && (
            <p className="mb-3 text-sm text-muted-foreground">
              Deleted {cleanupUnusedChatAgents.data} unused agent
              {cleanupUnusedChatAgents.data === 1 ? "" : "s"}.
            </p>
          )}
          {agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No agents yet.</p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Autonomy</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Skills</TableHead>
                    <TableHead>Tools</TableHead>
                    <TableHead>Delegates</TableHead>
                    <TableHead className="w-[180px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agents.map((agent) => {
                    const activeRun = activeRunByAgentId.get(agent.id);
                    return (
                      <TableRow key={agent.id}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/workspace/${workspaceId}/agents/${agent.id}`}
                            className="hover:underline"
                          >
                            {agent.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{agent.role ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{agent.modelId}</TableCell>
                        <TableCell>
                          <AutonomyBadge level={agent.autonomyLevel} />
                        </TableCell>
                        <TableCell>
                          {activeRun ? (
                            <Badge
                              variant="outline"
                              className="border-0 bg-violet-500/15 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
                            >
                              <Loader2 className="mr-1 size-3 animate-spin" />
                              running
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-0 bg-muted text-muted-foreground">
                              idle
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {agent.skillIds.length > 0 ? agent.skillIds.length : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {agent.toolIds.length > 0 ? agent.toolIds.length : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {agent.delegateAgentIds.length > 0 ? agent.delegateAgentIds.length : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            {activeRun && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => stopAgent.mutate(activeRun.id)}
                                disabled={stoppingRunId === activeRun.id}
                                title="Stop this run"
                              >
                                <Square className="size-3.5" />
                              </Button>
                            )}
                            <Button variant="ghost" size="sm" onClick={() => startEditing(agent)}>
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setDeleteConfirmTarget(agent)}
                              disabled={deletingId === agent.id}
                              title="Delete agent"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {deleteAgent.isError && (
            <p className="mt-3 text-sm text-destructive">{(deleteAgent.error as Error).message}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{isEditing ? "Edit agent" : "Create agent"}</CardTitle>
          <CardDescription>
            {isEditing
              ? "Update this agent's role, goal, model, autonomy, or delegate policy."
              : "Pick a model and autonomy level. By default the agent inherits all current workspace skills and MCP servers automatically."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="agent-name">Name</Label>
            <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="agent-role">Role</Label>
              <Input
                id="agent-role"
                placeholder="e.g. security, marketing, coding, orchestrator"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="agent-goal-template">Goal template</Label>
              <Input
                id="agent-goal-template"
                placeholder="Optional default goal pattern"
                value={goalTemplate}
                onChange={(e) => setGoalTemplate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="agent-prompt">System prompt</Label>
            <Textarea
              id="agent-prompt"
              placeholder="Optional — how this agent should behave"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={4}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Model</Label>
              <Select value={modelId} onValueChange={setModelId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a model…" />
                </SelectTrigger>
                <SelectContent>
                  {modelsQuery.data?.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label} ({m.kind})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Autonomy level</Label>
              <Select
                value={autonomyLevel}
                onValueChange={(v) => setAutonomyLevel(v as AutonomyLevel)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUTONOMY_LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {level.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!isEditing && (
            <div className="flex items-start gap-3 rounded-lg border p-3">
              <Checkbox
                id="auto-attach-tools"
                checked={autoAttachWorkspaceTools}
                onCheckedChange={(checked) => setAutoAttachWorkspaceTools(Boolean(checked))}
                className="mt-0.5"
              />
              <Label htmlFor="auto-attach-tools" className="flex-1 font-normal">
                <span className="font-medium text-foreground">
                  Auto-attach all runtime skills, workspace tools, and MCP servers
                </span>
                <span className="block text-xs text-muted-foreground">
                  Keeps the agent tool-ready regardless of model. Sensitive actions still go through
                  the normal approval queue.
                </span>
              </Label>
            </div>
          )}

          {!autoAttachWorkspaceTools && skillsQuery.data && skillsQuery.data.length > 0 && (
            <div className="space-y-2">
              <SelectAllRow
                label="Skills"
                allIds={skillsQuery.data.map((s) => s.id)}
                selectedIds={skillIds}
                onChange={setSkillIds}
              />
              <p className="text-xs text-muted-foreground">
                Real runtime skills — built-in, read-only.
              </p>
              <div className="space-y-2 rounded-lg border p-3">
                {skillsQuery.data.map((skill) => (
                  <div key={skill.id} className="flex items-start gap-2">
                    <Checkbox
                      id={`skill-${skill.id}`}
                      checked={skillIds.includes(skill.id)}
                      onCheckedChange={() => toggle(skillIds, skill.id, setSkillIds)}
                      className="mt-0.5"
                    />
                    <Label htmlFor={`skill-${skill.id}`} className="flex-1 font-normal">
                      <span className="font-medium text-foreground">{skill.name}</span>
                      {skill.sensitive && (
                        <span className="ml-1 text-xs text-muted-foreground">(needs approval)</span>
                      )}
                      <span className="block text-xs text-muted-foreground">
                        {skill.description}
                      </span>
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!autoAttachWorkspaceTools && toolsQuery.data && toolsQuery.data.length > 0 && (
            <div className="space-y-2">
              <SelectAllRow
                label="Tools"
                allIds={toolsQuery.data.map((t) => t.id)}
                selectedIds={toolIds}
                onChange={setToolIds}
              />
              <p className="text-xs text-muted-foreground">
                Workspace-configured tools — manage these from the Tools page.
              </p>
              <div className="space-y-2 rounded-lg border p-3">
                {toolsQuery.data.map((toolItem) => (
                  <div key={toolItem.id} className="flex items-start gap-2">
                    <Checkbox
                      id={`tool-${toolItem.id}`}
                      checked={toolIds.includes(toolItem.id)}
                      onCheckedChange={() => toggle(toolIds, toolItem.id, setToolIds)}
                      className="mt-0.5"
                    />
                    <Label htmlFor={`tool-${toolItem.id}`} className="flex-1 font-normal">
                      <span className="font-medium text-foreground">{toolItem.name}</span>
                      {toolItem.sensitive && (
                        <span className="ml-1 text-xs text-muted-foreground">(needs approval)</span>
                      )}
                      <span className="block text-xs text-muted-foreground">
                        {toolItem.description}
                      </span>
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!autoAttachWorkspaceTools && mcpServersQuery.data && mcpServersQuery.data.length > 0 && (
            <div className="space-y-2">
              <SelectAllRow
                label="MCP servers"
                allIds={mcpServersQuery.data.map((s) => s.id)}
                selectedIds={mcpServerIds}
                onChange={setMcpServerIds}
              />
              <div className="space-y-2 rounded-lg border p-3">
                {mcpServersQuery.data.map((server) => (
                  <div key={server.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`mcp-${server.id}`}
                      checked={mcpServerIds.includes(server.id)}
                      onCheckedChange={() => toggle(mcpServerIds, server.id, setMcpServerIds)}
                    />
                    <Label htmlFor={`mcp-${server.id}`} className="font-normal">
                      {server.name}{" "}
                      <span className="text-xs text-muted-foreground">({server.transport})</span>
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {autonomyLevel === "super_agent" && (
            <div className="space-y-2">
              <Label>Delegate to (super-agent only)</Label>
              {agents.filter((a) => a.id !== editingAgentId).length > 0 ? (
                <div className="space-y-2 rounded-lg border p-3">
                  {agents
                    .filter((a) => a.id !== editingAgentId)
                    .map((a) => (
                      <div key={a.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`delegate-${a.id}`}
                          checked={delegateAgentIds.includes(a.id)}
                          onCheckedChange={() =>
                            toggle(delegateAgentIds, a.id, setDelegateAgentIds)
                          }
                        />
                        <Label htmlFor={`delegate-${a.id}`} className="font-normal">
                          {a.name}{" "}
                          <span className="text-xs text-muted-foreground">({a.autonomyLevel})</span>
                        </Label>
                      </div>
                    ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No other agents in this workspace yet to delegate to.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 border-t pt-4">
            <Button
              onClick={() => saveAgent.mutate()}
              disabled={saveAgent.isPending || !name || !modelId}
            >
              {saveAgent.isPending ? "Saving…" : isEditing ? "Save changes" : "Create agent"}
            </Button>
            {isEditing && (
              <Button variant="ghost" onClick={resetForm}>
                Cancel
              </Button>
            )}
            {saveAgent.isError && (
              <p className="text-sm text-destructive">{(saveAgent.error as Error).message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(deleteConfirmTarget)}
        onOpenChange={(open) => !open && setDeleteConfirmTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete agent</DialogTitle>
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
                  deleteAgent.mutate(deleteConfirmTarget.id);
                  setDeleteConfirmTarget(null);
                }
              }}
              disabled={deleteAgent.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
