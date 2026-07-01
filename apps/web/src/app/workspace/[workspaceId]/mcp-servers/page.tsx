"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeaderSkeleton, TableSkeleton } from "@/components/loading";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type McpServerSummary, type McpTransportKind, trpcClient } from "@/lib/trpc";

function openAuthorizationWindow(authorizationUrl: string) {
  const popup = window.open(authorizationUrl, "_blank", "noopener,noreferrer");
  if (!popup) {
    window.location.href = authorizationUrl;
  }
}

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

  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<McpServerSummary | null>(null);

  const [testedServerId, setTestedServerId] = useState<string | null>(null);
  const testConnection = useMutation({
    mutationFn: (id: string) => trpcClient.mcpServers.listTools.query({ id }),
    onMutate: (id) => setTestedServerId(id),
    onSuccess: (result) => {
      if (result.status === "auth_required") {
        openAuthorizationWindow(result.authorizationUrl);
      }
    },
  });

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "nyxel:mcp-auth-complete") return;
      if (typeof event.data.serverId !== "string") return;
      void testConnection.mutate(event.data.serverId);
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [testConnection]);

  const servers = serversQuery.data ?? [];

  if (serversQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
        <PageHeaderSkeleton actions={1} />
        <TableSkeleton rows={4} cols={4} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
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
                  {servers.map((server) =>
                    (() => {
                      const testedResult =
                        testedServerId === server.id && testConnection.isSuccess
                          ? testConnection.data
                          : null;
                      const authRequired =
                        testedResult?.status === "auth_required"
                          ? {
                              authorizationUrl: testedResult.authorizationUrl,
                              message: testedResult.message,
                            }
                          : null;
                      const invalidConfig =
                        testedResult?.status === "invalid_config"
                          ? { message: testedResult.message }
                          : null;

                      return (
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
                                  disabled={
                                    testConnection.isPending && testedServerId === server.id
                                  }
                                >
                                  {testConnection.isPending && testedServerId === server.id
                                    ? "Connecting…"
                                    : "Test connection"}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setDeleteConfirmTarget(server)}
                                >
                                  Delete
                                </Button>
                              </div>
                              {testedResult?.status === "ready" && (
                                <p className="text-xs text-muted-foreground">
                                  {testedResult.tools.length === 0
                                    ? "Connected, but exposes no tools."
                                    : `Tools: ${testedResult.tools.map((t) => t.name).join(", ")}`}
                                </p>
                              )}
                              {authRequired && (
                                <div className="space-y-1 text-xs text-muted-foreground">
                                  <p>{authRequired.message}</p>
                                  <button
                                    type="button"
                                    className="font-medium text-foreground underline underline-offset-2"
                                    onClick={() =>
                                      openAuthorizationWindow(authRequired.authorizationUrl)
                                    }
                                  >
                                    Continue sign-in
                                  </button>
                                </div>
                              )}
                              {invalidConfig && (
                                <p className="text-xs text-destructive">{invalidConfig.message}</p>
                              )}
                              {testedServerId === server.id && testConnection.isError && (
                                <p className="text-xs text-destructive">
                                  {(testConnection.error as Error).message}
                                </p>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })(),
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add server</CardTitle>
          <CardDescription>
            Register a new stdio or HTTP MCP server. For remote servers, use the actual MCP endpoint
            URL, not the provider's documentation page.
          </CardDescription>
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
              <Label htmlFor="mcp-url">MCP endpoint URL</Label>
              <Input
                id="mcp-url"
                placeholder="https://example.com/mcp"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Example: use https://api.notion.com/mcp or another direct MCP endpoint, not a docs
                URL.
              </p>
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

      <Dialog
        open={Boolean(deleteConfirmTarget)}
        onOpenChange={(open) => !open && setDeleteConfirmTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete MCP server</DialogTitle>
            <DialogDescription>
              This permanently removes &quot;{deleteConfirmTarget?.name}&quot;. Agents will no
              longer be able to reach it. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteConfirmTarget) {
                  deleteServer.mutate(deleteConfirmTarget.id);
                  setDeleteConfirmTarget(null);
                }
              }}
              disabled={deleteServer.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
