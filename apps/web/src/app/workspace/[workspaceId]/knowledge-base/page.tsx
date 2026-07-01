"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpcClient } from "@/lib/trpc";

function formatDate(value: Date | string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function GraphPreview({
  nodes,
  edges,
}: {
  nodes: { id: string; label: string; group: string }[];
  edges: { source: string; target: string }[];
}) {
  const radius = 130;
  const centerX = 220;
  const centerY = 180;
  const positioned = nodes.map((node, index) => {
    const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
    return {
      ...node,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    };
  });
  const byId = new Map(positioned.map((node) => [node.id, node]));

  return (
    <div className="overflow-x-auto">
      <svg viewBox="0 0 440 360" className="h-[360px] w-full min-w-[440px] rounded-md border">
        <title>Knowledge base document graph</title>
        {edges.map((edge) => {
          const source = byId.get(edge.source);
          const target = byId.get(edge.target);
          if (!source || !target) return null;
          return (
            <line
              key={`${edge.source}-${edge.target}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke="currentColor"
              strokeOpacity="0.2"
            />
          );
        })}
        {positioned.map((node) => (
          <g key={node.id}>
            <circle cx={node.x} cy={node.y} r="10" fill="currentColor" fillOpacity="0.85" />
            <text
              x={node.x}
              y={node.y - 16}
              textAnchor="middle"
              className="fill-current text-[10px]"
            >
              {node.label.length > 22 ? `${node.label.slice(0, 22)}…` : node.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function KnowledgeBasePage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const queryClient = useQueryClient();

  const overviewQuery = useQuery({
    queryKey: ["knowledgeBase", "overview", workspaceId],
    queryFn: () => trpcClient.knowledgeBase.overview.query({ workspaceId }),
  });
  const documentsQuery = useQuery({
    queryKey: ["knowledgeBase", "documents", workspaceId],
    queryFn: () => trpcClient.knowledgeBase.documents.query({ workspaceId }),
  });
  const graphQuery = useQuery({
    queryKey: ["knowledgeBase", "graph", workspaceId],
    queryFn: () => trpcClient.knowledgeBase.graph.query({ workspaceId }),
  });

  const [vaultPath, setVaultPath] = useState("knowledge-base");
  const [obsidianRestUrl, setObsidianRestUrl] = useState("http://127.0.0.1:27124/");
  const [obsidianApiKey, setObsidianApiKey] = useState("");
  const [docsAgentEnabled, setDocsAgentEnabled] = useState(true);

  useEffect(() => {
    const config = overviewQuery.data?.config;
    if (!config) return;
    setVaultPath(config.vaultPath);
    setObsidianRestUrl(config.obsidianRestUrl ?? "http://127.0.0.1:27124/");
    setDocsAgentEnabled(config.docsAgentEnabled);
  }, [overviewQuery.data?.config]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["knowledgeBase", "overview", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["knowledgeBase", "documents", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["knowledgeBase", "graph", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["auditLog", workspaceId] });
  };

  const saveConfig = useMutation({
    mutationFn: () =>
      trpcClient.knowledgeBase.updateConfig.mutate({
        workspaceId,
        vaultPath,
        obsidianRestUrl: obsidianRestUrl || null,
        obsidianApiKey: obsidianApiKey || undefined,
        docsAgentEnabled,
      }),
    onSuccess: invalidate,
  });

  const runDocsAgent = useMutation({
    mutationFn: () => trpcClient.knowledgeBase.runDocsAgent.mutate({ workspaceId }),
    onSuccess: invalidate,
  });

  const overview = overviewQuery.data;
  const documents = documentsQuery.data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Knowledge base</h1>
        <p className="text-muted-foreground">
          Obsidian-backed project memory: local vault indexing, docs-agent sync, and a lightweight
          graph view for note connectivity.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="space-y-4 p-4">
          <div>
            <h2 className="font-medium">Configuration</h2>
            <p className="text-sm text-muted-foreground">
              The vault stays file-first. Obsidian REST is optional and only used for reachability
              checks today.
            </p>
          </div>

          <Input value={vaultPath} onChange={(e) => setVaultPath(e.target.value)} />
          <Input
            value={obsidianRestUrl}
            onChange={(e) => setObsidianRestUrl(e.target.value)}
            placeholder="http://127.0.0.1:27124/"
          />
          <Input
            value={obsidianApiKey}
            onChange={(e) => setObsidianApiKey(e.target.value)}
            placeholder={
              overview?.config.obsidianApiKeySet
                ? "API key stored; enter to replace"
                : "Obsidian API key"
            }
            type="password"
          />

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={docsAgentEnabled}
              onChange={(e) => setDocsAgentEnabled(e.target.checked)}
            />
            Enable automatic docs agent
          </label>

          <div className="flex gap-2">
            <Button
              onClick={() => saveConfig.mutate()}
              disabled={saveConfig.isPending || !vaultPath}
            >
              {saveConfig.isPending ? "Saving…" : "Save config"}
            </Button>
            <Button
              variant="outline"
              onClick={() => runDocsAgent.mutate()}
              disabled={runDocsAgent.isPending}
            >
              {runDocsAgent.isPending ? "Running…" : "Run docs agent now"}
            </Button>
          </div>

          {saveConfig.isError && (
            <p className="text-sm text-destructive">{(saveConfig.error as Error).message}</p>
          )}
          {runDocsAgent.isError && (
            <p className="text-sm text-destructive">{(runDocsAgent.error as Error).message}</p>
          )}
        </Card>

        <Card className="space-y-3 p-4">
          <h2 className="font-medium">Status</h2>
          <div className="text-sm text-muted-foreground">
            Vault path: {overview?.config.absoluteVaultPath ?? "Loading…"}
          </div>
          <div className="text-sm text-muted-foreground">
            Notes: {overview?.stats.noteCount ?? 0} · Links: {overview?.stats.edgeCount ?? 0}
          </div>
          <div className="text-sm text-muted-foreground">
            Last docs sync: {formatDate(overview?.config.lastDocsSyncAt ?? null)}
          </div>
          <div className="text-sm text-muted-foreground">
            Obsidian REST:{" "}
            {overview?.obsidian.reachable ? "reachable" : (overview?.obsidian.error ?? "checking")}
          </div>
          {overview?.config.lastDocsSyncError && (
            <div className="text-sm text-destructive">{overview.config.lastDocsSyncError}</div>
          )}
        </Card>
      </div>

      <Card className="space-y-4 p-4">
        <div>
          <h2 className="font-medium">Graph view</h2>
          <p className="text-sm text-muted-foreground">
            This is rendered from markdown links in the vault, independent of the Obsidian app.
          </p>
        </div>
        {graphQuery.data ? (
          <GraphPreview
            nodes={graphQuery.data.nodes.slice(0, 20)}
            edges={graphQuery.data.edges.slice(0, 40)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Loading graph…</p>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-2 p-4">
          <h2 className="font-medium">Recent notes</h2>
          <ul className="space-y-2 text-sm">
            {(overview?.recentDocuments ?? []).map((doc) => (
              <li key={doc.path} className="rounded-md border p-3">
                <div className="font-medium">{doc.title}</div>
                <div className="text-muted-foreground">{doc.path}</div>
                <div className="text-muted-foreground">
                  {doc.links.length} link(s) · updated {formatDate(doc.modifiedAt)}
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="space-y-2 p-4">
          <h2 className="font-medium">All indexed notes</h2>
          <ul className="max-h-[420px] space-y-2 overflow-auto text-sm">
            {documents.map((doc) => (
              <li key={doc.path} className="rounded-md border p-3">
                <div className="font-medium">{doc.title}</div>
                <div className="text-muted-foreground">{doc.path}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
