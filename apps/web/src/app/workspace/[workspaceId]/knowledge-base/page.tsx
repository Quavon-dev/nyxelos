"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { KnowledgeGraphView } from "@/components/knowledge-base/graph-view";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { trpcClient } from "@/lib/trpc";

function formatDate(value: Date | string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
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
  const [injectIntoPrompts, setInjectIntoPrompts] = useState(true);

  useEffect(() => {
    const config = overviewQuery.data?.config;
    if (!config) return;
    setVaultPath(config.vaultPath);
    setObsidianRestUrl(config.obsidianRestUrl ?? "http://127.0.0.1:27124/");
    setDocsAgentEnabled(config.docsAgentEnabled);
    setInjectIntoPrompts(config.injectIntoPrompts);
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
        injectIntoPrompts,
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
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Knowledge base"
        description="Obsidian-backed project memory: local vault indexing, docs-agent sync, and a lightweight graph view for note connectivity."
      />

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
            <p className="text-sm text-muted-foreground">
              The vault stays file-first. Obsidian REST is optional and only used for reachability
              checks today.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
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

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="docs-agent-enabled">Automatic docs agent</Label>
                <p className="text-xs text-muted-foreground">
                  Keeps the vault in sync without a manual trigger.
                </p>
              </div>
              <Switch
                id="docs-agent-enabled"
                checked={docsAgentEnabled}
                onCheckedChange={setDocsAgentEnabled}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="inject-into-prompts">Always give the model this context</Label>
                <p className="text-xs text-muted-foreground">
                  Appends a compact note index + recent notes to every chat, agent, and automation
                  system prompt in this workspace.
                </p>
              </div>
              <Switch
                id="inject-into-prompts"
                checked={injectIntoPrompts}
                onCheckedChange={setInjectIntoPrompts}
              />
            </div>

            <div className="flex gap-2 border-t pt-4">
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
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
              {overview?.obsidian.reachable
                ? "reachable"
                : (overview?.obsidian.error ?? "checking")}
            </div>
            {overview?.config.lastDocsSyncError && (
              <div className="text-sm text-destructive">{overview.config.lastDocsSyncError}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Graph view</CardTitle>
          <p className="text-sm text-muted-foreground">
            Rendered from markdown links in the vault, independent of the Obsidian app.
          </p>
        </CardHeader>
        <CardContent>
          {graphQuery.data ? (
            <KnowledgeGraphView nodes={graphQuery.data.nodes} edges={graphQuery.data.edges} />
          ) : (
            <p className="text-sm text-muted-foreground">Loading graph…</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent notes</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {(overview?.recentDocuments ?? []).map((doc) => (
                <li key={doc.path} className="rounded-lg border p-3">
                  <div className="font-medium">{doc.title}</div>
                  <div className="text-muted-foreground">{doc.path}</div>
                  <div className="text-muted-foreground">
                    {doc.links.length} link(s) · updated {formatDate(doc.modifiedAt)}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>All indexed notes</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="max-h-[420px] space-y-2 overflow-auto text-sm">
              {documents.map((doc) => (
                <li key={doc.path} className="rounded-lg border p-3">
                  <div className="font-medium">{doc.title}</div>
                  <div className="text-muted-foreground">{doc.path}</div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
