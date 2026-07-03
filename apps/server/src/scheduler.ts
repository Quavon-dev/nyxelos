import { promises as fs } from "node:fs";
import path from "node:path";
import type { AutomationRecord } from "@nyxel/db";
import { getDb } from "@nyxel/db";
import { CronExpressionParser } from "cron-parser";
import { executeManagedTask } from "./agent-runtime";
import { logAudit } from "./audit";
import { emitNyxelEvent } from "./event-bus";
import { NyxelEvent } from "./events";
import { reviewDueGoals } from "./goal-orchestrator";
import { notifyWorkspaceOwner } from "./push";
import { runSeoAnalysis } from "./seo-analyzer";
import { runWorkflowAndWait } from "./workflow-runner";

const POLL_INTERVAL_MS = 30_000;
const REPO_ROOT = path.resolve(new URL("../../..", import.meta.url).pathname);

/**
 * Computes the next run time strictly after `from`. Used both when an
 * automation is created/re-enabled and after every run. See ADR-0010 for why
 * this is a DB-backed poll rather than a job queue.
 */
export function computeNextRunAt(cronExpression: string, from: Date): Date | null {
  try {
    const interval = CronExpressionParser.parse(cronExpression, { currentDate: from });
    return interval.next().toDate();
  } catch (err) {
    console.error(`Invalid cron expression "${cronExpression}":`, err);
    return null;
  }
}

/** Records the run outcome shared by both automation target kinds: audit
 * log entry, lastRunAt/nextRunAt/lastRunStatus bookkeeping on the
 * automation row, and (for cron) computing the following nextRunAt. */
async function finishAutomationRun(
  automation: AutomationRecord,
  outcome: {
    agentId?: string | null;
    toolLabel: string;
    auditInput: unknown;
    outputText: string;
    status: "success" | "error" | "pending_approval";
  },
): Promise<void> {
  const db = getDb();
  await logAudit({
    workspaceId: automation.workspaceId,
    agentId: outcome.agentId ?? null,
    automationId: automation.id,
    actor: "automation",
    toolLabel: outcome.toolLabel,
    input: outcome.auditInput,
    output: outcome.outputText,
    status: outcome.status,
  });

  const now = new Date();
  // File-watch automations have no cron schedule — computeNextRunAt would
  // reject an empty cronExpression anyway; they're re-triggered by the file
  // poll loop below, not by nextRunAt.
  const nextRunAt =
    automation.triggerType === "cron" ? computeNextRunAt(automation.cronExpression, now) : null;
  await db.updateAutomationRun({
    id: automation.id,
    lastRunAt: now,
    nextRunAt,
    lastRunStatus: outcome.status,
    lastErrorMessage: outcome.status === "error" ? outcome.outputText : null,
  });
}

async function runAgentAutomation(
  automation: AutomationRecord,
): Promise<{ taskId: string; runId: string; output: string }> {
  const db = getDb();
  const agent = automation.agentId ? await db.getAgent(automation.agentId) : null;
  if (!agent) {
    console.error(
      `Automation "${automation.name}" (${automation.id}) references a missing agent — disabling it.`,
    );
    await db.setAutomationEnabled(automation.id, false);
    return { taskId: "", runId: "", output: "Agent missing; automation disabled." };
  }

  const task = await db.createTask({
    workspaceId: automation.workspaceId,
    createdByAgentId: agent.id,
    assignedAgentId: agent.id,
    title: automation.name,
    instruction: automation.prompt,
    status: "ready",
    input: { triggerType: automation.triggerType, automationId: automation.id },
  });

  let outputText: string;
  let status: "success" | "error" | "pending_approval";
  let runId: string | null = null;
  try {
    const result = await executeManagedTask({
      taskId: task.id,
      agent,
      trigger: "automation",
      automationId: automation.id,
    });
    outputText = result.output;
    runId = result.run.id;
    status = outputText.includes("pending_approval") ? "pending_approval" : "success";
  } catch (err) {
    outputText = err instanceof Error ? err.message : String(err);
    await db.updateTask(task.id, {
      status: "failed",
      errorMessage: outputText,
      completedAt: new Date(),
    });
    status = "error";
    await emitNyxelEvent({
      workspaceId: automation.workspaceId,
      type: NyxelEvent.TaskFailed,
      entityType: "task",
      entityId: task.id,
      payload: { automationId: automation.id, agentId: agent.id, error: outputText },
    });
    await notifyWorkspaceOwner(automation.workspaceId, {
      title: "Automation failed",
      body: `"${automation.name}" failed: ${outputText.slice(0, 120)}`,
      url: `/workspace/${automation.workspaceId}/automations`,
      tag: `automation-${automation.id}`,
    });
  }

  await finishAutomationRun(automation, {
    agentId: agent.id,
    toolLabel: "agent_run",
    auditInput: { prompt: automation.prompt },
    outputText,
    status,
  });
  return { taskId: task.id, runId: runId ?? "", output: outputText };
}

async function runWorkflowAutomation(
  automation: AutomationRecord,
): Promise<{ taskId: string; runId: string; output: string }> {
  const db = getDb();
  if (!automation.workflowId) {
    console.error(
      `Automation "${automation.name}" (${automation.id}) has no workflow configured — disabling it.`,
    );
    await db.setAutomationEnabled(automation.id, false);
    return { taskId: "", runId: "", output: "Workflow missing; automation disabled." };
  }

  let outputText: string;
  let status: "success" | "error" | "pending_approval";
  let runId = "";
  try {
    const { run, nodes } = await runWorkflowAndWait(
      automation.workflowId,
      automation.workspaceId,
      "automation",
    );
    runId = run.id;
    const failedCount = nodes.filter((n) => n.status === "failed").length;
    status = run.status === "failed" ? "error" : "success";
    outputText =
      run.status === "completed"
        ? `Workflow run completed (${nodes.length} node(s)).`
        : `Workflow run ${run.status}${failedCount > 0 ? ` — ${failedCount} node(s) failed` : ""}.`;
    if (run.errorMessage) outputText += ` ${run.errorMessage}`;
    if (status === "error") {
      await notifyWorkspaceOwner(automation.workspaceId, {
        title: "Automation failed",
        body: `"${automation.name}" failed: ${outputText.slice(0, 120)}`,
        url: `/workspace/${automation.workspaceId}/automations`,
        tag: `automation-${automation.id}`,
      });
    }
  } catch (err) {
    outputText = err instanceof Error ? err.message : String(err);
    status = "error";
    await notifyWorkspaceOwner(automation.workspaceId, {
      title: "Automation failed",
      body: `"${automation.name}" failed: ${outputText.slice(0, 120)}`,
      url: `/workspace/${automation.workspaceId}/automations`,
      tag: `automation-${automation.id}`,
    });
  }

  await finishAutomationRun(automation, {
    toolLabel: "workflow_run",
    auditInput: { workflowId: automation.workflowId },
    outputText,
    status,
  });
  return { taskId: "", runId, output: outputText };
}

/** Exported for automations.runNow — lets a user trigger a run immediately
 * without waiting for the schedule, e.g. to test a new automation. Dispatches
 * on targetKind: "agent" (default, existing behavior) runs the automation's
 * prompt as an agent task; "workflow" runs a saved workflow graph to
 * completion instead — see ADR-0016. */
export async function runAutomation(
  automation: AutomationRecord,
): Promise<{ taskId: string; runId: string; output: string }> {
  await emitNyxelEvent({
    workspaceId: automation.workspaceId,
    type: NyxelEvent.AutomationTriggered,
    entityType: "automation",
    entityId: automation.id,
    payload: { triggerType: automation.triggerType, targetKind: automation.targetKind },
  });
  return automation.targetKind === "workflow"
    ? runWorkflowAutomation(automation)
    : runAgentAutomation(automation);
}

function resolveWatchPath(watchPath: string): string {
  return path.isAbsolute(watchPath) ? watchPath : path.resolve(REPO_ROOT, watchPath);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/** Recursively lists files under `rootDir` modified after `since` (or every
 * file, if `since` is null), optionally restricted to names ending in
 * `suffixFilter` (e.g. ".md"). Mirrors listRecentlyChangedFiles in
 * knowledge-base.ts but scoped to an arbitrary user-configured directory. */
async function listChangedFilesUnder(
  rootDir: string,
  suffixFilter: string | null,
  since: Date | null,
): Promise<string[]> {
  const changed: string[] = [];

  async function walk(currentDir: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      console.error(`File-watch automation: failed to read "${currentDir}":`, err);
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const absolute = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (suffixFilter && !entry.name.endsWith(suffixFilter)) continue;
      const stats = await fs.stat(absolute);
      if (!since || stats.mtime > since) {
        changed.push(path.relative(rootDir, absolute).replace(/\\/g, "/"));
      }
    }
  }

  if (await pathExists(rootDir)) await walk(rootDir);
  return changed.sort().slice(0, 50);
}

/**
 * Checks every enabled "file_watch" automation for changed files since its
 * last check. The first check after creation only records a baseline
 * timestamp rather than running immediately — otherwise every pre-existing
 * file in the watched directory would look "changed" the moment the
 * automation is created. See ADR-0013.
 */
async function checkFileWatchAutomations(): Promise<void> {
  const db = getDb();
  let automations: AutomationRecord[];
  try {
    automations = await db.listFileWatchAutomations();
  } catch (err) {
    console.error("Scheduler: failed to query file-watch automations:", err);
    return;
  }

  for (const automation of automations) {
    if (!automation.watchPath) continue;
    const checkedAt = new Date();
    try {
      const rootDir = resolveWatchPath(automation.watchPath);
      const changed = await listChangedFilesUnder(
        rootDir,
        automation.watchGlob || null,
        automation.lastWatchCheckAt,
      );

      if (automation.lastWatchCheckAt && changed.length > 0) {
        const prompt = [
          automation.prompt,
          "",
          `Files changed under "${automation.watchPath}" since the last check:`,
          ...changed.map((file) => `- ${file}`),
        ].join("\n");
        await runAutomation({ ...automation, prompt });
      }

      await db.setAutomationWatchCheckedAt(automation.id, checkedAt);
    } catch (err) {
      console.error(
        `Scheduler: file-watch automation "${automation.name}" (${automation.id}) failed:`,
        err,
      );
    }
  }
}

/**
 * Checks every SEO project with a recurring re-analysis schedule whose
 * nextReanalyzeAt has passed and re-runs the crawl+scan for it — a deliberate
 * poll separate from listDueAutomations since a crawl/scan isn't an agent
 * chat turn, so it doesn't belong in the automation table's agent-driven
 * model. Failures are caught per-project so one broken schedule can't stall
 * the others.
 */
async function checkDueSeoProjects(): Promise<void> {
  const db = getDb();
  let due: Awaited<ReturnType<typeof db.listDueSeoProjects>>;
  try {
    due = await db.listDueSeoProjects(new Date());
  } catch (err) {
    console.error("Scheduler: failed to query due SEO projects:", err);
    return;
  }
  for (const project of due) {
    try {
      await runSeoAnalysis(project.id);
      const now = new Date();
      const nextReanalyzeAt = project.reanalyzeCronExpression
        ? computeNextRunAt(project.reanalyzeCronExpression, now)
        : null;
      await db.updateSeoProject(project.id, { lastReanalyzeAt: now, nextReanalyzeAt });
    } catch (err) {
      console.error(
        `Scheduler: SEO re-analysis for "${project.domain}" (${project.id}) failed:`,
        err,
      );
    }
  }
}

/**
 * Recovers agent runs left stuck in "running" by a process that died or
 * restarted before it could mark them cancelled/completed/failed itself —
 * see apps/server/src/agent-runtime.ts's lease/heartbeat mechanism. A run
 * qualifies once its lease has expired (or it never had one, e.g. it
 * predates this feature) with no live process still renewing it. Marks the
 * run failed and, if its task is still in a run-owned state, marks the task
 * failed too so the Goal Orchestrator/task UI can react instead of the task
 * looking permanently stuck. Runs on every scheduler tick and once at
 * startup, so a crash is recovered within one tick rather than only once a
 * human notices.
 */
export async function checkStaleAgentRuns(): Promise<void> {
  const db = getDb();
  let staleRuns: Awaited<ReturnType<typeof db.listStaleRunningAgentRuns>>;
  try {
    staleRuns = await db.listStaleRunningAgentRuns(new Date());
  } catch (err) {
    console.error("Scheduler: failed to query stale agent runs:", err);
    return;
  }
  for (const run of staleRuns) {
    const reason =
      "Run lease expired — recovered by the stale-run sweep (owning process likely died).";
    try {
      await db.updateAgentRun(run.id, {
        status: "failed",
        errorMessage: reason,
        completedAt: new Date(),
      });
      if (run.taskId) {
        const task = await db.getTask(run.taskId);
        if (task && (task.status === "running" || task.status === "planning")) {
          await db.updateTask(run.taskId, {
            status: "failed",
            errorMessage: reason,
            completedAt: new Date(),
          });
          await db.createTaskEvent({
            taskId: run.taskId,
            workspaceId: run.workspaceId,
            agentRunId: run.id,
            agentId: run.agentId,
            kind: "failed",
            message: reason,
          });
        }
      }
      await emitNyxelEvent({
        workspaceId: run.workspaceId,
        type: NyxelEvent.AgentRunFailed,
        entityType: "agent_run",
        entityId: run.id,
        payload: { taskId: run.taskId, agentId: run.agentId, error: reason },
      });
    } catch (err) {
      console.error(`Scheduler: failed to recover stale agent run ${run.id}:`, err);
    }
  }
}

/**
 * Reviews every goal due for its periodic Goal Orchestrator check (ADR-0018)
 * — `orchestrationEnabled` goals whose `nextReviewAt` has passed. A separate
 * poll from `listDueAutomations` for the same reason `checkDueSeoProjects`
 * is: this isn't an agent chat turn, it's the orchestrator deciding whether
 * to start the next ready task, mark the goal blocked/unblocked, or complete
 * it. `reviewDueGoals` already isolates failures per-goal; this wrapper only
 * guards the initial due-query itself, same shape as `checkDueSeoProjects`.
 */
async function checkGoalsForReview(): Promise<void> {
  try {
    await reviewDueGoals(new Date());
  } catch (err) {
    console.error("Scheduler: failed to query goals due for review:", err);
  }
}

/**
 * Polls the automation table every 30s: cron automations whose nextRunAt has
 * passed run headlessly (one full completion, no client attached to stream
 * to — see runAutomation); file_watch automations are separately checked for
 * changed files under their configured directory. A failing or unexpectedly
 * slow automation is caught and logged per-automation so it can't take down
 * the poll loop or block sibling automations from running.
 */
export function startScheduler(): () => void {
  // Runs once immediately at startup (not just on the first 30s tick) so a
  // run orphaned by a crash/restart is recovered as soon as the server comes
  // back up, rather than sitting stuck for up to POLL_INTERVAL_MS.
  void checkStaleAgentRuns();

  const timer = setInterval(async () => {
    let due: AutomationRecord[];
    try {
      due = await getDb().listDueAutomations(new Date());
    } catch (err) {
      console.error("Scheduler: failed to query due automations:", err);
      due = [];
    }
    for (const automation of due) {
      try {
        await runAutomation(automation);
      } catch (err) {
        console.error(`Scheduler: automation "${automation.name}" (${automation.id}) failed:`, err);
      }
    }

    await checkFileWatchAutomations();
    await checkDueSeoProjects();
    await checkGoalsForReview();
    await checkStaleAgentRuns();
  }, POLL_INTERVAL_MS);

  // Timers otherwise keep the process alive forever — unref lets a clean
  // shutdown (e.g. in tests) exit without waiting on this interval.
  if (typeof timer.unref === "function") timer.unref();

  return () => clearInterval(timer);
}
