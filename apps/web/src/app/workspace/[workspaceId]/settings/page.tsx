"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, NotebookPen, Plug } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { type ProbedModelProvider, trpcClient } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const SECTIONS = [
  {
    id: "instructions",
    label: "Instructions",
    icon: NotebookPen,
    description: "Prepended as a system-prompt block before every chat in this workspace.",
  },
  {
    id: "providers",
    label: "Model providers",
    icon: Plug,
    description: "Saved OpenAI-compatible endpoints merged into the model picker.",
  },
  {
    id: "models",
    label: "Models",
    icon: Bot,
    description: "Everything currently available to chats and agents in this workspace.",
  },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export default function WorkspaceSettingsPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const queryClient = useQueryClient();
  const [section, setSection] = useState<SectionId>("instructions");

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

  const activeSection = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-8">
      <PageHeader
        title="Workspace settings"
        description="Configure prompt defaults and model providers for this workspace."
      />

      <div className="grid gap-6 md:grid-cols-[220px_1fr]">
        <nav className="space-y-1">
          {SECTIONS.map((item) => {
            const isActive = item.id === section;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                  isActive
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <item.icon className="size-4 shrink-0" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <Card>
          <CardHeader>
            <CardTitle>{activeSection.label}</CardTitle>
            <CardDescription>{activeSection.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {section === "instructions" && (
              <div className="space-y-3">
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
              </div>
            )}

            {section === "providers" && (
              <div className="space-y-6">
                <div className="space-y-3">
                  <h3 className="text-sm font-medium">Installed</h3>
                  {installedProvidersQuery.data?.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No custom providers installed yet.
                    </p>
                  )}
                  <div className="space-y-3">
                    {installedProvidersQuery.data?.map((provider) => (
                      <div
                        key={provider.id}
                        className="flex flex-col gap-3 rounded-lg border p-3 md:flex-row md:items-start md:justify-between"
                      >
                        <div className="space-y-1 text-sm">
                          <div className="font-medium">{provider.label}</div>
                          <div className="text-muted-foreground">{provider.baseUrl}</div>
                          <div className="text-muted-foreground">
                            Models: {provider.modelIds.join(", ")}
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => removeProvider.mutate({ id: provider.id })}
                          disabled={removeProvider.isPending}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-3 border-t pt-6">
                  <div>
                    <h3 className="text-sm font-medium">Install a provider</h3>
                    <p className="text-sm text-muted-foreground">
                      Probe any OpenAI-compatible endpoint — LM Studio, vLLM, LocalAI, llama.cpp,
                      Jan, or a remote gateway — then install its exposed models.
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
                    <p className="text-sm text-destructive">
                      {(probeProvider.error as Error).message}
                    </p>
                  )}
                  {installProvider.isError && (
                    <p className="text-sm text-destructive">
                      {(installProvider.error as Error).message}
                    </p>
                  )}

                  {probeResult && (
                    <div className="rounded-lg border p-3 text-sm">
                      <div className="font-medium">{probeResult.providerLabel}</div>
                      <div className="text-muted-foreground">{probeResult.baseUrl}</div>
                      <div className="mt-2">Detected models: {probeResult.modelIds.join(", ")}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {section === "models" && (
              <div className="space-y-3">
                {availableModelsQuery.data?.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No models available yet. Start a local runtime or install a compatible endpoint.
                  </p>
                )}
                <ul className="space-y-2">
                  {availableModelsQuery.data?.map((model) => (
                    <li
                      key={model.id}
                      className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                    >
                      <span>{model.label}</span>
                      <span className="text-muted-foreground">
                        {model.kind} · {model.providerLabel}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
