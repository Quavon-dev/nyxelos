import type { AutomationRecord } from "@nyxel/db";
import { getDb } from "@nyxel/db";
import { streamChat } from "@nyxel/model-providers";
import { CronExpressionParser } from "cron-parser";
import { logAudit } from "./audit";
import { buildToolsForAgent } from "./tools";

const POLL_INTERVAL_MS = 30_000;

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
export async function runAutomation(automation: AutomationRecord): Promise<void> {
  const db = getDb();
  const agent = await db.getAgent(automation.agentId);
  if (!agent) {
    console.error(
      `Automation "${automation.name}" (${automation.id}) references a missing agent — disabling it.`,
    );
    await db.setAutomationEnabled(automation.id, false);
    return;
  }

  const workspace = await db.getWorkspace(automation.workspaceId);
  const systemPrompt =
    [workspace?.customInstructions, agent.systemPrompt].filter(Boolean).join("\n\n") || undefined;
  const tools = await buildToolsForAgent(agent, { automationId: automation.id });

  let outputText: string;
  let status: "success" | "error";
  try {
    const result = streamChat({
      modelId: agent.modelId,
      systemPrompt,
      tools,
      messages: [{ role: "user", content: automation.prompt }],
    });
    outputText = await result.text;
    status = "success";
  } catch (err) {
    outputText = err instanceof Error ? err.message : String(err);
    status = "error";
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
  const nextRunAt = computeNextRunAt(automation.cronExpression, now);
  await db.updateAutomationRun({ id: automation.id, lastRunAt: now, nextRunAt });
}

/**
 * Polls the automation table every 30s for enabled automations whose
 * nextRunAt has passed, and runs each one headlessly (one full completion,
 * no client attached to stream to — see runAutomation). A failing or
 * unexpectedly slow automation is caught and logged per-automation so it
 * can't take down the poll loop or block sibling automations from running.
 */
export function startScheduler(): () => void {
  const timer = setInterval(async () => {
    let due: AutomationRecord[];
    try {
      due = await getDb().listDueAutomations(new Date());
    } catch (err) {
      console.error("Scheduler: failed to query due automations:", err);
      return;
    }
    for (const automation of due) {
      try {
        await runAutomation(automation);
      } catch (err) {
        console.error(`Scheduler: automation "${automation.name}" (${automation.id}) failed:`, err);
      }
    }
  }, POLL_INTERVAL_MS);

  // Timers otherwise keep the process alive forever — unref lets a clean
  // shutdown (e.g. in tests) exit without waiting on this interval.
  if (typeof timer.unref === "function") timer.unref();

  return () => clearInterval(timer);
}
