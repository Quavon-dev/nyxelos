"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plug, Sparkles, Wrench } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { trpcClient } from "@/lib/trpc";

export interface ChatToolSelection {
  skillIds: string[];
  mcpServerIds: string[];
  /** Entries shaped "serverId::toolName"; null means every tool from every
   * selected server. */
  mcpToolFilter: string[] | null;
}

/** null selection = "use this workspace's defaults" (every skill, every
 * enabled MCP server, every tool on each — see apps/server/src/auto-agent.ts).
 * Opening this popover and touching anything switches the chat over to an
 * explicit, narrower selection instead. */
export function ChatToolsPopover({
  workspaceId,
  value,
  onChange,
}: {
  workspaceId: string | undefined;
  value: ChatToolSelection | null;
  onChange: (next: ChatToolSelection | null) => void;
}) {
  const [expandedServerId, setExpandedServerId] = useState<string | null>(null);

  const skillsQuery = useQuery({
    queryKey: ["skills", "list"],
    queryFn: () => trpcClient.skills.list.query(),
  });
  const mcpServersQuery = useQuery({
    queryKey: ["mcpServers", workspaceId],
    queryFn: () => trpcClient.mcpServers.list.query({ workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
  });
  const toolsQuery = useQuery({
    queryKey: ["mcpServers", "listTools", expandedServerId],
    queryFn: () => trpcClient.mcpServers.listTools.query({ id: expandedServerId! }),
    enabled: Boolean(expandedServerId),
  });

  const skills = skillsQuery.data ?? [];
  const servers = mcpServersQuery.data ?? [];

  // Displayed state: the explicit selection once customized, otherwise
  // "everything" — matches the workspace-default behavior a plain chat gets.
  const effective: ChatToolSelection = value ?? {
    skillIds: skills.map((s) => s.id),
    mcpServerIds: servers.filter((s) => s.enabled).map((s) => s.id),
    mcpToolFilter: null,
  };

  const isCustomized = value !== null;
  const summary = isCustomized
    ? `${effective.skillIds.length} skill${effective.skillIds.length === 1 ? "" : "s"}, ${effective.mcpServerIds.length} server${effective.mcpServerIds.length === 1 ? "" : "s"}`
    : "Default";

  function commit(next: ChatToolSelection) {
    onChange(next);
  }

  function toggleSkill(skillId: string) {
    const next = effective.skillIds.includes(skillId)
      ? effective.skillIds.filter((id) => id !== skillId)
      : [...effective.skillIds, skillId];
    commit({ ...effective, skillIds: next });
  }

  function toggleServer(serverId: string) {
    const next = effective.mcpServerIds.includes(serverId)
      ? effective.mcpServerIds.filter((id) => id !== serverId)
      : [...effective.mcpServerIds, serverId];
    commit({ ...effective, mcpServerIds: next });
  }

  function toggleTool(serverId: string, toolName: string, allToolNames: string[]) {
    const key = `${serverId}::${toolName}`;
    // The filter is an allow-list. If this server has no entries yet, every
    // tool is implicitly allowed — start from "all" so unchecking one tool
    // narrows it instead of wiping every other tool for this server.
    const currentForServer =
      effective.mcpToolFilter?.filter((e) => e.startsWith(`${serverId}::`)) ??
      allToolNames.map((name) => `${serverId}::${name}`);
    const otherServers = (effective.mcpToolFilter ?? []).filter(
      (e) => !e.startsWith(`${serverId}::`),
    );
    const nextForServer = currentForServer.includes(key)
      ? currentForServer.filter((e) => e !== key)
      : [...currentForServer, key];
    commit({ ...effective, mcpToolFilter: [...otherServers, ...nextForServer] });
  }

  function isToolChecked(serverId: string, toolName: string) {
    if (!effective.mcpToolFilter) return true;
    const forServer = effective.mcpToolFilter.filter((e) => e.startsWith(`${serverId}::`));
    // No explicit entries for this server yet = every tool still allowed.
    if (
      forServer.length === 0 &&
      !effective.mcpToolFilter.some((e) => e.startsWith(`${serverId}::`))
    ) {
      return true;
    }
    return forServer.includes(`${serverId}::${toolName}`);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Wrench className="size-3.5" />
          Tools
          <Badge
            variant={isCustomized ? "secondary" : "outline"}
            className="h-4 px-1.5 text-[10px]"
          >
            {summary}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="flex items-center justify-between">
          <p className="font-medium">Skills &amp; tools for this chat</p>
          {isCustomized && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Reset
            </button>
          )}
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">
          By default a chat can use every skill and MCP server in this workspace. Narrow it down
          here if this conversation should only reach a subset.
        </p>

        <div className="max-h-72 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Sparkles className="size-3.5" />
              Skills
            </div>
            {skills.length === 0 && (
              <p className="text-xs text-muted-foreground">None available.</p>
            )}
            {skills.map((skill) => (
              <div key={skill.id} className="flex items-center gap-2">
                <Checkbox
                  id={`tool-skill-${skill.id}`}
                  checked={effective.skillIds.includes(skill.id)}
                  onCheckedChange={() => toggleSkill(skill.id)}
                />
                <Label htmlFor={`tool-skill-${skill.id}`} className="flex-1 truncate font-normal">
                  {skill.name}
                </Label>
              </div>
            ))}
          </div>

          <Separator />

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Plug className="size-3.5" />
              MCP servers
            </div>
            {servers.length === 0 && (
              <p className="text-xs text-muted-foreground">None configured.</p>
            )}
            {servers.map((server) => {
              const checked = effective.mcpServerIds.includes(server.id);
              const expanded = expandedServerId === server.id;
              return (
                <div key={server.id} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`tool-mcp-${server.id}`}
                      checked={checked}
                      disabled={!server.enabled}
                      onCheckedChange={() => toggleServer(server.id)}
                    />
                    <Label
                      htmlFor={`tool-mcp-${server.id}`}
                      className="flex-1 truncate font-normal"
                    >
                      {server.name}
                      {!server.enabled && (
                        <span className="ml-1 text-xs text-muted-foreground">(disabled)</span>
                      )}
                    </Label>
                    {checked && (
                      <button
                        type="button"
                        onClick={() => setExpandedServerId(expanded ? null : server.id)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={expanded ? "Hide tools" : "Choose individual tools"}
                      >
                        {expanded ? (
                          <ChevronDown className="size-3.5" />
                        ) : (
                          <ChevronRight className="size-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                  {expanded && checked && (
                    <div className="ml-6 space-y-1 border-l pl-3">
                      {toolsQuery.isLoading && (
                        <p className="text-xs text-muted-foreground">Loading tools…</p>
                      )}
                      {toolsQuery.data?.length === 0 && (
                        <p className="text-xs text-muted-foreground">No tools exposed.</p>
                      )}
                      {toolsQuery.data?.map((mcpTool) => (
                        <div key={mcpTool.name} className="flex items-center gap-2">
                          <Checkbox
                            id={`tool-${server.id}-${mcpTool.name}`}
                            checked={isToolChecked(server.id, mcpTool.name)}
                            onCheckedChange={() =>
                              toggleTool(
                                server.id,
                                mcpTool.name,
                                (toolsQuery.data ?? []).map((t) => t.name),
                              )
                            }
                          />
                          <Label
                            htmlFor={`tool-${server.id}-${mcpTool.name}`}
                            className="flex-1 truncate font-mono text-xs font-normal"
                          >
                            {mcpTool.name}
                          </Label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
