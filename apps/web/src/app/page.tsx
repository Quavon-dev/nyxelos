"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Blocks,
  Bot,
  BrainCircuit,
  CheckSquare,
  ClipboardCheck,
  Clock,
  Code2,
  Database,
  DollarSign,
  FileCode,
  Gauge,
  Globe,
  Layers,
  Library,
  MessageSquare,
  Plug,
  ShieldCheck,
  Sparkles,
  Timer,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  XAxis,
  YAxis,
} from "recharts";
import { BrandMark } from "@/components/brand-mark";
import { CardListSkeleton, Spinner, StatCardsSkeleton } from "@/components/loading";
import { PageHeader, StatCard } from "@/components/page-header";
import { SystemScreen } from "@/components/system-screen";
import { authClient } from "@/lib/auth-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type AgentRunStatusStat,
  type AuditLogSummary,
  type AuditStatus,
  type InstallationMode,
  type ModelUsageStat,
  type ToolUsageStat,
  trpcClient,
} from "@/lib/trpc";

const AUDIT_STATUS_LABEL: Record<AuditStatus, string> = {
  success: "Success",
  error: "Error",
  pending_approval: "Pending approval",
  rejected: "Rejected",
};

const AUDIT_STATUS_BADGE: Record<AuditStatus, string> = {
  success: "border-0 bg-green-500/15 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  error: "border-0 bg-rose-500/15 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",
  pending_approval:
    "border-0 bg-amber-500/15 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  rejected: "border-0 bg-muted text-muted-foreground",
};

const OPEN_TASK_STATUSES = new Set([
  "pending",
  "planning",
  "ready",
  "running",
  "blocked",
  "waiting_approval",
]);

const QUICK_LINKS = [
  {
    label: "Agents",
    description: "Saved model + tool configurations.",
    icon: Bot,
    path: "agents",
  },
  {
    label: "Tasks",
    description: "Multi-step work handed to an agent.",
    icon: CheckSquare,
    path: "tasks",
  },
  {
    label: "Skills",
    description: "File-based capabilities agents can call.",
    icon: Blocks,
    path: "skills",
  },
  {
    label: "Tools",
    description: "Workspace-configurable tool catalog.",
    icon: Wrench,
    path: "tools",
  },
  {
    label: "Connectors",
    description: "MCP servers wired into this workspace.",
    icon: Plug,
    path: "mcp-servers",
  },
  {
    label: "Automations",
    description: "Cron and file-watch triggers.",
    icon: Clock,
    path: "automations",
  },
  {
    label: "Approvals",
    description: "Sensitive actions awaiting a decision.",
    icon: ClipboardCheck,
    path: "approvals",
  },
  {
    label: "Knowledge Base",
    description: "The Obsidian vault agents can read.",
    icon: Library,
    path: "knowledge-base",
  },
] as const;

/** Buckets audit entries into the last 14 calendar days for the activity sparkline. */
function buildDailyActivity(entries: AuditLogSummary[]) {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = new Date(entry.createdAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const days: { date: string; calls: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    days.push({ date: key, calls: counts.get(key) ?? 0 });
  }
  return days;
}

const STATS_WINDOW_OPTIONS = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
] as const;

/** Fixed categorical order for the model-usage donut — never cycled. A 5th+
 * model folds into "Other" instead of generating a new hue. */
const MODEL_CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const TOOL_CALL_SUCCESS_COLOR = "#22c55e";
const TOOL_CALL_ERROR_COLOR = "#f43f5e";

/** State colors, not identity — reused from AUDIT_STATUS_BADGE's palette so
 * "completed"/"failed" read the same way here as everywhere else in the app. */
const AGENT_RUN_STATUS_COLOR: Record<string, string> = {
  completed: "#22c55e",
  failed: "#f43f5e",
  cancelled: "#94a3b8",
  running: "var(--chart-1)",
  waiting_approval: "#f59e0b",
  pending: "#94a3b8",
};

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value > 0 && value < 1 ? 4 : 2,
  }).format(value);
}

function formatDurationSeconds(totalSeconds: number): string {
  if (totalSeconds < 1) return "0s";
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatStatusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Buckets model usage into the top 4 by message count plus an "Other"
 * slice, so the donut never needs a 5th generated hue. */
function buildModelPieData(modelUsage: ModelUsageStat[]) {
  const top = modelUsage.slice(0, 4);
  const rest = modelUsage.slice(4);
  const restMessages = rest.reduce((sum, m) => sum + m.messages, 0);
  const data = top.map((m, index) => ({
    name: m.label,
    value: m.messages,
    fill: MODEL_CHART_COLORS[index],
  }));
  if (restMessages > 0) {
    data.push({ name: "Other", value: restMessages, fill: MODEL_CHART_COLORS[4] });
  }
  return data;
}

function buildToolUsageBarData(toolUsage: ToolUsageStat[]) {
  return toolUsage.map((t) => ({
    tool: t.toolLabel,
    success: t.successCount,
    error: t.errorCount,
  }));
}

function buildAgentRunStatusData(agentRunStatus: AgentRunStatusStat[]) {
  return [...agentRunStatus]
    .sort((a, b) => b.count - a.count)
    .map((s) => ({
      status: formatStatusLabel(s.status),
      count: s.count,
      fill: AGENT_RUN_STATUS_COLOR[s.status] ?? "var(--chart-3)",
    }));
}

type InstallForm = {
  mode: InstallationMode;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  workspaceName: string;
  appUrl: string;
};

const MODE_COPY: Record<
  InstallationMode,
  { title: string; description: string; database: string; network: string }
> = {
  pc: {
    title: "PC mode",
    description: "Single-user, SQLite, local-first. Fastest path for a workstation or laptop.",
    database: "SQLite file on disk",
    network: "Direct web/server ports on localhost",
  },
  server: {
    title: "Server mode",
    description:
      "Shared deployment with a domain, PostgreSQL, TLS, and reverse proxying via Caddy.",
    database: "PostgreSQL container",
    network: "HTTPS via Caddy on your own domain",
  },
};

const HIGHLIGHTS = [
  {
    icon: Database,
    title: "Mode-aware",
    body: "Recommends a deployment mode from the active database driver.",
  },
  {
    icon: Globe,
    title: "Caddy-ready",
    body: "Server mode assumes HTTPS termination and path routing through Caddy.",
  },
  {
    icon: ShieldCheck,
    title: "Own the first account",
    body: "Creates the initial Better-Auth account and primary workspace in one step.",
  },
];

export default function HomePage() {
  const router = useRouter();
  const installationQuery = useQuery({
    queryKey: ["installation", "status"],
    queryFn: () => trpcClient.installation.status.query(),
  });
  const workspaceId = installationQuery.data?.record?.primaryWorkspaceId;
  const dashboardEnabled = installationQuery.data?.isInstalled === true && Boolean(workspaceId);

  const modelsQuery = useQuery({
    queryKey: ["models", "list"],
    queryFn: () => trpcClient.models.list.query({ workspaceId }),
    enabled: installationQuery.data?.isInstalled === true,
  });
  const chatsQuery = useQuery({
    queryKey: ["chats", "list", workspaceId],
    queryFn: () => trpcClient.chats.list.query({ workspaceId: workspaceId! }),
    enabled: dashboardEnabled,
  });
  const agentsQuery = useQuery({
    queryKey: ["agents", "list", workspaceId],
    queryFn: () => trpcClient.agents.list.query({ workspaceId: workspaceId! }),
    enabled: dashboardEnabled,
  });
  const tasksQuery = useQuery({
    queryKey: ["tasks", "list", workspaceId],
    queryFn: () => trpcClient.tasks.list.query({ workspaceId: workspaceId! }),
    enabled: dashboardEnabled,
  });
  const approvalsQuery = useQuery({
    queryKey: ["approvals", "list", workspaceId, "pending"],
    queryFn: () =>
      trpcClient.approvals.list.query({ workspaceId: workspaceId!, status: "pending" }),
    enabled: dashboardEnabled,
  });
  const skillsQuery = useQuery({
    queryKey: ["skills", "list", workspaceId],
    queryFn: () => trpcClient.skills.list.query({ workspaceId: workspaceId! }),
    enabled: dashboardEnabled,
  });
  const mcpServersQuery = useQuery({
    queryKey: ["mcpServers", "list", workspaceId],
    queryFn: () => trpcClient.mcpServers.list.query({ workspaceId: workspaceId! }),
    enabled: dashboardEnabled,
  });
  const auditLogQuery = useQuery({
    queryKey: ["auditLog", "list", workspaceId, 50],
    queryFn: () => trpcClient.auditLog.list.query({ workspaceId: workspaceId!, limit: 50 }),
    enabled: dashboardEnabled,
    refetchInterval: 15_000,
  });

  const [statsDays, setStatsDays] = useState<number>(30);
  const statsQuery = useQuery({
    queryKey: ["stats", "overview", workspaceId, statsDays],
    queryFn: () =>
      trpcClient.stats.overview.query({ workspaceId: workspaceId!, days: statsDays }),
    enabled: dashboardEnabled,
  });

  const statsLoading =
    chatsQuery.isLoading ||
    agentsQuery.isLoading ||
    tasksQuery.isLoading ||
    approvalsQuery.isLoading ||
    skillsQuery.isLoading ||
    mcpServersQuery.isLoading;

  const openTaskCount =
    tasksQuery.data?.filter((task) => OPEN_TASK_STATUSES.has(task.status)).length ?? 0;
  const auditEntries = auditLogQuery.data ?? [];
  const dailyActivity = buildDailyActivity(auditEntries);

  const [form, setForm] = useState<InstallForm>({
    mode: "pc",
    ownerName: "",
    ownerEmail: "",
    ownerPassword: "",
    workspaceName: "Personal",
    appUrl: "http://localhost:3000",
  });

  useEffect(() => {
    if (!installationQuery.data) return;
    setForm((current) => ({
      ...current,
      mode: installationQuery.data.recommendedMode,
      appUrl: installationQuery.data.defaultAppUrl,
    }));
  }, [installationQuery.data]);

  const install = useMutation({
    mutationFn: () => trpcClient.installation.complete.mutate(form),
    onSuccess: async () => {
      // installation.complete creates the account server-side (a plain DB
      // write via auth.api.signUpEmail), which does not hand the browser a
      // session cookie — sign in for real over HTTP so the cookie the rest
      // of the app depends on (AppShell's session gate) actually gets set.
      await authClient.signIn.email({ email: form.ownerEmail, password: form.ownerPassword });
      await installationQuery.refetch();
      router.refresh();
    },
  });

  // ---- Loading: mirror the setup layout with skeletons so first paint
  // doesn't flash a bare screen or jump when data lands. ----
  if (installationQuery.isLoading) {
    return (
      <SystemScreen width="xl">
        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-14 w-full max-w-xl" />
            <Skeleton className="h-14 w-full max-w-lg" />
            <div className="grid gap-4 sm:grid-cols-3">
              {["a", "b", "c"].map((k) => (
                <Skeleton key={k} className="h-28 rounded-2xl" />
              ))}
            </div>
          </div>
          <Skeleton className="h-[32rem] rounded-2xl" />
        </div>
      </SystemScreen>
    );
  }

  if (!installationQuery.data?.isInstalled) {
    const selectedMode = MODE_COPY[form.mode];
    const recommended = installationQuery.data?.recommendedMode.toUpperCase() ?? "PC";

    return (
      <SystemScreen width="xl">
        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
          <section className="space-y-6">
            <BrandMark size="lg" subtitle="Self-hosted agentic OS" />
            <div className="space-y-4">
              <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                First-run setup
              </p>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-5xl">
                Install Nyxel once, then run it like a product.
              </h1>
              <p className="max-w-xl text-base text-muted-foreground">
                The setup wizard writes the first account, workspace, mode, and app URL into the
                database so the stack boots consistently on a PC or a server.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {HIGHLIGHTS.map(({ icon: Icon, title, body }) => (
                <div
                  key={title}
                  className="rounded-2xl border bg-card/60 p-4 shadow-xs backdrop-blur"
                >
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-4" />
                  </div>
                  <p className="mt-3 text-sm font-medium">
                    {title === "Mode-aware" ? <>Recommends {recommended}</> : title}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          </section>

          <Card className="border shadow-lg">
            <CardHeader>
              <CardTitle className="text-lg">Setup wizard</CardTitle>
              <p className="text-sm text-muted-foreground">
                Choose the deployment mode, then define the owner and workspace.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                {(["pc", "server"] as const).map((mode) => {
                  const active = form.mode === mode;
                  const copy = MODE_COPY[mode];
                  return (
                    <button
                      key={mode}
                      aria-pressed={active}
                      className={`rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        active
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border bg-background hover:border-primary/40 hover:bg-accent"
                      }`}
                      onClick={() => setForm((current) => ({ ...current, mode }))}
                      type="button"
                    >
                      <p className="text-sm font-medium">{copy.title}</p>
                      <p className="mt-1.5 text-xs text-muted-foreground">{copy.description}</p>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-xl border bg-muted/40 p-4 text-sm">
                <p className="font-medium">{selectedMode.title}</p>
                <dl className="mt-2 space-y-1 text-muted-foreground">
                  <div className="flex justify-between gap-4">
                    <dt>Database</dt>
                    <dd className="text-right text-foreground">{selectedMode.database}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>Network</dt>
                    <dd className="text-right text-foreground">{selectedMode.network}</dd>
                  </div>
                </dl>
              </div>

              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  install.mutate();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="owner-name">Owner name</Label>
                  <Input
                    id="owner-name"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        ownerName: event.target.value,
                      }))
                    }
                    placeholder="Jane Admin"
                    required
                    value={form.ownerName}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="owner-email">Owner email</Label>
                  <Input
                    id="owner-email"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        ownerEmail: event.target.value,
                      }))
                    }
                    placeholder="owner@example.com"
                    required
                    type="email"
                    value={form.ownerEmail}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="owner-password">Owner password</Label>
                  <Input
                    id="owner-password"
                    minLength={8}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        ownerPassword: event.target.value,
                      }))
                    }
                    placeholder="At least 8 characters"
                    required
                    type="password"
                    value={form.ownerPassword}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="workspace-name">Primary workspace</Label>
                  <Input
                    id="workspace-name"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        workspaceName: event.target.value,
                      }))
                    }
                    required
                    value={form.workspaceName}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="app-url">Public app URL</Label>
                  <Input
                    id="app-url"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        appUrl: event.target.value,
                      }))
                    }
                    placeholder="https://nyxel.example.com"
                    required
                    type="url"
                    value={form.appUrl}
                  />
                </div>

                <Button className="w-full" disabled={install.isPending} size="lg" type="submit">
                  {install.isPending && <Spinner className="mr-2" />}
                  {install.isPending ? "Installing…" : "Complete installation"}
                </Button>
                {install.isError && (
                  <p className="text-sm text-destructive">{(install.error as Error).message}</p>
                )}
              </form>
            </CardContent>
          </Card>
        </div>
      </SystemScreen>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Overview"
        description={
          <>
            {installationQuery.data.record?.mode === "server" ? "Server mode" : "PC mode"} · bound
            to{" "}
            <span className="font-medium text-foreground">
              {installationQuery.data.record?.appUrl ?? installationQuery.data.defaultAppUrl}
            </span>
          </>
        }
        actions={
          <>
            <Button onClick={() => router.push("/chat")}>Start first chat</Button>
            {workspaceId && (
              <Button asChild variant="outline">
                <Link href={`/workspace/${workspaceId}/settings`}>Workspace settings</Link>
              </Button>
            )}
          </>
        }
      />

      {statsLoading ? (
        <StatCardsSkeleton count={6} />
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Chats"
            value={chatsQuery.data?.length ?? 0}
            icon={<MessageSquare className="size-4" />}
          />
          <StatCard
            label="Agents"
            value={agentsQuery.data?.length ?? 0}
            icon={<Bot className="size-4" />}
          />
          <StatCard
            label="Open tasks"
            value={openTaskCount}
            icon={<CheckSquare className="size-4" />}
          />
          <StatCard
            label="Pending approvals"
            value={approvalsQuery.data?.length ?? 0}
            icon={<ClipboardCheck className="size-4" />}
          />
          <StatCard
            label="Skills"
            value={skillsQuery.data?.length ?? 0}
            icon={<Blocks className="size-4" />}
          />
          <StatCard
            label="Connectors"
            value={mcpServersQuery.data?.length ?? 0}
            icon={<Plug className="size-4" />}
          />
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <Card>
          <CardHeader>
            <CardTitle>Activity, last 14 days</CardTitle>
          </CardHeader>
          <CardContent>
            {auditLogQuery.isLoading ? (
              <Skeleton className="h-32 w-full rounded-lg" />
            ) : (
              <ChartContainer
                className="aspect-auto h-32 w-full"
                config={{ calls: { label: "Tool calls", color: "var(--chart-1)" } }}
              >
                <AreaChart data={dailyActivity} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="overviewActivityGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24} />
                  <Area
                    dataKey="calls"
                    type="monotone"
                    stroke="var(--chart-1)"
                    fill="url(#overviewActivityGradient)"
                    strokeWidth={1.5}
                  />
                </AreaChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Deployment summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>Database driver: {installationQuery.data.driver}</p>
            <p className="truncate">Workspace id: {workspaceId}</p>
            <p className="truncate">Owner id: {installationQuery.data.record?.ownerUserId}</p>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Detailed statistics</h2>
            <p className="text-sm text-muted-foreground">
              Token usage, generation activity, and tool/model breakdowns for this workspace.
            </p>
          </div>
          <Tabs value={String(statsDays)} onValueChange={(value) => setStatsDays(Number(value))}>
            <TabsList>
              {STATS_WINDOW_OPTIONS.map((option) => (
                <TabsTrigger key={option.value} value={String(option.value)}>
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {statsQuery.isLoading ? (
          <StatCardsSkeleton count={8} />
        ) : !statsQuery.data ||
          (statsQuery.data.totals.assistantMessages === 0 && statsQuery.data.totals.toolCalls === 0) ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No generation activity yet — detailed statistics show up here once agents start
              chatting and calling tools.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Tokens used"
                value={formatCompactNumber(statsQuery.data.totals.totalTokens)}
                icon={<Layers className="size-4" />}
              />
              <StatCard
                label="Estimated cost"
                value={formatUsd(statsQuery.data.totals.costUsd)}
                icon={<DollarSign className="size-4" />}
              />
              <StatCard
                label="Cached tokens"
                value={formatCompactNumber(statsQuery.data.totals.cacheReadTokens)}
                icon={<Sparkles className="size-4" />}
              />
              <StatCard
                label="Tool success rate"
                value={`${statsQuery.data.totals.toolCallSuccessRate}%`}
                icon={<Gauge className="size-4" />}
              />
              <StatCard
                label="Lines generated"
                value={formatCompactNumber(statsQuery.data.totals.linesGenerated)}
                icon={<FileCode className="size-4" />}
              />
              <StatCard
                label="Code blocks"
                value={formatCompactNumber(statsQuery.data.totals.codeBlocksGenerated)}
                icon={<Code2 className="size-4" />}
              />
              <StatCard
                label="Thinking time"
                value={formatDurationSeconds(statsQuery.data.totals.thinkingSeconds)}
                icon={<BrainCircuit className="size-4" />}
              />
              <StatCard
                label="Avg. response time"
                value={formatDurationSeconds(statsQuery.data.totals.avgResponseSeconds)}
                icon={<Timer className="size-4" />}
              />
            </div>

            {statsQuery.data.totals.costUnknownMessages > 0 && (
              <p className="text-xs text-muted-foreground">
                Cost estimate excludes {statsQuery.data.totals.costUnknownMessages} message(s)
                generated by models without known pricing.
              </p>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Tokens generated</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer
                    className="aspect-auto h-52 w-full"
                    config={{ tokens: { label: "Tokens", color: "var(--chart-1)" } }}
                  >
                    <AreaChart
                      data={statsQuery.data.dailySeries}
                      margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="statsTokensGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24} />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        width={36}
                        tickFormatter={formatCompactNumber}
                      />
                      <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
                      <Area
                        dataKey="tokens"
                        type="monotone"
                        stroke="var(--chart-1)"
                        fill="url(#statsTokensGradient)"
                        strokeWidth={1.5}
                      />
                    </AreaChart>
                  </ChartContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Estimated cost</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer
                    className="aspect-auto h-52 w-full"
                    config={{ costUsd: { label: "Cost", color: "var(--chart-2)" } }}
                  >
                    <AreaChart
                      data={statsQuery.data.dailySeries}
                      margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="statsCostGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24} />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        width={52}
                        tickFormatter={(value: number) => formatUsd(value)}
                      />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            indicator="line"
                            formatter={(value) => formatUsd(Number(value))}
                          />
                        }
                      />
                      <Area
                        dataKey="costUsd"
                        type="monotone"
                        stroke="var(--chart-2)"
                        fill="url(#statsCostGradient)"
                        strokeWidth={1.5}
                      />
                    </AreaChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle>Model usage</CardTitle>
                </CardHeader>
                <CardContent>
                  {statsQuery.data.modelUsage.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No model usage recorded yet.</p>
                  ) : (
                    <>
                      <ChartContainer className="mx-auto aspect-square max-h-[220px]" config={{}}>
                        <PieChart>
                          <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                          <Pie
                            data={buildModelPieData(statsQuery.data.modelUsage)}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={55}
                            outerRadius={80}
                            strokeWidth={2}
                          />
                        </PieChart>
                      </ChartContainer>
                      <ul className="mt-3 space-y-1.5 text-sm">
                        {buildModelPieData(statsQuery.data.modelUsage).map((slice) => (
                          <li key={slice.name} className="flex items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-2">
                              <span
                                className="size-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: slice.fill }}
                              />
                              <span className="truncate">{slice.name}</span>
                            </span>
                            <span className="shrink-0 text-muted-foreground">{slice.value}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Tool usage</CardTitle>
                </CardHeader>
                <CardContent>
                  {statsQuery.data.toolUsage.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No tool calls recorded yet.</p>
                  ) : (
                    <ChartContainer
                      className="aspect-auto h-56 w-full"
                      config={{
                        success: { label: "Success", color: TOOL_CALL_SUCCESS_COLOR },
                        error: { label: "Error", color: TOOL_CALL_ERROR_COLOR },
                      }}
                    >
                      <BarChart
                        data={buildToolUsageBarData(statsQuery.data.toolUsage)}
                        layout="vertical"
                        margin={{ top: 4, right: 12, left: 4, bottom: 0 }}
                      >
                        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                        <XAxis
                          type="number"
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={formatCompactNumber}
                        />
                        <YAxis
                          dataKey="tool"
                          type="category"
                          tickLine={false}
                          axisLine={false}
                          width={96}
                          tick={{ fontSize: 11 }}
                        />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar
                          dataKey="success"
                          stackId="calls"
                          fill="var(--color-success)"
                          radius={[4, 0, 0, 4]}
                        />
                        <Bar
                          dataKey="error"
                          stackId="calls"
                          fill="var(--color-error)"
                          radius={[0, 4, 4, 0]}
                        />
                      </BarChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Content generated</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer
                    className="mx-auto aspect-square max-h-[240px]"
                    config={{ value: { label: "Count", color: "var(--chart-1)" } }}
                  >
                    <RadarChart
                      data={statsQuery.data.generationBreakdown.map((g) => ({
                        subject: g.label,
                        value: g.count,
                      }))}
                      outerRadius="62%"
                      margin={{ top: 8, right: 28, bottom: 8, left: 28 }}
                    >
                      <PolarGrid />
                      <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Radar
                        dataKey="value"
                        fill="var(--chart-1)"
                        fillOpacity={0.45}
                        stroke="var(--chart-1)"
                      />
                    </RadarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <Card>
                <CardHeader>
                  <CardTitle>Tool call success rate</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="relative mx-auto max-w-[220px]">
                    <ChartContainer
                      className="mx-auto aspect-square max-h-[200px]"
                      config={{ value: { label: "Success rate", color: "var(--chart-1)" } }}
                    >
                      <RadialBarChart
                        data={[
                          {
                            name: "rate",
                            value: statsQuery.data.totals.toolCallSuccessRate,
                            fill: "var(--chart-1)",
                          },
                        ]}
                        innerRadius={70}
                        outerRadius={100}
                        startAngle={90}
                        endAngle={450}
                      >
                        <PolarAngleAxis type="number" domain={[0, 100]} dataKey="value" tick={false} />
                        <RadialBar dataKey="value" background cornerRadius={12} />
                      </RadialBarChart>
                    </ChartContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-semibold">
                        {statsQuery.data.totals.toolCallSuccessRate}%
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {statsQuery.data.totals.toolCalls} calls
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Agent runs by status</CardTitle>
                </CardHeader>
                <CardContent>
                  {statsQuery.data.agentRunStatus.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No agent runs recorded yet.</p>
                  ) : (
                    <ChartContainer
                      className="aspect-auto h-56 w-full"
                      config={{ count: { label: "Runs", color: "var(--chart-1)" } }}
                    >
                      <BarChart
                        data={buildAgentRunStatusData(statsQuery.data.agentRunStatus)}
                        margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
                      >
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis dataKey="status" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                        <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                          {buildAgentRunStatusData(statsQuery.data.agentRunStatus).map((entry) => (
                            <Cell key={entry.status} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.7fr_1.3fr]">
        <Card>
          <CardHeader>
            <CardTitle>Detected models</CardTitle>
          </CardHeader>
          <CardContent>
            {modelsQuery.isLoading && (
              <div className="space-y-2">
                {["a", "b", "c"].map((k) => (
                  <div
                    key={k}
                    className="flex items-center justify-between rounded-lg border px-4 py-3"
                  >
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                ))}
              </div>
            )}
            {modelsQuery.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No models detected. Start Ollama/LM Studio or set an API key for a cloud provider.
              </p>
            )}
            <ul className="space-y-2">
              {modelsQuery.data?.map((model) => (
                <li
                  key={model.id}
                  className="flex items-center justify-between rounded-lg border px-4 py-3 text-sm"
                >
                  <span>{model.label}</span>
                  <span className="text-muted-foreground">{model.kind}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {auditLogQuery.isLoading ? (
              <CardListSkeleton rows={4} />
            ) : auditEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No activity logged yet — it shows up here the first time an agent calls a tool.
              </p>
            ) : (
              <ul className="space-y-2">
                {auditEntries.slice(0, 6).map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{entry.toolLabel}</p>
                      <p className="text-xs text-muted-foreground capitalize">{entry.actor}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleString()}
                      </span>
                      <Badge variant="outline" className={AUDIT_STATUS_BADGE[entry.status]}>
                        {AUDIT_STATUS_LABEL[entry.status] ?? entry.status}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {workspaceId && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Jump to</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {QUICK_LINKS.map(({ label, description, icon: Icon, path }) => (
              <Link
                key={path}
                href={`/workspace/${workspaceId}/${path}`}
                className="group flex items-start gap-3 rounded-xl border bg-card p-4 shadow-xs transition hover:border-primary/40 hover:bg-accent"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 text-sm font-medium">
                    {label}
                    <ArrowRight className="size-3.5 shrink-0 -translate-x-0.5 opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100" />
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
