import type { TaskRecord } from "@nyxel/db";
import { getDb } from "@nyxel/db";
import { logAudit } from "./audit";

const HEALTH_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
// First run fires shortly after boot (not instantly — avoids racing the
// migration/seed steps in index.ts) so a fresh install shows a report
// without waiting a full day; every run after that is the daily interval.
const HEALTH_CHECK_STARTUP_DELAY_MS = 30_000;

const FAILED_RUN_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const STALE_APPROVAL_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export type HealthStatus = "ok" | "warning" | "error";

export interface HealthCheckResult {
  id: string;
  label: string;
  status: HealthStatus;
  detail: string;
}

const SEVERITY_RANK: Record<HealthStatus, number> = { ok: 0, warning: 1, error: 2 };
const STATUS_EMOJI: Record<HealthStatus, string> = { ok: "✅", warning: "⚠️", error: "🔴" };

function worseOf(a: HealthStatus, b: HealthStatus): HealthStatus {
  return SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a;
}

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Trims a message to a safe length for embedding in a report — long stack
 * traces or provider error bodies shouldn't blow up the report, and this
 * also caps how much of any accidental secret-bearing error text leaks
 * through (SEC concern: never echo raw tool/automation input here). */
function truncate(text: string, max = 160): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

async function checkFailedAgentRuns(workspaceId: string, now: Date): Promise<HealthCheckResult> {
  const since = new Date(now.getTime() - FAILED_RUN_LOOKBACK_MS);
  const runs = await getDb().listAgentRunsByWorkspace(workspaceId, { since });
  const failed = runs.filter((r) => r.status === "failed");
  const mostRecent = failed[0];
  if (!mostRecent) {
    return {
      id: "agent_runs",
      label: "Failed agent runs (last 24h)",
      status: "ok",
      detail: "None.",
    };
  }
  return {
    id: "agent_runs",
    label: "Failed agent runs (last 24h)",
    status: "warning",
    detail: `${failed.length} run(s) failed. Most recent: ${truncate(mostRecent.errorMessage ?? "no error message recorded")}`,
  };
}

async function checkStaleApprovals(workspaceId: string, now: Date): Promise<HealthCheckResult> {
  const pending = await getDb().listApprovalsByWorkspace(workspaceId, "pending");
  const threshold = now.getTime() - STALE_APPROVAL_THRESHOLD_MS;
  const stale = pending
    .filter((a) => a.createdAt.getTime() < threshold)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const oldest = stale[0];
  if (!oldest) {
    return {
      id: "approvals",
      label: "Open approvals older than 24h",
      status: "ok",
      detail: "None.",
    };
  }
  const oldestHours = Math.floor((now.getTime() - oldest.createdAt.getTime()) / (60 * 60 * 1000));
  return {
    id: "approvals",
    label: "Open approvals older than 24h",
    status: "warning",
    detail: `${stale.length} approval(s) waiting. Oldest ("${truncate(oldest.toolLabel, 60)}") has been pending ${oldestHours}h.`,
  };
}

async function checkFailedAutomations(workspaceId: string): Promise<HealthCheckResult> {
  const automations = await getDb().listAutomationsByWorkspace(workspaceId);
  const failed = automations.filter((a) => a.enabled && a.lastRunStatus === "error");
  if (failed.length === 0) {
    return {
      id: "automations",
      label: "Automations currently in error",
      status: "ok",
      detail: "None.",
    };
  }
  return {
    id: "automations",
    label: "Automations currently in error",
    status: "warning",
    detail: failed
      .map((a) => `"${a.name}": ${truncate(a.lastErrorMessage ?? "unknown error", 100)}`)
      .join("; "),
  };
}

/** McpServerRecord has no error/status field beyond enabled/disabled today —
 * so this check is deliberately informational only, per the v1 scope of
 * "MCP server error status, if such status exists". It's kept as its own
 * check (rather than dropped) so the report has a placeholder line ready
 * for once that status starts being tracked. */
async function checkMcpServers(workspaceId: string): Promise<HealthCheckResult> {
  const servers = await getDb().listMcpServersByWorkspace(workspaceId);
  if (servers.length === 0) {
    return { id: "mcp_servers", label: "MCP servers", status: "ok", detail: "None configured." };
  }
  const enabledCount = servers.filter((s) => s.enabled).length;
  return {
    id: "mcp_servers",
    label: "MCP servers",
    status: "ok",
    detail: `${servers.length} configured, ${enabledCount} enabled. (Per-server error status isn't tracked in the current schema — this only reflects enabled/disabled.)`,
  };
}

function formatReportMarkdown(
  checks: HealthCheckResult[],
  overallStatus: HealthStatus,
  generatedAt: Date,
): string {
  const lines = [
    `**Overall status:** ${STATUS_EMOJI[overallStatus]} ${overallStatus.toUpperCase()}`,
    `**Generated:** ${generatedAt.toISOString()}`,
    "",
    "| Check | Status | Detail |",
    "| --- | --- | --- |",
    ...checks.map(
      (c) => `| ${c.label} | ${STATUS_EMOJI[c.status]} ${c.status} | ${c.detail.replace(/\|/g, "\\|")} |`,
    ),
    "",
    "_Report only — no automatic fixes were applied (self-healing agent v1)._",
  ];
  return lines.join("\n");
}

/**
 * Runs every health check for one workspace and records the result as a
 * completed Task (ARCHITECTURE.md: tasks are the durable, UI-visible unit of
 * work) plus one audit log entry — deliberately the smallest existing
 * structures that already have a UI (Tasks board, audit log) rather than a
 * new "health" table/page. No check here ever mutates state; v1 is
 * report-only by design.
 */
export async function runHealthCheckForWorkspace(workspaceId: string): Promise<TaskRecord> {
  const db = getDb();
  const now = new Date();

  const checks = await Promise.all([
    checkFailedAgentRuns(workspaceId, now),
    checkStaleApprovals(workspaceId, now),
    checkFailedAutomations(workspaceId),
    checkMcpServers(workspaceId),
  ]);
  // The fact that the checks above completed at all already proves the
  // database is reachable — a synthetic "ok" line makes that explicit in
  // the report instead of leaving DB health implicit.
  checks.unshift({
    id: "database",
    label: "Database",
    status: "ok",
    detail: "Reachable.",
  });

  const overallStatus = checks.reduce<HealthStatus>((acc, c) => worseOf(acc, c.status), "ok");
  const issueCount = checks.filter((c) => c.status !== "ok").length;
  const report = formatReportMarkdown(checks, overallStatus, now);

  const task = await db.createTask({
    workspaceId,
    title: `Health report — ${now.toISOString().replace("T", " ").slice(0, 16)} UTC`,
    instruction:
      "Automated system health check (self-healing agent v1: checks and reports only, no automatic fixes).",
    status: "completed",
    priority: overallStatus === "error" ? "urgent" : overallStatus === "warning" ? "high" : "low",
    resultSummary: report,
    errorMessage:
      overallStatus === "ok" ? null : `Health check found ${issueCount} issue(s) — see report.`,
    startedAt: now,
    completedAt: now,
  });

  await db.createTaskEvent({
    taskId: task.id,
    workspaceId,
    kind: "completed",
    message: `Health check completed: ${overallStatus}`,
    payload: { overallStatus, checks: checks.map((c) => ({ id: c.id, status: c.status })) },
  });

  await logAudit({
    workspaceId,
    actor: "automation",
    toolLabel: "health_check",
    input: {},
    output: { overallStatus, issueCount },
    status: overallStatus === "error" ? "error" : "success",
  });

  return task;
}

/**
 * Sweeps every workspace once. Failures are caught per-workspace (mirrors
 * scheduler.ts's due-automation loop and knowledge-base.ts's sync loop) so
 * one broken workspace can't stop the rest from getting a report. If the
 * database itself is unreachable, nothing can be persisted — this is logged
 * to the console only, since there's nowhere to write a Task or audit entry.
 */
export async function runHealthChecksForAllWorkspaces(): Promise<void> {
  const db = getDb();
  let workspaces: Awaited<ReturnType<typeof db.listWorkspaces>>;
  try {
    workspaces = await db.listWorkspaces();
  } catch (err) {
    console.error("Health check: database unreachable, skipping this cycle:", errorMessageOf(err));
    return;
  }

  for (const workspace of workspaces) {
    try {
      await runHealthCheckForWorkspace(workspace.id);
    } catch (err) {
      console.error(`Health check failed for workspace ${workspace.id}:`, errorMessageOf(err));
    }
  }
}

/** Starts the daily background sweep. Same shape as
 * knowledge-base.ts's startKnowledgeBaseSyncLoop — a plain unref'd interval,
 * not a new job-queue dependency (ADR-0010 applies here too). */
export function startHealthCheckLoop(): () => void {
  const kickoff = setTimeout(() => {
    void runHealthChecksForAllWorkspaces();
  }, HEALTH_CHECK_STARTUP_DELAY_MS);
  const timer = setInterval(() => {
    void runHealthChecksForAllWorkspaces();
  }, HEALTH_CHECK_INTERVAL_MS);

  if (typeof kickoff.unref === "function") kickoff.unref();
  if (typeof timer.unref === "function") timer.unref();

  return () => {
    clearTimeout(kickoff);
    clearInterval(timer);
  };
}
