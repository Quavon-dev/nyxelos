"use client";

import {
  type QueryClient,
  type UseMutationResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Bot,
  Eye,
  Image as ImageIcon,
  NotebookPen,
  Plug,
  Puzzle,
  Router,
  Search,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ModelParametersDialog } from "@/components/model-parameters-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  getExistingPushSubscription,
  pushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push-notifications";
import { getDefaultServerUrl, getServerUrl, setServerUrl } from "@/lib/server-url";
import {
  type AutonomyLevel,
  type ChatToolMode,
  type ChatToolPolicy,
  type CliProviderKind,
  DEFAULT_CHAT_TOOL_POLICY,
  type ModelCapabilities,
  type ModelInstallationClientSummary,
  type OpenRouterModel,
  type ProbedModelProvider,
  trpcClient,
} from "@/lib/trpc";
import { cn } from "@/lib/utils";

/** Small icon badges surfacing what a model can actually do — sourced live
 * from the provider (LM Studio's `/api/v0/models`, Ollama's `/api/show`,
 * OpenRouter's `/models` catalog), not guessed from the model id. */
function CapabilityBadges({ capabilities }: { capabilities?: ModelCapabilities }) {
  if (!capabilities) return null;
  const flags: {
    key: string;
    label: string;
    icon: typeof Eye;
    active: boolean;
    className: string;
  }[] = [
    {
      key: "vision",
      label: "Vision — reads images natively",
      icon: Eye,
      active: capabilities.nativeImageInput,
      className: "border-sky-500/30 bg-sky-500/10 text-sky-500",
    },
    {
      key: "tools",
      label: "Tool use — can call functions",
      icon: Wrench,
      active: capabilities.toolCalling,
      className: "border-amber-500/30 bg-amber-500/10 text-amber-500",
    },
    {
      key: "reasoning",
      label: "Reasoning — supports extended thinking",
      icon: Sparkles,
      active: capabilities.reasoning,
      className: "border-violet-500/30 bg-violet-500/10 text-violet-500",
    },
    {
      key: "image-out",
      label: "Image generation — can output images",
      icon: ImageIcon,
      active: capabilities.imageOutput,
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
    },
  ].filter((flag) => flag.active);
  if (flags.length === 0) return null;
  return (
    <span className="flex items-center gap-1">
      {flags.map(({ key, label, icon: Icon, className }) => (
        <Tooltip key={key}>
          <TooltipTrigger asChild>
            <span
              className={cn("flex size-5 items-center justify-center rounded border", className)}
            >
              <Icon className="size-3" />
            </span>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
    </span>
  );
}

const CHAT_MODES: { value: ChatToolMode; title: string; description: string }[] = [
  {
    value: "default",
    title: "Default",
    description: "Sensitive tools wait for approval and the assistant may ask before acting.",
  },
  {
    value: "automatic",
    title: "Automatic Tool Usage",
    description:
      "The assistant plans and gathers context on its own, then uses tools directly unless a guardrail still requires approval.",
  },
  {
    value: "auto",
    title: "AUTO",
    description:
      "Fully autonomous. Never asks clarifying or scoping questions — picks the best interpretation, gathers context with tools, and acts immediately. Only reports hard approval blocks.",
  },
];

const SECTIONS = [
  {
    id: "general",
    label: "General",
    icon: Settings2,
    color: "text-blue-500 bg-blue-500/10",
    description: "Name, icon, and defaults for new agents.",
  },
  {
    id: "instructions",
    label: "Instructions",
    icon: NotebookPen,
    color: "text-violet-500 bg-violet-500/10",
    description: "Prepended to every chat and task in this workspace.",
  },
  {
    id: "approvals",
    label: "Approvals",
    icon: ShieldCheck,
    color: "text-amber-500 bg-amber-500/10",
    description: "Default mode and guardrails for new chats.",
  },
  {
    id: "providers",
    label: "Model providers",
    icon: Plug,
    color: "text-emerald-500 bg-emerald-500/10",
    description: "Endpoints merged into the model picker.",
  },
  {
    id: "models",
    label: "Models",
    icon: Bot,
    color: "text-rose-500 bg-rose-500/10",
    description: "Everything available to chats and agents.",
  },
  {
    id: "connection",
    label: "Connection",
    icon: Smartphone,
    color: "text-sky-500 bg-sky-500/10",
    description: "Server URL and push notifications for this device.",
  },
  {
    id: "extensions",
    label: "Extensions",
    icon: Puzzle,
    color: "text-orange-500 bg-orange-500/10",
    description: "Optional marketplace features — installed ones appear in the sidebar.",
  },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

// Mirrors the grouped-sidebar look of the desktop settings modal (e.g.
// "Settings" vs "Desktop App") — only the groups that map to something
// real in this app, nothing invented.
const NAV_GROUPS: { label: string; sections: SectionId[] }[] = [
  { label: "Workspace", sections: ["general", "instructions", "approvals"] },
  { label: "Models", sections: ["providers", "models"] },
  { label: "Device", sections: ["connection"] },
  { label: "Extensions", sections: ["extensions"] },
];

const AUTONOMY_LEVELS: { value: AutonomyLevel; label: string }[] = [
  { value: "chat", label: "Chat — replies only, no tool calls" },
  { value: "assisted", label: "Assisted — tools, sensitive actions need approval" },
  { value: "autonomous", label: "Autonomous — runs tasks without stopping to ask" },
  { value: "super_agent", label: "Super-agent — can delegate to other agents" },
];

const CLI_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  connected: { label: "Connected", className: "bg-emerald-500/15 text-emerald-600" },
  needs_login: { label: "Needs login", className: "bg-amber-500/15 text-amber-600" },
  not_installed: { label: "Not installed", className: "bg-muted text-muted-foreground" },
  error: { label: "Error", className: "bg-destructive/15 text-destructive" },
};

/** One "local CLI provider" card — spawns `claude`/`codex` directly on the
 * server host instead of calling a hosted API with a stored key. Auth lives
 * in the CLI's own login state on that host (shared across every workspace
 * on this install), not per-workspace credentials. */
function CliProviderCard({
  workspaceId,
  kind,
  title,
  description,
  presets,
  allowApiKey,
  queryClient,
}: {
  workspaceId: string;
  kind: CliProviderKind;
  title: string;
  description: string;
  presets: string[];
  allowApiKey?: boolean;
  queryClient: QueryClient;
}) {
  const [loginExecId, setLoginExecId] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [label, setLabel] = useState(title);
  const [selectedModels, setSelectedModels] = useState<string[]>(presets.slice(0, 1));
  const [customModel, setCustomModel] = useState("");

  const statusQuery = useQuery({
    queryKey: ["models", "cliStatus", kind],
    queryFn: () => trpcClient.models.cliStatus.query({ providerKind: kind }),
  });

  const loginOutputQuery = useQuery({
    queryKey: ["models", "cliLoginOutput", loginExecId],
    queryFn: () => trpcClient.models.cliLoginOutput.query({ execId: loginExecId as string }),
    enabled: loginExecId !== null,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 1500 : false),
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run when the CLI login process's status changes, not on every statusQuery.refetch identity change (that would refire on every statusQuery re-render).
  useEffect(() => {
    if (loginOutputQuery.data?.status === "exited") statusQuery.refetch();
  }, [loginOutputQuery.data?.status]);

  const startLogin = useMutation({
    mutationFn: (apiKey?: string) =>
      trpcClient.models.cliLoginStart.mutate({ providerKind: kind, apiKey }),
    onSuccess: (result) => setLoginExecId(result.execId),
  });

  const install = useMutation({
    mutationFn: () => {
      const modelIds = [...selectedModels, ...(customModel.trim() ? [customModel.trim()] : [])];
      return trpcClient.models.installCli.mutate({
        workspaceId,
        providerKind: kind,
        label: label.trim() || title,
        modelIds,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models", "installations", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["models", "list", workspaceId] });
      setCustomModel("");
    },
  });

  const status = statusQuery.data?.status;
  const badge = status ? CLI_STATUS_BADGE[status] : null;

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium">{title}</h4>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {badge && <Badge className={badge.className}>{badge.label}</Badge>}
      </div>

      <p className="text-xs text-muted-foreground">
        Uses its own tools — workspace skills &amp; MCP aren&apos;t used.
      </p>

      {status && status !== "not_installed" && status !== "connected" && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => startLogin.mutate(undefined)}
            disabled={startLogin.isPending}
          >
            {kind === "codex_cli" ? "Sign in with ChatGPT" : "Connect"}
          </Button>
          {allowApiKey && (
            <>
              <Input
                placeholder="API key"
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="h-8 w-40"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => startLogin.mutate(apiKeyInput.trim() || undefined)}
                disabled={startLogin.isPending || !apiKeyInput.trim()}
              >
                Use API key
              </Button>
            </>
          )}
        </div>
      )}

      {status === "not_installed" && (
        <p className="text-xs text-destructive">
          {kind === "claude_cli" ? "claude" : "codex"} isn&apos;t installed (or not on PATH) on the
          server host.
        </p>
      )}

      {loginExecId && loginOutputQuery.data && (
        <div className="space-y-2 rounded-md border bg-muted/40 p-2">
          {loginOutputQuery.data.url && (
            <a
              href={loginOutputQuery.data.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-primary underline"
            >
              Open sign-in page →
            </a>
          )}
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
            {loginOutputQuery.data.output || "Waiting for output…"}
          </pre>
          {loginOutputQuery.data.status === "exited" && (
            <p className="text-xs">
              {loginOutputQuery.data.exitCode === 0
                ? "Login finished."
                : `Exited with code ${loginOutputQuery.data.exitCode}.`}
            </p>
          )}
        </div>
      )}

      {status === "connected" && (
        <div className="space-y-2 border-t pt-3">
          <Input
            placeholder="Label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="h-8"
          />
          <div className="flex flex-wrap gap-3">
            {presets.map((preset) => {
              const inputId = `${kind}-preset-${preset}`;
              return (
                <label key={preset} htmlFor={inputId} className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    id={inputId}
                    checked={selectedModels.includes(preset)}
                    onCheckedChange={(checked) =>
                      setSelectedModels((current) =>
                        checked ? [...current, preset] : current.filter((m) => m !== preset),
                      )
                    }
                  />
                  {preset === "default" ? "Default (CLI's own configured model)" : preset}
                </label>
              );
            })}
          </div>
          <Input
            placeholder="Custom model id (optional)"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            className="h-8"
          />
          <Button
            size="sm"
            onClick={() => install.mutate()}
            disabled={install.isPending || (selectedModels.length === 0 && !customModel.trim())}
          >
            {install.isPending ? "Adding…" : "Add to workspace"}
          </Button>
          {install.isError && (
            <p className="text-xs text-destructive">{(install.error as Error).message}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** One "already installed" provider card. The "add model" field autofills
 * from the provider's live catalog (models.listCatalogForInstallation) via a
 * native <datalist> — known providers (OpenAI, Anthropic, OpenRouter, any
 * OpenAI-compatible endpoint with a reachable `/v1/models`) get real
 * suggestions; providers with no catalog endpoint (CLI providers) just get a
 * free-text field, same as before. The server re-validates against that same
 * catalog on submit either way, so a typo or unavailable id is rejected even
 * if the user ignores the suggestions. */
function InstalledProviderCard({
  provider,
  modelCapabilitiesByLabel,
  setModelEnabled,
  removeModel,
  removeProvider,
  invalidateModelQueries,
}: {
  provider: ModelInstallationClientSummary;
  modelCapabilitiesByLabel: Map<string, ModelCapabilities | undefined>;
  setModelEnabled: UseMutationResult<
    ModelInstallationClientSummary,
    Error,
    { id: string; modelId: string; enabled: boolean }
  >;
  removeModel: UseMutationResult<
    ModelInstallationClientSummary | null,
    Error,
    { id: string; modelId: string }
  >;
  removeProvider: UseMutationResult<void, Error, { id: string }>;
  invalidateModelQueries: () => void;
}) {
  const [newModelId, setNewModelId] = useState("");
  const [configuringModelId, setConfiguringModelId] = useState<string | null>(null);
  const datalistId = `model-catalog-${provider.id}`;

  const catalogQuery = useQuery({
    queryKey: ["models", "catalog", provider.id],
    queryFn: () => trpcClient.models.listCatalogForInstallation.query({ id: provider.id }),
    staleTime: 60_000,
  });
  const suggestions = (catalogQuery.data ?? []).filter((id) => !provider.modelIds.includes(id));

  // Local (not shared across rows) so one row's pending/error state can't
  // bleed into every other installed provider's card.
  const addModel = useMutation({
    mutationFn: (input: { id: string; modelId: string }) =>
      trpcClient.models.addModelToInstallation.mutate(input),
    onSuccess: () => {
      invalidateModelQueries();
      setNewModelId("");
    },
  });

  const submit = () => {
    const modelId = newModelId.trim();
    if (!modelId) return;
    addModel.mutate({ id: provider.id, modelId });
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border-l-2 border-l-emerald-500 border-y border-r p-3 md:flex-row md:items-start md:justify-between">
      <div className="w-full space-y-1 text-sm">
        <div className="font-medium">{provider.label}</div>
        <div className="text-muted-foreground">{provider.baseUrl}</div>
        <div className="flex flex-col gap-1 pt-1">
          {provider.modelIds.map((modelId) => {
            const isEnabled = !provider.disabledModelIds.includes(modelId);
            const capabilities = modelCapabilitiesByLabel.get(`${modelId} (${provider.label})`);
            return (
              <div key={modelId} className="flex items-center gap-2 rounded-md border px-2 py-1">
                <Switch
                  checked={isEnabled}
                  onCheckedChange={(checked) =>
                    setModelEnabled.mutate({ id: provider.id, modelId, enabled: checked })
                  }
                />
                <span className={cn("text-xs", !isEnabled && "text-muted-foreground line-through")}>
                  {modelId}
                </span>
                <CapabilityBadges capabilities={capabilities} />
                <div className="ml-auto flex items-center gap-2.5">
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setConfiguringModelId(modelId)}
                    aria-label={`Configure ${modelId}`}
                  >
                    <Settings2 className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => removeModel.mutate({ id: provider.id, modelId })}
                    disabled={removeModel.isPending}
                    aria-label={`Remove ${modelId}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {configuringModelId && (
          <ModelParametersDialog
            workspaceId={provider.workspaceId}
            modelId={`custom:${provider.id}/${configuringModelId}`}
            modelLabel={`${configuringModelId} (${provider.label})`}
            open={configuringModelId !== null}
            onOpenChange={(open) => {
              if (!open) setConfiguringModelId(null);
            }}
          />
        )}
        <div className="flex items-center gap-2 pt-1">
          <Input
            list={suggestions.length > 0 ? datalistId : undefined}
            placeholder="Add model id (e.g. gpt-5.5)"
            value={newModelId}
            onChange={(e) => setNewModelId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            className="h-8 text-xs"
          />
          {suggestions.length > 0 && (
            <datalist id={datalistId}>
              {suggestions.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0"
            onClick={submit}
            disabled={addModel.isPending || !newModelId.trim()}
          >
            Add
          </Button>
        </div>
        {addModel.isError && (
          <p className="text-xs text-destructive">{(addModel.error as Error).message}</p>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => removeProvider.mutate({ id: provider.id })}
        disabled={removeProvider.isPending}
      >
        Remove all
      </Button>
    </div>
  );
}

/** OpenRouter card — enter an API key, fetch its full model catalog directly
 * from OpenRouter, then import all (or a hand-picked subset) as one workspace
 * provider installation. The catalog fetch itself needs no key (OpenRouter's
 * `/models` list is public); the key is only required to actually install,
 * since that's what generation calls will authenticate with. */
function OpenRouterProviderCard({
  workspaceId,
  queryClient,
}: {
  workspaceId: string;
  queryClient: QueryClient;
}) {
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("OpenRouter");
  const [models, setModels] = useState<OpenRouterModel[] | null>(null);
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());

  const fetchModels = useMutation({
    mutationFn: () =>
      trpcClient.models.listOpenRouterModels.query({ apiKey: apiKey.trim() || undefined }),
    onSuccess: (result) => {
      setModels(result);
      setSelectedModelIds(new Set(result.map((model) => model.id)));
    },
  });

  const install = useMutation({
    mutationFn: () =>
      trpcClient.models.installOpenRouter.mutate({
        workspaceId,
        label: label.trim() || "OpenRouter",
        apiKey: apiKey.trim(),
        modelIds: Array.from(selectedModelIds),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models", "installations", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["models", "list", workspaceId] });
      setModels(null);
      setSelectedModelIds(new Set());
      setApiKey("");
    },
  });

  function toggleModel(id: string, checked: boolean) {
    setSelectedModelIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium">OpenRouter</h4>
          <p className="text-xs text-muted-foreground">
            One API key, hundreds of models from every major lab.
          </p>
        </div>
        <Badge variant="secondary" className="text-[10px]">
          openrouter.ai
        </Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Input
          placeholder="Label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="h-8"
        />
        <Input
          placeholder="OpenRouter API key (sk-or-...)"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="h-8"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchModels.mutate()}
          disabled={fetchModels.isPending}
        >
          {fetchModels.isPending ? "Fetching…" : "Fetch models"}
        </Button>
        {models && models.length > 0 && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedModelIds(new Set(models.map((m) => m.id)))}
            >
              Select all
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedModelIds(new Set())}>
              Select none
            </Button>
            <span className="text-xs text-muted-foreground">
              {selectedModelIds.size} of {models.length} selected
            </span>
          </>
        )}
      </div>

      {fetchModels.isError && (
        <p className="text-xs text-destructive">{(fetchModels.error as Error).message}</p>
      )}

      {models && models.length === 0 && (
        <p className="text-xs text-destructive">
          No models returned — OpenRouter may be unreachable, or the API key is invalid.
        </p>
      )}

      {models && models.length > 0 && (
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
          {models.map((model) => {
            const inputId = `openrouter-model-${model.id}`;
            return (
              <label
                key={model.id}
                htmlFor={inputId}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-muted/60"
              >
                <Checkbox
                  id={inputId}
                  checked={selectedModelIds.has(model.id)}
                  onCheckedChange={(checked) => toggleModel(model.id, checked === true)}
                />
                <span className="min-w-0 flex-1 truncate">{model.label}</span>
                <span className="shrink-0 text-muted-foreground">{model.id}</span>
              </label>
            );
          })}
        </div>
      )}

      <Button
        size="sm"
        onClick={() => install.mutate()}
        disabled={
          install.isPending ||
          !apiKey.trim() ||
          !models ||
          models.length === 0 ||
          selectedModelIds.size === 0
        }
      >
        {install.isPending
          ? "Importing…"
          : `Import ${selectedModelIds.size || ""} model${selectedModelIds.size === 1 ? "" : "s"}`.trim()}
      </Button>
      {install.isError && (
        <p className="text-xs text-destructive">{(install.error as Error).message}</p>
      )}
    </div>
  );
}

/**
 * Shared settings body — nav + content — reused by the full-page route and
 * the quick-access modal (sidebar gear icon). Same data, same mutations,
 * just a different frame around it.
 */
export function WorkspaceSettingsPanel({
  workspaceId,
  className,
}: {
  workspaceId: string;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<SectionId>("general");
  const [query, setQuery] = useState("");

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
  // Keyed by label, not id: an installed provider that collides with an
  // auto-detected local runtime (e.g. LM Studio on its default port) gets
  // deduped out of models.list by id, but survives under the same label —
  // see the "first occurrence wins" comment in listAvailableModels().
  const modelCapabilitiesByLabel = useMemo(
    () => new Map(availableModelsQuery.data?.map((m) => [m.label, m.capabilities]) ?? []),
    [availableModelsQuery.data],
  );
  const extensionCatalogQuery = useQuery({
    queryKey: ["extensions", "catalog"],
    queryFn: () => trpcClient.extensions.catalog.query(),
  });
  const installedExtensionsQuery = useQuery({
    queryKey: ["extensions", "list", workspaceId],
    queryFn: () => trpcClient.extensions.list.query({ workspaceId }),
  });
  const invalidateExtensions = () => {
    queryClient.invalidateQueries({ queryKey: ["extensions", "list", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["plugins", "list", workspaceId] });
  };
  const installExtension = useMutation({
    mutationFn: (key: string) => trpcClient.extensions.install.mutate({ workspaceId, key }),
    onSuccess: invalidateExtensions,
  });
  const setExtensionEnabled = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      trpcClient.extensions.setEnabled.mutate(input),
    onSuccess: invalidateExtensions,
  });
  const uninstallExtension = useMutation({
    mutationFn: (id: string) => trpcClient.extensions.uninstall.mutate({ id }),
    onSuccess: invalidateExtensions,
  });

  const [instructions, setInstructions] = useState("");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [color, setColor] = useState("");
  const [defaultModelId, setDefaultModelId] = useState("");
  const [defaultAutonomyLevel, setDefaultAutonomyLevel] = useState<AutonomyLevel>("assisted");
  const [defaultToolPolicy, setDefaultToolPolicy] =
    useState<ChatToolPolicy>(DEFAULT_CHAT_TOOL_POLICY);
  const [providerLabel, setProviderLabel] = useState("");
  const [providerBaseUrl, setProviderBaseUrl] = useState("http://localhost:1234");
  const [providerApiKey, setProviderApiKey] = useState("");
  const [probeResult, setProbeResult] = useState<ProbedModelProvider | null>(null);

  const installationQuery = useQuery({
    queryKey: ["installation", "status"],
    queryFn: () => trpcClient.installation.status.query(),
  });
  const [serverUrlInput, setServerUrlInput] = useState("");
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    setServerUrlInput(getServerUrl());
    getExistingPushSubscription().then((sub) => setPushSubscribed(Boolean(sub)));
  }, []);

  useEffect(() => {
    if (!workspaceQuery.data) return;
    setInstructions(workspaceQuery.data.customInstructions ?? "");
    setName(workspaceQuery.data.name);
    setIcon(workspaceQuery.data.icon ?? "");
    setColor(workspaceQuery.data.color ?? "");
    setDefaultModelId(workspaceQuery.data.defaultModelId ?? "");
    setDefaultAutonomyLevel(workspaceQuery.data.defaultAutonomyLevel);
    setDefaultToolPolicy(workspaceQuery.data.defaultToolPolicy);
  }, [workspaceQuery.data]);

  const saveInstructions = useMutation({
    mutationFn: () =>
      trpcClient.workspaces.updateSettings.mutate({
        workspaceId,
        customInstructions: instructions.trim() === "" ? null : instructions,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
    },
  });

  const saveGeneral = useMutation({
    mutationFn: () =>
      trpcClient.workspaces.updateSettings.mutate({
        workspaceId,
        name: name.trim() || undefined,
        icon: icon.trim() === "" ? null : icon.trim(),
        color: color.trim() === "" ? null : color.trim(),
        defaultModelId: defaultModelId === "" ? null : defaultModelId,
        defaultAutonomyLevel,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
    },
  });

  const saveApprovals = useMutation({
    mutationFn: () =>
      trpcClient.workspaces.updateSettings.mutate({
        workspaceId,
        defaultToolPolicy,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
    },
  });

  function selectChatMode(modeValue: ChatToolMode) {
    setDefaultToolPolicy((current) =>
      modeValue === "auto"
        ? {
            mode: "auto",
            approveFileWrites: false,
            approveFileDeletes: false,
            approveCustomCode: false,
            approveMcpTools: false,
          }
        : { ...current, mode: modeValue },
    );
  }

  const guardrailsLocked =
    defaultToolPolicy.mode === "default" || defaultToolPolicy.mode === "auto";

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

  const invalidateModelQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["models", "installations", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["models", "list", workspaceId] });
  };

  const setModelEnabled = useMutation({
    mutationFn: (input: { id: string; modelId: string; enabled: boolean }) =>
      trpcClient.models.setModelEnabled.mutate(input),
    onSuccess: invalidateModelQueries,
  });

  const removeModel = useMutation({
    mutationFn: (input: { id: string; modelId: string }) =>
      trpcClient.models.removeModelFromInstallation.mutate(input),
    onSuccess: invalidateModelQueries,
  });

  const activeSection = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return SECTIONS.filter(
      (s) => s.label.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-6 sm:flex-row", className)}>
      <div className="flex w-full shrink-0 flex-col gap-4 sm:w-56">
        <div className="relative">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search settings"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 pl-8"
          />
        </div>

        <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {filteredSections ? (
            filteredSections.length === 0 ? (
              <p className="px-3 text-xs text-muted-foreground">No matching settings.</p>
            ) : (
              <div className="space-y-1">
                {filteredSections.map((item) => (
                  <SectionButton
                    key={item.id}
                    item={item}
                    isActive={item.id === section}
                    onClick={() => setSection(item.id)}
                  />
                ))}
              </div>
            )
          ) : (
            NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="px-3 pb-1 text-xs font-medium text-muted-foreground uppercase">
                  {group.label}
                </p>
                <div className="space-y-1">
                  {group.sections.map((id) => {
                    const item = SECTIONS.find((s) => s.id === id);
                    if (!item) return null;
                    return (
                      <SectionButton
                        key={item.id}
                        item={item}
                        isActive={item.id === section}
                        onClick={() => setSection(item.id)}
                      />
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </nav>
      </div>

      <div className="min-h-0 min-w-0 flex-1 space-y-6 overflow-y-auto">
        <div className="flex items-center gap-3 border-b pb-4">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg",
              activeSection.color,
            )}
          >
            <activeSection.icon className="size-4.5" />
          </span>
          <div className="space-y-0.5">
            <h2 className="text-lg font-semibold">{activeSection.label}</h2>
            <p className="text-sm text-muted-foreground">{activeSection.description}</p>
          </div>
        </div>

        {section === "general" && (
          <div className="space-y-6">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="workspace-name">
                  Name
                </label>
                <Input
                  id="workspace-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={workspaceQuery.isLoading}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="workspace-icon">
                    Icon (emoji)
                  </label>
                  <Input
                    id="workspace-icon"
                    placeholder="🚀"
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                    disabled={workspaceQuery.isLoading}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="workspace-color">
                    Accent color
                  </label>
                  <Input
                    id="workspace-color"
                    type="color"
                    value={color || "#6366f1"}
                    onChange={(e) => setColor(e.target.value)}
                    disabled={workspaceQuery.isLoading}
                    className="h-9 p-1"
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-3 border-t pt-6 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="workspace-default-model">
                  Default model for new chats
                </label>
                <select
                  id="workspace-default-model"
                  value={defaultModelId}
                  onChange={(e) => setDefaultModelId(e.target.value)}
                  disabled={workspaceQuery.isLoading}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none"
                >
                  <option value="">No default — ask every time</option>
                  {availableModelsQuery.data?.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="workspace-default-autonomy">
                  Default autonomy for new agents
                </label>
                <select
                  id="workspace-default-autonomy"
                  value={defaultAutonomyLevel}
                  onChange={(e) => setDefaultAutonomyLevel(e.target.value as AutonomyLevel)}
                  disabled={workspaceQuery.isLoading}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none"
                >
                  {AUTONOMY_LEVELS.map((level) => (
                    <option key={level.value} value={level.value}>
                      {level.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={() => saveGeneral.mutate()}
                disabled={saveGeneral.isPending || workspaceQuery.isLoading}
              >
                {saveGeneral.isPending ? "Saving…" : "Save"}
              </Button>
              {saveGeneral.isSuccess && (
                <span className="text-sm text-muted-foreground">Saved.</span>
              )}
            </div>
          </div>
        )}

        {section === "approvals" && (
          <div className="space-y-6">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Mode</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {CHAT_MODES.map((option) => {
                  const selected = defaultToolPolicy.mode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      title={option.description}
                      onClick={() => selectChatMode(option.value)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                        selected ? "border-primary bg-primary/10" : "hover:bg-muted/60",
                      )}
                    >
                      <div className="font-medium">{option.title}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {option.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3 border-t pt-6">
              <div className="space-y-1">
                <p className="text-sm font-medium">Approval guardrails</p>
                {defaultToolPolicy.mode === "auto" ? (
                  <p className="text-xs text-muted-foreground">
                    All guardrails are disabled in AUTO mode — the agent executes every tool call
                    directly. Switch to <strong>Automatic Tool Usage</strong> to enable individual
                    approval controls.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Default mode always approves every sensitive action first. In Automatic Tool
                    Usage, these switches decide what still goes through Approvals.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">Approve file writes</p>
                    <p className="text-xs text-muted-foreground">
                      Creating or editing files still waits for approval.
                    </p>
                  </div>
                  <Switch
                    checked={defaultToolPolicy.approveFileWrites}
                    disabled={guardrailsLocked}
                    onCheckedChange={(checked) =>
                      setDefaultToolPolicy((current) => ({
                        ...current,
                        approveFileWrites: checked,
                      }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">Approve file deletions</p>
                    <p className="text-xs text-muted-foreground">
                      Deleting files still waits for approval.
                    </p>
                  </div>
                  <Switch
                    checked={defaultToolPolicy.approveFileDeletes}
                    disabled={guardrailsLocked}
                    onCheckedChange={(checked) =>
                      setDefaultToolPolicy((current) => ({
                        ...current,
                        approveFileDeletes: checked,
                      }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">Approve custom code</p>
                    <p className="text-xs text-muted-foreground">
                      Custom-code skills still wait for approval.
                    </p>
                  </div>
                  <Switch
                    checked={defaultToolPolicy.approveCustomCode}
                    disabled={guardrailsLocked}
                    onCheckedChange={(checked) =>
                      setDefaultToolPolicy((current) => ({
                        ...current,
                        approveCustomCode: checked,
                      }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">Approve MCP tools</p>
                    <p className="text-xs text-muted-foreground">
                      Third-party MCP tool calls still wait for approval.
                    </p>
                  </div>
                  <Switch
                    checked={defaultToolPolicy.approveMcpTools}
                    disabled={guardrailsLocked}
                    onCheckedChange={(checked) =>
                      setDefaultToolPolicy((current) => ({
                        ...current,
                        approveMcpTools: checked,
                      }))
                    }
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={() => saveApprovals.mutate()}
                disabled={saveApprovals.isPending || workspaceQuery.isLoading}
              >
                {saveApprovals.isPending ? "Saving…" : "Save"}
              </Button>
              {saveApprovals.isSuccess && (
                <span className="text-sm text-muted-foreground">Saved.</span>
              )}
            </div>
          </div>
        )}

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
                <p className="text-sm text-muted-foreground">No custom providers installed yet.</p>
              )}
              <div className="space-y-3">
                {installedProvidersQuery.data?.map((provider) => (
                  <InstalledProviderCard
                    key={provider.id}
                    provider={provider}
                    modelCapabilitiesByLabel={modelCapabilitiesByLabel}
                    setModelEnabled={setModelEnabled}
                    removeModel={removeModel}
                    removeProvider={removeProvider}
                    invalidateModelQueries={invalidateModelQueries}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-3 border-t pt-6">
              <div>
                <h3 className="text-sm font-medium">Local CLI providers</h3>
                <p className="text-sm text-muted-foreground">
                  Runs <code>claude</code>/<code>codex</code> on this host — no API key stored.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <CliProviderCard
                  workspaceId={workspaceId}
                  kind="claude_cli"
                  title="Claude CLI"
                  description="Sign in once, use Claude models directly."
                  presets={[
                    "default",
                    "claude-fable-5",
                    "claude-opus-4-8",
                    "claude-opus-4-7",
                    "claude-opus-4-6",
                    "claude-sonnet-5",
                    "claude-sonnet-4-6",
                    "claude-haiku-4-5",
                  ]}
                  queryClient={queryClient}
                />
                <CliProviderCard
                  workspaceId={workspaceId}
                  kind="codex_cli"
                  title="Codex CLI"
                  description="Sign in with ChatGPT, or use an API key."
                  presets={["default"]}
                  allowApiKey
                  queryClient={queryClient}
                />
              </div>
            </div>

            <div className="space-y-3 border-t pt-6">
              <div className="flex items-center gap-2">
                <Router className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">Cloud aggregators</h3>
              </div>
              <OpenRouterProviderCard workspaceId={workspaceId} queryClient={queryClient} />
            </div>

            <div className="space-y-3 border-t pt-6">
              <div>
                <h3 className="text-sm font-medium">Install a provider</h3>
                <p className="text-sm text-muted-foreground">
                  Probe any OpenAI-compatible endpoint, then install its models.
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

        {section === "connection" && (
          <div className="space-y-6">
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Server URL</h3>
              <p className="text-sm text-muted-foreground">
                Point this device at a different Nyxel server — a LAN IP at home, a Tailscale/ ngrok
                tunnel, or a custom domain. Only affects this browser; other devices keep their own
                setting.
              </p>
              <div className="flex flex-wrap gap-3">
                <Input
                  placeholder={getDefaultServerUrl()}
                  value={serverUrlInput}
                  onChange={(e) => setServerUrlInput(e.target.value)}
                  className="max-w-sm"
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    setServerUrl(serverUrlInput);
                    window.location.reload();
                  }}
                >
                  Save &amp; reload
                </Button>
              </div>
            </div>

            <div className="space-y-3 border-t pt-6">
              <h3 className="text-sm font-medium">Push notifications</h3>
              <p className="text-sm text-muted-foreground">
                Get notified on this device — even with the app closed — when an agent needs
                approval, finishes a task, or an automation fails.
              </p>
              {!pushSupported() ? (
                <p className="text-sm text-muted-foreground">
                  This browser doesn&apos;t support push notifications.
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Badge className={pushSubscribed ? "bg-emerald-500/15 text-emerald-600" : ""}>
                    {pushSubscribed ? "Enabled on this device" : "Not enabled"}
                  </Badge>
                  <Button
                    size="sm"
                    disabled={pushBusy || !installationQuery.data?.record?.ownerUserId}
                    onClick={async () => {
                      const userId = installationQuery.data?.record?.ownerUserId;
                      if (!userId) return;
                      setPushBusy(true);
                      setPushError(null);
                      try {
                        if (pushSubscribed) {
                          await unsubscribeFromPush();
                          setPushSubscribed(false);
                        } else {
                          await subscribeToPush(userId);
                          setPushSubscribed(true);
                        }
                      } catch (error) {
                        setPushError((error as Error).message);
                      } finally {
                        setPushBusy(false);
                      }
                    }}
                  >
                    {pushBusy ? "Working…" : pushSubscribed ? "Disable" : "Enable notifications"}
                  </Button>
                  {pushError && <span className="text-sm text-destructive">{pushError}</span>}
                </div>
              )}
            </div>
          </div>
        )}

        {section === "extensions" && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h3 className="text-sm font-medium">Marketplace</h3>
              <p className="text-sm text-muted-foreground">
                Optional NyxelOS features. Installing one adds it to the sidebar outside the normal
                workspace navigation.
              </p>
            </div>
            {extensionCatalogQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {(extensionCatalogQuery.data ?? []).map((entry) => {
                  const installed = installedExtensionsQuery.data?.find((e) => e.key === entry.key);
                  return (
                    <div key={entry.key} className="space-y-3 rounded-lg border p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <p className="text-sm font-medium">{entry.name}</p>
                          <Badge variant="secondary" className="text-[10px]">
                            {entry.category}
                          </Badge>
                        </div>
                        {installed && (
                          <Switch
                            checked={installed.enabled}
                            onCheckedChange={(checked) =>
                              setExtensionEnabled.mutate({ id: installed.id, enabled: checked })
                            }
                          />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{entry.description}</p>
                      {entry.pluginRepoUrl && !installed && (
                        <p className="text-xs text-muted-foreground">
                          Installing this also pulls in its companion plugin (skills + specialist
                          agents) from{" "}
                          <span className="text-foreground">
                            {entry.pluginRepoUrl.replace("https://github.com/", "")}
                          </span>
                          .
                        </p>
                      )}
                      <div className="flex gap-2">
                        {installed ? (
                          <>
                            <Button size="sm" variant="outline" asChild>
                              <Link href={`/workspace/${workspaceId}/extensions/${entry.route}`}>
                                Open
                              </Link>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              disabled={uninstallExtension.isPending}
                              onClick={() => uninstallExtension.mutate(installed.id)}
                            >
                              Uninstall
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            disabled={installExtension.isPending}
                            onClick={() => installExtension.mutate(entry.key)}
                          >
                            {installExtension.isPending && installExtension.variables === entry.key
                              ? "Installing…"
                              : "Install"}
                          </Button>
                        )}
                      </div>
                      {installExtension.isSuccess &&
                        installExtension.variables === entry.key &&
                        installExtension.data.pluginInstall && (
                          <p
                            className={
                              installExtension.data.pluginInstall.status === "failed"
                                ? "text-xs text-destructive"
                                : "text-xs text-emerald-600"
                            }
                          >
                            {installExtension.data.pluginInstall.status === "installed" &&
                              `Plugin installed — ${installExtension.data.pluginInstall.skillCount ?? 0} skill(s), ${installExtension.data.pluginInstall.agentCount ?? 0} specialist agent(s) now available.`}
                            {installExtension.data.pluginInstall.status === "already_installed" &&
                              "Companion plugin was already installed."}
                            {installExtension.data.pluginInstall.status === "failed" &&
                              `Companion plugin install failed: ${installExtension.data.pluginInstall.error}. You can retry from the Plugins page.`}
                          </p>
                        )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionButton({
  item,
  isActive,
  onClick,
}: {
  item: (typeof SECTIONS)[number];
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
        isActive
          ? "bg-muted font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <span
        className={cn("flex size-6 shrink-0 items-center justify-center rounded-md", item.color)}
      >
        <item.icon className="size-3.5" />
      </span>
      {item.label}
    </button>
  );
}
