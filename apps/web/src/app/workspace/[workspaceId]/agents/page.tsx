"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { type AutonomyLevel, trpcClient } from "@/lib/trpc";

const AUTONOMY_LEVELS: AutonomyLevel[] = ["chat", "assisted", "autonomous", "super_agent"];

export default function AgentsPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const queryClient = useQueryClient();

  const agentsQuery = useQuery({
    queryKey: ["agents", workspaceId],
    queryFn: () => trpcClient.agents.list.query({ workspaceId }),
  });
  const modelsQuery = useQuery({
    queryKey: ["models", "list"],
    queryFn: () => trpcClient.models.list.query(),
  });
  const skillsQuery = useQuery({
    queryKey: ["skills", "list"],
    queryFn: () => trpcClient.skills.list.query(),
  });
  const mcpServersQuery = useQuery({
    queryKey: ["mcpServers", workspaceId],
    queryFn: () => trpcClient.mcpServers.list.query({ workspaceId }),
  });

  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [modelId, setModelId] = useState("");
  const [autonomyLevel, setAutonomyLevel] = useState<AutonomyLevel>("assisted");
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [mcpServerIds, setMcpServerIds] = useState<string[]>([]);
  const [delegateAgentIds, setDelegateAgentIds] = useState<string[]>([]);

  const createAgent = useMutation({
    mutationFn: () =>
      trpcClient.agents.create.mutate({
        workspaceId,
        name,
        systemPrompt: systemPrompt || undefined,
        modelId,
        autonomyLevel,
        skillIds,
        mcpServerIds,
        delegateAgentIds: autonomyLevel === "super_agent" ? delegateAgentIds : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents", workspaceId] });
      setName("");
      setSystemPrompt("");
      setSkillIds([]);
      setMcpServerIds([]);
      setDelegateAgentIds([]);
    },
  });

  function toggle(list: string[], id: string, set: (next: string[]) => void) {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <p className="text-muted-foreground">
          Saved configurations of system prompt, model, autonomy level, and attached skills/MCP
          tools (ARCHITECTURE.md section 6).
        </p>
      </div>

      <Card className="space-y-2 p-4">
        <h2 className="font-medium">Existing agents</h2>
        {agentsQuery.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">No agents yet.</p>
        )}
        <ul className="space-y-2">
          {agentsQuery.data?.map((agent) => (
            <li key={agent.id} className="rounded-md border p-3 text-sm">
              <div className="flex justify-between">
                <span className="font-medium">{agent.name}</span>
                <span className="text-muted-foreground">{agent.autonomyLevel}</span>
              </div>
              <div className="text-muted-foreground">{agent.modelId}</div>
              {agent.skillIds.length > 0 && (
                <div className="text-muted-foreground">Skills: {agent.skillIds.join(", ")}</div>
              )}
              {agent.delegateAgentIds.length > 0 && (
                <div className="text-muted-foreground">
                  Delegates to {agent.delegateAgentIds.length} agent(s)
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="font-medium">Create agent</h2>

        <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />

        <Textarea
          placeholder="System prompt"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={4}
        />

        <select
          className="flex h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
        >
          <option value="">Select a model…</option>
          {modelsQuery.data?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} ({m.kind})
            </option>
          ))}
        </select>

        <select
          className="flex h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none"
          value={autonomyLevel}
          onChange={(e) => setAutonomyLevel(e.target.value as AutonomyLevel)}
        >
          {AUTONOMY_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>

        {skillsQuery.data && skillsQuery.data.length > 0 && (
          <div className="space-y-1">
            <div className="text-sm font-medium">Skills</div>
            {skillsQuery.data.map((skill) => (
              <label key={skill.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={skillIds.includes(skill.id)}
                  onChange={() => toggle(skillIds, skill.id, setSkillIds)}
                />
                {skill.name}
                {skill.sensitive && (
                  <span className="text-xs text-muted-foreground">(needs approval)</span>
                )}
                — <span className="text-muted-foreground">{skill.description}</span>
              </label>
            ))}
          </div>
        )}

        {mcpServersQuery.data && mcpServersQuery.data.length > 0 && (
          <div className="space-y-1">
            <div className="text-sm font-medium">MCP servers</div>
            {mcpServersQuery.data.map((server) => (
              <label key={server.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={mcpServerIds.includes(server.id)}
                  onChange={() => toggle(mcpServerIds, server.id, setMcpServerIds)}
                />
                {server.name} ({server.transport})
              </label>
            ))}
          </div>
        )}

        {autonomyLevel === "super_agent" && (
          <div className="space-y-1">
            <div className="text-sm font-medium">Delegate to (super-agent only)</div>
            {agentsQuery.data && agentsQuery.data.length > 0 ? (
              agentsQuery.data.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={delegateAgentIds.includes(a.id)}
                    onChange={() => toggle(delegateAgentIds, a.id, setDelegateAgentIds)}
                  />
                  {a.name} ({a.autonomyLevel})
                </label>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No other agents in this workspace yet to delegate to.
              </p>
            )}
          </div>
        )}

        <Button
          onClick={() => createAgent.mutate()}
          disabled={createAgent.isPending || !name || !modelId}
        >
          {createAgent.isPending ? "Creating…" : "Create agent"}
        </Button>
        {createAgent.isError && (
          <p className="text-sm text-destructive">{(createAgent.error as Error).message}</p>
        )}
      </Card>
    </div>
  );
}
