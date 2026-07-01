"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { type ProbedModelProvider, trpcClient } from "@/lib/trpc";

export default function WorkspaceSettingsPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const queryClient = useQueryClient();

  const workspaceQuery = useQuery({
    queryKey: ["workspace", workspaceId],
    queryFn: () => trpcClient.workspaces.get.query({ workspaceId }),
  });
  const installedProvidersQuery = useQuery({
    queryKey: ["models", "installations", workspaceId],
    queryFn: () => trpcClient.models.installations.query({ workspaceId }),
  });
  const availableModelsQuery = useQuery({
    queryKey: ["models", "list", workspaceId],
    queryFn: () => trpcClient.models.list.query({ workspaceId }),
  });

  const [instructions, setInstructions] = useState("");
  const [providerLabel, setProviderLabel] = useState("");
  const [providerBaseUrl, setProviderBaseUrl] = useState("http://localhost:1234");
  const [providerApiKey, setProviderApiKey] = useState("");
  const [probeResult, setProbeResult] = useState<ProbedModelProvider | null>(null);

  useEffect(() => {
    if (workspaceQuery.data) setInstructions(workspaceQuery.data.customInstructions ?? "");
  }, [workspaceQuery.data]);

  const saveInstructions = useMutation({
    mutationFn: () =>
      trpcClient.workspaces.updateInstructions.mutate({
        workspaceId,
        customInstructions: instructions.trim() === "" ? null : instructions,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
    },
  });

  const probeProvider = useMutation({
    mutationFn: async () => {
      const result = await trpcClient.models.probe.query({
        label: providerLabel.trim() || undefined,
        baseUrl: providerBaseUrl.trim(),
        apiKey: providerApiKey.trim() || undefined,
      });
      setProbeResult(result);
      return result;
    },
  });

  const installProvider = useMutation({
    mutationFn: async () => {
      const result =
        probeResult ??
        (await trpcClient.models.probe.query({
          label: providerLabel.trim() || undefined,
          baseUrl: providerBaseUrl.trim(),
          apiKey: providerApiKey.trim() || undefined,
        }));

      return trpcClient.models.installCustom.mutate({
        workspaceId,
        label: providerLabel.trim() || result.providerLabel,
        baseUrl: providerBaseUrl.trim(),
        apiKey: providerApiKey.trim() || undefined,
        modelIds: result.modelIds,
      });
    },
    onSuccess: () => {
      setProbeResult(null);
      setProviderLabel("");
      setProviderApiKey("");
      queryClient.invalidateQueries({ queryKey: ["models", "installations", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["models", "list", workspaceId] });
    },
  });

  const removeProvider = useMutation({
    mutationFn: ({ id }: { id: string }) => trpcClient.models.deleteInstallation.mutate({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models", "installations", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["models", "list", workspaceId] });
    },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Workspace settings</h1>
        <p className="text-muted-foreground">
          Configure prompt defaults and install additional model endpoints for this workspace.
        </p>
      </div>

      <Card className="space-y-3 p-4">
        <div>
          <h2 className="font-medium">Custom instructions</h2>
          <p className="text-sm text-muted-foreground">
            Prepended as a system-prompt block before every chat in this workspace.
          </p>
        </div>
        <Textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="e.g. Always answer in German. Prefer concise, direct answers."
          rows={8}
          disabled={workspaceQuery.isLoading}
        />
        <div className="flex items-center gap-3">
          <Button
            onClick={() => saveInstructions.mutate()}
            disabled={saveInstructions.isPending || workspaceQuery.isLoading}
          >
            {saveInstructions.isPending ? "Saving…" : "Save"}
          </Button>
          {saveInstructions.isSuccess && (
            <span className="text-sm text-muted-foreground">Saved.</span>
          )}
        </div>
      </Card>

      <Card className="space-y-4 p-4">
        <div>
          <h2 className="font-medium">Installed model providers</h2>
          <p className="text-sm text-muted-foreground">
            Saved OpenAI-compatible endpoints are merged into the model picker for chats and agents.
          </p>
        </div>

        {installedProvidersQuery.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">No custom providers installed yet.</p>
        )}

        <div className="space-y-3">
          {installedProvidersQuery.data?.map((provider) => (
            <div
              key={provider.id}
              className="flex flex-col gap-3 rounded-md border p-3 md:flex-row md:items-start md:justify-between"
            >
              <div className="space-y-1 text-sm">
                <div className="font-medium">{provider.label}</div>
                <div className="text-muted-foreground">{provider.baseUrl}</div>
                <div className="text-muted-foreground">Models: {provider.modelIds.join(", ")}</div>
              </div>
              <Button
                variant="outline"
                onClick={() => removeProvider.mutate({ id: provider.id })}
                disabled={removeProvider.isPending}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card className="space-y-4 p-4">
        <div>
          <h2 className="font-medium">Install custom provider</h2>
          <p className="text-sm text-muted-foreground">
            Probe any OpenAI-compatible endpoint such as LM Studio, vLLM, LocalAI, llama.cpp, Jan,
            or a remote compatible gateway, then install its exposed models into this workspace.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Input
            placeholder="Provider label (optional)"
            value={providerLabel}
            onChange={(e) => setProviderLabel(e.target.value)}
          />
          <Input
            placeholder="http://localhost:1234"
            value={providerBaseUrl}
            onChange={(e) => setProviderBaseUrl(e.target.value)}
          />
        </div>
        <Input
          placeholder="API key (optional)"
          type="password"
          value={providerApiKey}
          onChange={(e) => setProviderApiKey(e.target.value)}
        />

        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() => probeProvider.mutate()}
            disabled={probeProvider.isPending || !providerBaseUrl.trim()}
          >
            {probeProvider.isPending ? "Probing…" : "Probe endpoint"}
          </Button>
          <Button
            onClick={() => installProvider.mutate()}
            disabled={installProvider.isPending || !providerBaseUrl.trim()}
          >
            {installProvider.isPending ? "Installing…" : "Install provider"}
          </Button>
        </div>

        {probeProvider.isError && (
          <p className="text-sm text-destructive">{(probeProvider.error as Error).message}</p>
        )}
        {installProvider.isError && (
          <p className="text-sm text-destructive">{(installProvider.error as Error).message}</p>
        )}

        {probeResult && (
          <div className="rounded-md border p-3 text-sm">
            <div className="font-medium">{probeResult.providerLabel}</div>
            <div className="text-muted-foreground">{probeResult.baseUrl}</div>
            <div className="mt-2">Detected models: {probeResult.modelIds.join(", ")}</div>
          </div>
        )}
      </Card>

      <Card className="space-y-3 p-4">
        <div>
          <h2 className="font-medium">Available models</h2>
          <p className="text-sm text-muted-foreground">
            Auto-detected local runtimes and installed providers appear together here.
          </p>
        </div>
        {availableModelsQuery.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No models available yet. Start a local runtime or install a compatible endpoint.
          </p>
        )}
        <ul className="space-y-2">
          {availableModelsQuery.data?.map((model) => (
            <li
              key={model.id}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              <span>{model.label}</span>
              <span className="text-muted-foreground">
                {model.kind} · {model.providerLabel}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
