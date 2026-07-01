import { promises as fs } from "node:fs";
import path from "node:path";
import type { AutomationRecord } from "@nyxel/db";
import { getDb } from "@nyxel/db";
import { CronExpressionParser } from "cron-parser";
import { executeManagedTask } from "./agent-runtime";
import { logAudit } from "./audit";
import { notifyWorkspaceOwner } from "./push";
import { runSeoAnalysis } from "./seo-analyzer";

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

/** Exported for automations.runNow — lets a user trigger a run immediately
 * without waiting for the schedule, e.g. to test a new automation. */
export async function runAutomation(
  automation: AutomationRecord,
): Promise<{ taskId: string; runId: string; output: string }> {
  const db = getDb();
  const agent = await db.getAgent(automation.agentId);
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
    await notifyWorkspaceOwner(automation.workspaceId, {
      title: "Automation failed",
      body: `"${automation.name}" failed: ${outputText.slice(0, 120)}`,
      url: `/workspace/${automation.workspaceId}/automations`,
      tag: `automation-${automation.id}`,
    });
  }

  await logAudit({
    workspaceId: automation.workspaceId,
    agentId: agent.id,
    automationId: automation.id,
    actor: "automation",
    toolLabel: "agent_run",
    input: { prompt: automation.prompt },
    output: outputText,
    status,
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
    lastRunStatus: status,
    lastErrorMessage: status === "error" ? outputText : null,
  });
  return { taskId: task.id, runId: runId ?? "", output: outputText };
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
      console.error(`Scheduler: SEO re-analysis for "${project.domain}" (${project.id}) failed:`, err);
    }
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
  }, POLL_INTERVAL_MS);

  // Timers otherwise keep the process alive forever — unref lets a clean
  // shutdown (e.g. in tests) exit without waiting on this interval.
  if (typeof timer.unref === "function") timer.unref();

  return () => clearInterval(timer);
}
