"use client";

import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, NotebookPen, Plug, Search, Settings2, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  type AutonomyLevel,
  type ChatToolMode,
  type ChatToolPolicy,
  type CliProviderKind,
  DEFAULT_CHAT_TOOL_POLICY,
  type ProbedModelProvider,
  trpcClient,
} from "@/lib/trpc";
import { cn } from "@/lib/utils";

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
    description: "Workspace name, icon, accent color, and defaults for new agents.",
  },
  {
    id: "instructions",
    label: "Instructions",
    icon: NotebookPen,
    description:
      "Always prepended as a system-prompt block before every chat and task in this workspace.",
  },
  {
    id: "approvals",
    label: "Approvals",
    icon: ShieldCheck,
    description: "Default mode and guardrails applied to every new chat in this workspace.",
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

// Mirrors the grouped-sidebar look of the desktop settings modal (e.g.
// "Einstellungen" vs "Desktop-App") — only the groups that map to something
// real in this app, nothing invented.
const NAV_GROUPS: { label: string; sections: SectionId[] }[] = [
  { label: "Workspace", sections: ["general", "instructions", "approvals"] },
  { label: "Models", sections: ["providers", "models"] },
];

const AUTONOMY_LEVELS: { value: AutonomyLevel; label: string }[] = [
  { value: "chat", label: "Chat — replies only, no tool calls" },
  { value: "assisted", label: "Assisted — tools, sensitive actions need approval" },
  { value: "autonomous", label: "Autonomous — runs tasks without stopping to ask" },
  { value: "super_agent", label: "Super-agent — can delegate to other agents" },
];

const CLI_STATUS_BADGE: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  connected: { label: "Connected", variant: "default" },
  needs_login: { label: "Needs login", variant: "secondary" },
  not_installed: { label: "Not installed", variant: "outline" },
  error: { label: "Error", variant: "destructive" },
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

  useEffect(() => {
    if (loginOutputQuery.data?.status === "exited") statusQuery.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
      </div>

      <p className="text-xs text-muted-foreground">
        Runs with its own built-in file/shell tools in this chat&apos;s working directory —
        workspace skills and MCP tools aren&apos;t used when this model is selected.
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
          {kind === "claude_cli" ? "claude" : "codex"} isn&apos;t installed (or not on PATH) on
          the server host.
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
            {presets.map((preset) => (
              <label key={preset} className="flex items-center gap-1.5 text-xs">
                <Checkbox
                  checked={selectedModels.includes(preset)}
                  onCheckedChange={(checked) =>
                    setSelectedModels((current) =>
                      checked ? [...current, preset] : current.filter((m) => m !== preset),
                    )
                  }
                />
                {preset}
              </label>
            ))}
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
        <div className="space-y-1 border-b pb-4">
          <h2 className="text-lg font-semibold">{activeSection.label}</h2>
          <p className="text-sm text-muted-foreground">{activeSection.description}</p>
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
                <h3 className="text-sm font-medium">Local CLI providers</h3>
                <p className="text-sm text-muted-foreground">
                  Spawn <code>claude</code>/<code>codex</code> directly on the server host — no
                  API key stored, auth lives in the CLI&apos;s own login on this machine.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <CliProviderCard
                  workspaceId={workspaceId}
                  kind="claude_cli"
                  title="Claude CLI"
                  description="Sign in once with `claude login`, then use Claude models directly — no API key."
                  presets={["claude-sonnet-5", "claude-opus-4-8"]}
                  queryClient={queryClient}
                />
                <CliProviderCard
                  workspaceId={workspaceId}
                  kind="codex_cli"
                  title="Codex CLI"
                  description="Sign in with your ChatGPT (OpenAI) account, or use an API key — no key stored either way unless you choose the API-key option."
                  presets={["gpt-5-codex", "o4-mini"]}
                  allowApiKey
                  queryClient={queryClient}
                />
              </div>
            </div>

            <div className="space-y-3 border-t pt-6">
              <div>
                <h3 className="text-sm font-medium">Install a provider</h3>
                <p className="text-sm text-muted-foreground">
                  Probe any OpenAI-compatible endpoint — LM Studio, vLLM, LocalAI, llama.cpp, Jan,
                  or a remote gateway — then install its exposed models.
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
}
