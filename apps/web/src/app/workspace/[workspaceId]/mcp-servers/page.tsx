"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

  const servers = serversQuery.data ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-8">
      <PageHeader
        title="MCP servers"
        description="Connected tool servers, reachable by any agent that lists them. Nyxel connects on demand — nothing here is kept running until an agent actually needs it."
      />

      <Card>
        <CardHeader>
          <CardTitle>Configured servers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {servers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No MCP servers configured yet.</p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Transport</TableHead>
                    <TableHead>Endpoint</TableHead>
                    <TableHead className="w-[280px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {servers.map((server) => (
                    <TableRow key={server.id}>
                      <TableCell className="font-medium">{server.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="uppercase">
                          {server.transport}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate text-muted-foreground">
                        {server.transport === "stdio" ? server.command : server.url}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-2">
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
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteServer.mutate(server.id)}
                            >
                              Delete
                            </Button>
                          </div>
                          {testedServerId === server.id && testConnection.isSuccess && (
                            <p className="text-xs text-muted-foreground">
                              {testConnection.data.length === 0
                                ? "Connected, but exposes no tools."
                                : `Tools: ${testConnection.data.map((t) => t.name).join(", ")}`}
                            </p>
                          )}
                          {testedServerId === server.id && testConnection.isError && (
                            <p className="text-xs text-destructive">
                              {(testConnection.error as Error).message}
                            </p>
                          )}
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
          <CardTitle>Add server</CardTitle>
          <CardDescription>Register a new stdio or HTTP MCP server.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="mcp-name">Name</Label>
            <Input id="mcp-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="grid gap-2">
            <Label>Transport</Label>
            <RadioGroup
              value={transport}
              onValueChange={(v) => setTransport(v as McpTransportKind)}
              className="grid-cols-2"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="stdio" id="transport-stdio" />
                <Label htmlFor="transport-stdio" className="font-normal">
                  stdio (local command)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="http" id="transport-http" />
                <Label htmlFor="transport-http" className="font-normal">
                  http (remote URL)
                </Label>
              </div>
            </RadioGroup>
          </div>

          {transport === "stdio" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="mcp-command">Command</Label>
                <Input
                  id="mcp-command"
                  placeholder="e.g. npx"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="mcp-args">Arguments</Label>
                <Input
                  id="mcp-args"
                  placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="mcp-url">URL</Label>
              <Input
                id="mcp-url"
                placeholder="https://example.com/mcp"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
          )}

          <div className="flex items-center gap-3 border-t pt-4">
            <Button
              onClick={() => createServer.mutate()}
              disabled={
                createServer.isPending || !name || (transport === "stdio" ? !command : !url)
              }
            >
              {createServer.isPending ? "Adding…" : "Add server"}
            </Button>
            {createServer.isError && (
              <p className="text-sm text-destructive">{(createServer.error as Error).message}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
