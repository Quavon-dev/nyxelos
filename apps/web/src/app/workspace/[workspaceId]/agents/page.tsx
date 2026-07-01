"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Network, Sparkles } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { PageHeader, StatCard } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { type AgentSummary, type AutonomyLevel, trpcClient } from "@/lib/trpc";

const AUTONOMY_LEVELS: AutonomyLevel[] = ["chat", "assisted", "autonomous", "super_agent"];

const AUTONOMY_BADGE: Record<AutonomyLevel, string> = {
  chat: "border-0 bg-blue-500/15 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  assisted: "border-0 bg-amber-500/15 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  autonomous: "border-0 bg-green-500/15 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  super_agent:
    "border-0 bg-violet-500/15 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300",
};

function AutonomyBadge({ level }: { level: AutonomyLevel }) {
  return (
    <Badge variant="outline" className={AUTONOMY_BADGE[level]}>
      {level.replace("_", " ")}
    </Badge>
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
    queryKey: ["skills", "list"],
    queryFn: () => trpcClient.skills.list.query(),
  });
  const toolsQuery = useQuery({
    queryKey: ["tools", "list", workspaceId],
    queryFn: () => trpcClient.tools.list.query({ workspaceId }),
  });
  const mcpServersQuery = useQuery({
    queryKey: ["mcpServers", workspaceId],
    queryFn: () => trpcClient.mcpServers.list.query({ workspaceId }),
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

  const isEditing = Boolean(editingAgentId);
  const saveAgent = isEditing ? updateAgent : createAgent;

  function toggle(list: string[], id: string, set: (next: string[]) => void) {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  const agents = agentsQuery.data ?? [];
  const schedulableCount = agents.filter(
    (a) => a.autonomyLevel === "autonomous" || a.autonomyLevel === "super_agent",
  ).length;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-8">
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
        <CardHeader>
          <CardTitle>Existing agents</CardTitle>
        </CardHeader>
        <CardContent>
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
                    <TableHead>Skills</TableHead>
                    <TableHead>Tools</TableHead>
                    <TableHead>Delegates</TableHead>
                    <TableHead className="w-[80px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agents.map((agent) => (
                    <TableRow key={agent.id}>
                      <TableCell className="font-medium">{agent.name}</TableCell>
                      <TableCell className="text-muted-foreground">{agent.role ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{agent.modelId}</TableCell>
                      <TableCell>
                        <AutonomyBadge level={agent.autonomyLevel} />
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
                        <Button variant="ghost" size="sm" onClick={() => startEditing(agent)}>
                          Edit
                        </Button>
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
                  Keeps the agent tool-ready regardless of model. Sensitive actions still go
                  through the normal approval queue.
                </span>
              </Label>
            </div>
          )}

          {!autoAttachWorkspaceTools && skillsQuery.data && skillsQuery.data.length > 0 && (
            <div className="space-y-2">
              <Label>Skills</Label>
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
              <Label>Tools</Label>
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
              <Label>MCP servers</Label>
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
                          onCheckedChange={() => toggle(delegateAgentIds, a.id, setDelegateAgentIds)}
                        />
                        <Label htmlFor={`delegate-${a.id}`} className="font-normal">
                          {a.name}{" "}
                          <span className="text-xs text-muted-foreground">
                            ({a.autonomyLevel})
                          </span>
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
    </div>
  );
}
