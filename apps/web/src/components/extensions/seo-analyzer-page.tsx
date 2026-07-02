"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { WorkingDirectoryPicker } from "@/components/chat/working-directory-picker";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type SeoFindingSeverity, type SeoProjectSummary, trpcClient } from "@/lib/trpc";

const SEVERITY_BADGE: Record<SeoFindingSeverity, string> = {
  critical: "bg-destructive/15 text-destructive",
  warning: "bg-amber-500/15 text-amber-600",
  info: "bg-muted text-muted-foreground",
};

const CATEGORY_BAR_COLOR: Record<"seo" | "geo" | "aeo", string> = {
  seo: "bg-blue-500",
  geo: "bg-violet-500",
  aeo: "bg-emerald-500",
};

const SEVERITY_BAR_COLOR: Record<SeoFindingSeverity, string> = {
  critical: "bg-destructive",
  warning: "bg-amber-500",
  info: "bg-muted-foreground",
};

/** A labeled proportion bar for a stat breakdown — matches the app's plain,
 * chart-library-free aesthetic (StatCard-style tiles everywhere else). */
function StatBar({
  label,
  value,
  max,
  colorClass,
}: {
  label: string;
  value: number;
  max: number;
  colorClass: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="capitalize text-muted-foreground">{label}</span>
        <span className="font-medium">{value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** A compact score-over-time strip — one bar per run, tallest = 100. Not a
 * real chart component (no library dependency), just enough to see the
 * trend at a glance. */
function ScoreTrend({ runs }: { runs: { score: number | null; startedAt: Date }[] }) {
  if (runs.length < 2) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">Score trend ({runs.length} runs)</p>
      <div className="flex h-12 items-end gap-1">
        {runs.map((run, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: runs are a fixed, non-reorderable history snapshot
            key={i}
            className="flex-1 rounded-sm bg-primary/70"
            style={{ height: `${Math.max(4, run.score ?? 0)}%` }}
            title={`${new Date(run.startedAt).toLocaleDateString()}: ${run.score ?? "—"}`}
          />
        ))}
      </div>
    </div>
  );
}

function LinkProjectForm({
  workspaceId,
  onCreated,
}: {
  workspaceId: string;
  onCreated: () => void;
}) {
  const [domain, setDomain] = useState("");
  const [repoPath, setRepoPath] = useState("");
  // The browser's folder picker can only ever return a bare directory name
  // (showDirectoryPicker() never exposes a real filesystem path, by design —
  // see WorkingDirectoryPicker's own comment on this) — so the user has to
  // complete it into an absolute path themselves before this is valid.
  const repoPathIsAbsolute = repoPath.trim().startsWith("/");
  const createProject = useMutation({
    mutationFn: () =>
      trpcClient.seoAnalyzer.createProject.mutate({ workspaceId, domain, repoPath }),
    onSuccess: () => {
      setDomain("");
      setRepoPath("");
      onCreated();
    },
  });

  return (
    <div className="max-w-lg space-y-4 rounded-lg border p-5">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Link a domain + repo</h3>
        <p className="text-sm text-muted-foreground">
          The analyzer crawls the live domain and scans the local repo source to find SEO, GEO
          (structured data), and AEO (answer-engine) issues.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="seo-domain">Domain</Label>
        <Input
          id="seo-domain"
          placeholder="example.com"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Local repo path</Label>
        <div className="flex items-center gap-2">
          <WorkingDirectoryPicker value={repoPath} onChange={setRepoPath} />
          <Input
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            placeholder="/Users/you/dev/example-site"
            className="h-8 flex-1 text-xs"
          />
        </div>
        {repoPath && !repoPathIsAbsolute ? (
          <p className="text-xs text-destructive">
            The folder picker only knows the folder's name, not its full location — complete it into
            an absolute path (starting with /) in the field above.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Absolute path on this machine — the fixer agent's file access is scoped to this
            directory only.
          </p>
        )}
      </div>
      {createProject.error && (
        <p className="text-sm text-destructive">{(createProject.error as Error).message}</p>
      )}
      <Button
        size="sm"
        disabled={!domain.trim() || !repoPathIsAbsolute || createProject.isPending}
        onClick={() => createProject.mutate()}
      >
        {createProject.isPending ? "Linking…" : "Link project"}
      </Button>
    </div>
  );
}

function FixerAgentControl({ project }: { project: SeoProjectSummary }) {
  const queryClient = useQueryClient();

  const agentsQuery = useQuery({
    queryKey: ["agents", project.workspaceId],
    queryFn: () => trpcClient.agents.list.query({ workspaceId: project.workspaceId }),
  });

  const setFixerAgent = useMutation({
    mutationFn: (agentId: string | null) =>
      trpcClient.seoAnalyzer.setFixerAgent.mutate({ id: project.id, agentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["seoAnalyzer", "projects", project.workspaceId],
      });
    },
  });

  const pinnedAgent = agentsQuery.data?.find((a) => a.id === project.fixerAgentId);
  // Auto-provisioned agents are always named this way (see configureSeoFixerAgent
  // in seo-analyzer.ts) and come with file tools scoped to repoPath only —
  // anything else the user picks is their own agent with whatever tools it
  // already has, so it isn't guaranteed to stay inside the repo.
  const pinnedIsAutoProvisioned = pinnedAgent?.name === `SEO Fixer — ${project.domain}`;

  return (
    <div className="space-y-2 rounded-lg border p-4">
      <h3 className="text-sm font-medium">Fixer agent</h3>
      <p className="text-xs text-muted-foreground">
        Which agent (and model) runs "Fix with AI" and blog generation for this project. Leave on
        Auto for a dedicated agent whose file access is scoped to the repo only.
      </p>
      <select
        className="h-8 w-full max-w-xs rounded-md border bg-background px-2 text-sm"
        value={project.fixerAgentId ?? ""}
        disabled={agentsQuery.isLoading || setFixerAgent.isPending}
        onChange={(e) => setFixerAgent.mutate(e.target.value === "" ? null : e.target.value)}
      >
        <option value="">Auto (dedicated, repo-scoped)</option>
        {(agentsQuery.data ?? []).map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name} — {agent.modelId}
          </option>
        ))}
      </select>
      {project.fixerAgentId && !pinnedIsAutoProvisioned && (
        <p className="text-xs text-amber-600">
          This agent isn't repo-scoped — it can touch whatever files its own tools allow, not just
          this repo.
        </p>
      )}
      {setFixerAgent.error && (
        <p className="text-sm text-destructive">{(setFixerAgent.error as Error).message}</p>
      )}
    </div>
  );
}

const CRON_PRESETS = [
  { label: "Daily at 3am", value: "0 3 * * *" },
  { label: "Weekly (Monday 3am)", value: "0 3 * * 1" },
  { label: "Monthly (1st, 3am)", value: "0 3 1 * *" },
];

function ScheduleControl({ project }: { project: SeoProjectSummary }) {
  const queryClient = useQueryClient();
  const [cronExpression, setCronExpression] = useState(project.reanalyzeCronExpression ?? "");

  const setSchedule = useMutation({
    mutationFn: (value: string | null) =>
      trpcClient.seoAnalyzer.setSchedule.mutate({ id: project.id, cronExpression: value }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["seoAnalyzer", "projects", project.workspaceId],
      });
    },
  });

  return (
    <div className="space-y-2 rounded-lg border p-4">
      <h3 className="text-sm font-medium">Recurring re-analysis</h3>
      {project.reanalyzeCronExpression ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            Scheduled (<code className="text-foreground">{project.reanalyzeCronExpression}</code>)
            {project.nextReanalyzeAt && (
              <> — next run {new Date(project.nextReanalyzeAt).toLocaleString()}</>
            )}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={setSchedule.isPending}
            onClick={() => setSchedule.mutate(null)}
          >
            Stop
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={cronExpression}
            onChange={(e) => setCronExpression(e.target.value)}
          >
            <option value="">Choose a schedule…</option>
            {CRON_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={!cronExpression || setSchedule.isPending}
            onClick={() => setSchedule.mutate(cronExpression)}
          >
            Enable
          </Button>
        </div>
      )}
      {setSchedule.error && (
        <p className="text-sm text-destructive">{(setSchedule.error as Error).message}</p>
      )}
    </div>
  );
}

function ProjectDashboard({ project }: { project: SeoProjectSummary }) {
  const queryClient = useQueryClient();
  const [selectedFindingIds, setSelectedFindingIds] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState("");

  const runsQuery = useQuery({
    queryKey: ["seoAnalyzer", "runs", project.id],
    queryFn: () => trpcClient.seoAnalyzer.listRuns.query({ seoProjectId: project.id }),
  });
  const findingsQuery = useQuery({
    queryKey: ["seoAnalyzer", "openFindings", project.id],
    queryFn: () => trpcClient.seoAnalyzer.listOpenFindings.query({ seoProjectId: project.id }),
  });
  const allFindingsQuery = useQuery({
    queryKey: ["seoAnalyzer", "allFindings", project.id],
    queryFn: () => trpcClient.seoAnalyzer.listAllFindings.query({ seoProjectId: project.id }),
  });
  const blogPostsQuery = useQuery({
    queryKey: ["seoAnalyzer", "blogPosts", project.id],
    queryFn: () => trpcClient.seoAnalyzer.listBlogPosts.query({ seoProjectId: project.id }),
  });
  const pluginsQuery = useQuery({
    queryKey: ["plugins", "list", project.workspaceId],
    queryFn: () => trpcClient.plugins.list.query({ workspaceId: project.workspaceId }),
  });

  const latestRun = runsQuery.data?.[0] ?? null;
  const seoPlugin = pluginsQuery.data?.find((p) => p.repoUrl.toLowerCase().includes("claude-seo"));

  const runAnalysis = useMutation({
    mutationFn: () => trpcClient.seoAnalyzer.runAnalysis.mutate({ seoProjectId: project.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["seoAnalyzer", "runs", project.id] });
      queryClient.invalidateQueries({ queryKey: ["seoAnalyzer", "openFindings", project.id] });
    },
  });

  const dispatchFix = useMutation({
    mutationFn: () =>
      trpcClient.seoAnalyzer.dispatchFix.mutate({
        seoProjectId: project.id,
        findingIds: [...selectedFindingIds],
      }),
    onSuccess: () => {
      setSelectedFindingIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["seoAnalyzer", "openFindings", project.id] });
      queryClient.invalidateQueries({ queryKey: ["seoAnalyzer", "allFindings", project.id] });
    },
  });

  const generateBlogPost = useMutation({
    mutationFn: () =>
      trpcClient.seoAnalyzer.generateBlogPost.mutate({ seoProjectId: project.id, keyword }),
    onSuccess: () => {
      setKeyword("");
      queryClient.invalidateQueries({ queryKey: ["seoAnalyzer", "blogPosts", project.id] });
    },
  });

  function toggleFinding(id: string) {
    setSelectedFindingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const openFindings = findingsQuery.data ?? [];
  const allFindings = allFindingsQuery.data ?? [];
  const resolvedCount = allFindings.filter((f) => f.resolved).length;
  const resolutionRate =
    allFindings.length > 0 ? Math.round((resolvedCount / allFindings.length) * 100) : null;
  const categoryCounts = {
    seo: openFindings.filter((f) => f.category === "seo").length,
    geo: openFindings.filter((f) => f.category === "geo").length,
    aeo: openFindings.filter((f) => f.category === "aeo").length,
  };
  const severityCounts = {
    critical: openFindings.filter((f) => f.severity === "critical").length,
    warning: openFindings.filter((f) => f.severity === "warning").length,
    info: openFindings.filter((f) => f.severity === "info").length,
  };
  const runsChronological = [...(runsQuery.data ?? [])].reverse();
  const previousRun = runsQuery.data?.[1] ?? null;
  const scoreDelta =
    latestRun?.score != null && previousRun?.score != null
      ? latestRun.score - previousRun.score
      : null;
  const blogStatusCounts = {
    written: (blogPostsQuery.data ?? []).filter((p) => p.status === "written").length,
    generating: (blogPostsQuery.data ?? []).filter((p) => p.status === "generating").length,
    failed: (blogPostsQuery.data ?? []).filter((p) => p.status === "failed").length,
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="findings">
            Findings
            {(findingsQuery.data?.length ?? 0) > 0 && (
              <Badge className="ml-1.5 h-4 min-w-4 px-1 text-[10px]">
                {findingsQuery.data?.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="blog">Blog</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={runAnalysis.isPending} onClick={() => runAnalysis.mutate()}>
              {runAnalysis.isPending ? "Analyzing…" : "Run analysis"}
            </Button>
            {latestRun && (
              <span className="text-sm text-muted-foreground">
                Last run {new Date(latestRun.startedAt).toLocaleString()} — {latestRun.status}
              </span>
            )}
          </div>
          {runAnalysis.error && (
            <p className="text-sm text-destructive">{(runAnalysis.error as Error).message}</p>
          )}
          {latestRun && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Score</p>
                <p className="text-2xl font-semibold">
                  {latestRun.score ?? "—"}
                  {scoreDelta != null && scoreDelta !== 0 && (
                    <span
                      className={`ml-2 text-sm font-normal ${scoreDelta > 0 ? "text-emerald-600" : "text-destructive"}`}
                    >
                      {scoreDelta > 0 ? "+" : ""}
                      {scoreDelta}
                    </span>
                  )}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Pages scanned</p>
                <p className="text-2xl font-semibold">{latestRun.pagesScanned}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Status</p>
                <p className="text-2xl font-semibold capitalize">{latestRun.status}</p>
              </div>
            </div>
          )}
          {latestRun?.summary && (
            <p className="text-sm text-muted-foreground">{latestRun.summary}</p>
          )}
          {latestRun?.errorMessage && (
            <p className="text-sm text-destructive">{latestRun.errorMessage}</p>
          )}

          {allFindings.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Runs</p>
                <p className="text-2xl font-semibold">{runsQuery.data?.length ?? 0}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Findings ever detected</p>
                <p className="text-2xl font-semibold">{allFindings.length}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Resolved</p>
                <p className="text-2xl font-semibold">{resolvedCount}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Resolution rate</p>
                <p className="text-2xl font-semibold">
                  {resolutionRate != null ? `${resolutionRate}%` : "—"}
                </p>
              </div>
            </div>
          )}

          {runsChronological.length >= 2 && <ScoreTrend runs={runsChronological} />}

          {openFindings.length > 0 && (
            <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Open findings by category
                </p>
                <StatBar
                  label="seo"
                  value={categoryCounts.seo}
                  max={openFindings.length}
                  colorClass={CATEGORY_BAR_COLOR.seo}
                />
                <StatBar
                  label="geo"
                  value={categoryCounts.geo}
                  max={openFindings.length}
                  colorClass={CATEGORY_BAR_COLOR.geo}
                />
                <StatBar
                  label="aeo"
                  value={categoryCounts.aeo}
                  max={openFindings.length}
                  colorClass={CATEGORY_BAR_COLOR.aeo}
                />
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Open findings by severity
                </p>
                <StatBar
                  label="critical"
                  value={severityCounts.critical}
                  max={openFindings.length}
                  colorClass={SEVERITY_BAR_COLOR.critical}
                />
                <StatBar
                  label="warning"
                  value={severityCounts.warning}
                  max={openFindings.length}
                  colorClass={SEVERITY_BAR_COLOR.warning}
                />
                <StatBar
                  label="info"
                  value={severityCounts.info}
                  max={openFindings.length}
                  colorClass={SEVERITY_BAR_COLOR.info}
                />
              </div>
            </div>
          )}

          {(blogPostsQuery.data?.length ?? 0) > 0 && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Blog posts written</p>
                <p className="text-2xl font-semibold">{blogStatusCounts.written}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Drafting</p>
                <p className="text-2xl font-semibold">{blogStatusCounts.generating}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Failed</p>
                <p className="text-2xl font-semibold">{blogStatusCounts.failed}</p>
              </div>
            </div>
          )}

          <div className="space-y-1 text-sm text-muted-foreground">
            <p>
              Domain: <span className="text-foreground">{project.domain}</span>
            </p>
            <p>
              Repo: <span className="text-foreground">{project.repoPath}</span>
            </p>
            {project.blogConfig && (
              <p>
                Blog dir: <span className="text-foreground">{project.blogConfig.dir}</span>
              </p>
            )}
          </div>

          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-medium">SEO plugin</h3>
            {seoPlugin ? (
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="text-foreground">{seoPlugin.name}</span> is installed — the fixer
                agent draws on {seoPlugin.skillSlugs.length} skill(s) and{" "}
                {seoPlugin.agentDefs.length} specialist persona(s) from it, matched to each fix
                batch's categories, and always runs on the strongest model available in this
                workspace.
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                No companion plugin installed yet — the fixer agent is running on its built-in
                instructions only. Reinstalling the SEO/GEO/AEO Analyzer extension in Settings →
                Extensions pulls it in automatically, or install it directly from the Plugins page.
              </p>
            )}
          </div>

          <FixerAgentControl project={project} />
          <ScheduleControl project={project} />
        </TabsContent>

        <TabsContent value="findings" className="space-y-4 pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {findingsQuery.data?.length ?? 0} open finding(s). Select some and dispatch the fixer
              agent to edit the repo directly.
            </p>
            <Button
              size="sm"
              disabled={selectedFindingIds.size === 0 || dispatchFix.isPending}
              onClick={() => dispatchFix.mutate()}
            >
              {dispatchFix.isPending
                ? "Fixing…"
                : `Fix ${selectedFindingIds.size || ""} with AI`.replace("  ", " ")}
            </Button>
          </div>
          {dispatchFix.error && (
            <p className="text-sm text-destructive">{(dispatchFix.error as Error).message}</p>
          )}
          {dispatchFix.data && (
            <div className="space-y-1">
              <p className="text-sm text-emerald-600">
                Fixer agent finished — {dispatchFix.data.output.slice(0, 200)}
                {dispatchFix.data.output.length > 200 ? "…" : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                Ran on <span className="text-foreground">{dispatchFix.data.modelId}</span>
                {dispatchFix.data.pluginSkillsUsed.length > 0 && (
                  <>
                    {" "}
                    with specialist skill(s):{" "}
                    <span className="text-foreground">
                      {dispatchFix.data.pluginSkillsUsed.join(", ")}
                    </span>
                  </>
                )}
              </p>
            </div>
          )}
          <div className="space-y-2">
            {(findingsQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No open findings. Run an analysis to check for issues.
              </p>
            ) : (
              (findingsQuery.data ?? []).map((finding) => (
                <div key={finding.id} className="flex gap-3 rounded-lg border p-3">
                  <Checkbox
                    checked={selectedFindingIds.has(finding.id)}
                    onCheckedChange={() => toggleFinding(finding.id)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={SEVERITY_BADGE[finding.severity]}>{finding.severity}</Badge>
                      <Badge variant="secondary" className="uppercase">
                        {finding.category}
                      </Badge>
                      <p className="text-sm font-medium">{finding.title}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">{finding.description}</p>
                    <p className="text-xs text-muted-foreground">→ {finding.recommendation}</p>
                    {finding.location && (
                      <p className="truncate text-xs text-muted-foreground/70">
                        {finding.location}
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="blog" className="space-y-4 pt-4">
          {!project.blogConfig ? (
            <p className="text-sm text-muted-foreground">
              No blog directory detected yet — run an analysis first, or this site may not have a
              blog.
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="seo-keyword">Target keyword</Label>
                <Input
                  id="seo-keyword"
                  placeholder="e.g. best project management software"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  className="w-72"
                />
              </div>
              <Button
                size="sm"
                disabled={!keyword.trim() || generateBlogPost.isPending}
                onClick={() => generateBlogPost.mutate()}
              >
                {generateBlogPost.isPending ? "Drafting…" : "Generate post"}
              </Button>
            </div>
          )}
          {generateBlogPost.error && (
            <p className="text-sm text-destructive">{(generateBlogPost.error as Error).message}</p>
          )}
          <div className="space-y-2">
            {(blogPostsQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No blog posts generated yet.</p>
            ) : (
              (blogPostsQuery.data ?? []).map((post) => (
                <div
                  key={post.id}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-sm font-medium">{post.title ?? post.keyword}</p>
                    <p className="text-xs text-muted-foreground">
                      Keyword: {post.keyword}
                      {post.filePath ? ` — ${post.filePath}` : ""}
                    </p>
                    {post.errorMessage && (
                      <p className="text-xs text-destructive">{post.errorMessage}</p>
                    )}
                  </div>
                  <Badge
                    className={
                      post.status === "written"
                        ? "bg-emerald-500/15 text-emerald-600"
                        : post.status === "failed"
                          ? "bg-destructive/15 text-destructive"
                          : "bg-muted text-muted-foreground"
                    }
                  >
                    {post.status}
                  </Badge>
                </div>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function SeoAnalyzerExtensionPage({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const projectsQuery = useQuery({
    queryKey: ["seoAnalyzer", "projects", workspaceId],
    queryFn: () => trpcClient.seoAnalyzer.listProjects.query({ workspaceId }),
  });

  const projects = projectsQuery.data ?? [];
  const activeProject = projects.find((p) => p.id === selectedProjectId) ?? projects[0] ?? null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title="SEO/GEO/AEO Analyzer"
        description="Link a domain to a local repo, find search/answer-engine issues, and dispatch an AI agent to fix them and draft blog posts."
      />

      {projects.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {projects.map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant={p.id === activeProject?.id ? "default" : "outline"}
              onClick={() => setSelectedProjectId(p.id)}
            >
              {p.domain}
            </Button>
          ))}
        </div>
      )}

      {activeProject ? (
        <ProjectDashboard project={activeProject} />
      ) : (
        <LinkProjectForm
          workspaceId={workspaceId}
          onCreated={() =>
            queryClient.invalidateQueries({ queryKey: ["seoAnalyzer", "projects", workspaceId] })
          }
        />
      )}

      {activeProject && projects.length < 5 && (
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-medium">Link another site</summary>
          <div className="mt-4">
            <LinkProjectForm
              workspaceId={workspaceId}
              onCreated={() => {
                queryClient.invalidateQueries({
                  queryKey: ["seoAnalyzer", "projects", workspaceId],
                });
              }}
            />
          </div>
        </details>
      )}
    </div>
  );
}
