"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { type McpTransportKind, trpcClient } from "@/lib/trpc";

export default function McpServersPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const queryClient = useQueryClient();

  const serversQuery = useQuery({
    queryKey: ["mcpServers", workspaceId],
    queryFn: () => trpcClient.mcpServers.list.query({ workspaceId }),
  });

  const [name, setName] = useState("");
  const [transport, setTransport] = useState<McpTransportKind>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");

  const createServer = useMutation({
    mutationFn: () =>
      trpcClient.mcpServers.create.mutate({
        workspaceId,
        name,
        transport,
        command: transport === "stdio" ? command : undefined,
        args: transport === "stdio" && args.trim() ? args.trim().split(/\s+/) : undefined,
        url: transport === "http" ? url : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcpServers", workspaceId] });
      setName("");
      setCommand("");
      setArgs("");
      setUrl("");
    },
  });

  const deleteServer = useMutation({
    mutationFn: (id: string) => trpcClient.mcpServers.delete.mutate({ id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mcpServers", workspaceId] }),
  });

  const [testedServerId, setTestedServerId] = useState<string | null>(null);
  const testConnection = useMutation({
    mutationFn: (id: string) => trpcClient.mcpServers.listTools.query({ id }),
    onMutate: (id) => setTestedServerId(id),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">MCP servers</h1>
        <p className="text-muted-foreground">
          Connected tool servers, reachable by any agent that lists them (ARCHITECTURE.md section
          8). Nyxel connects on demand — nothing here is kept running until an agent actually needs
          it.
        </p>
      </div>

      <Card className="space-y-2 p-4">
        <h2 className="font-medium">Configured servers</h2>
        {serversQuery.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">No MCP servers configured yet.</p>
        )}
        <ul className="space-y-2">
          {serversQuery.data?.map((server) => (
            <li key={server.id} className="space-y-2 rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{server.name}</span>{" "}
                  <span className="text-muted-foreground">
                    ({server.transport}
                    {server.transport === "stdio" ? ` · ${server.command}` : ` · ${server.url}`})
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testConnection.mutate(server.id)}
                    disabled={testConnection.isPending && testedServerId === server.id}
                  >
                    {testConnection.isPending && testedServerId === server.id
                      ? "Connecting…"
                      : "Test connection"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => deleteServer.mutate(server.id)}>
                    Delete
                  </Button>
                </div>
              </div>

              {testedServerId === server.id && testConnection.isSuccess && (
                <div className="text-muted-foreground">
                  {testConnection.data.length === 0
                    ? "Connected, but the server exposes no tools."
                    : `Tools: ${testConnection.data.map((t) => t.name).join(", ")}`}
                </div>
              )}
              {testedServerId === server.id && testConnection.isError && (
                <div className="text-destructive">{(testConnection.error as Error).message}</div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="font-medium">Add server</h2>

        <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />

        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={transport === "stdio"}
              onChange={() => setTransport("stdio")}
            />
            stdio (local command)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={transport === "http"}
              onChange={() => setTransport("http")}
            />
            http (remote URL)
          </label>
        </div>

        {transport === "stdio" ? (
          <>
            <Input
              placeholder="Command, e.g. npx"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
            <Input
              placeholder="Arguments, space-separated, e.g. -y @modelcontextprotocol/server-filesystem /tmp"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
            />
          </>
        ) : (
          <Input
            placeholder="https://example.com/mcp"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        )}

        <Button
          onClick={() => createServer.mutate()}
          disabled={createServer.isPending || !name || (transport === "stdio" ? !command : !url)}
        >
          {createServer.isPending ? "Adding…" : "Add server"}
        </Button>
        {createServer.isError && (
          <p className="text-sm text-destructive">{(createServer.error as Error).message}</p>
        )}
      </Card>
    </div>
  );
}
