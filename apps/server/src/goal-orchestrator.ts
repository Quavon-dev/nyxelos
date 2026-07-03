import type {
  AgentRunRecord,
  GoalMilestoneRecord,
  GoalProgressEventRecord,
  GoalRecord,
  TaskPriority,
  TaskRecord,
} from "@nyxel/db";
import { getDb } from "@nyxel/db";
import { streamChat } from "@nyxel/model-providers";
import { startTaskExecutionIfIdle } from "./agent-runtime";
import { logAudit } from "./audit";
import { getInstalledProvidersForWorkspace } from "./models";
import { notifyWorkspaceOwner } from "./push";

/**
 * Goal Orchestrator (ADR-0018) — turns an opted-in goal (`orchestrationEnabled:
 * true`) into a real, monitored task tree: generates milestones/tasks once,
 * assigns them to an agent, kicks off ready tasks through the existing
 * managed-task path (never its own execution), and rolls task/run outcomes
 * back up into the goal's status. It never executes a tool itself, never
 * creates or resolves an approval, and never touches an agent's
 * AutonomyBudget — every safety gate that already exists for a task/agent
 * run (approvals.ts, autonomy-budget.ts, tools.ts) applies unchanged to
 * orchestrator-generated tasks.
 *
 * Every automatic decision writes two independent, cross-checkable trails:
 * a `goalProgressEvent` row (the goal's own timeline) and an `auditLog` row
 * with `actor: "goal_orchestrator"` (the workspace-wide audit log).
 */

const REVIEW_INTERVAL_MS = 15 * 60_000;

export interface GoalPlanTaskDraft {
  title: string;
  instruction: string;
  priority?: TaskPriority;
}

export interface GoalPlanMilestoneDraft {
  title: string;
  tasks: GoalPlanTaskDraft[];
}

export interface GoalPlan {
  successCriteria: string[];
  milestones: GoalPlanMilestoneDraft[];
}

export type GoalPlanner = (goal: GoalRecord) => Promise<GoalPlan>;

export interface GoalOrchestrationResult {
  goal: GoalRecord;
  action: "no_change" | "planned" | "progressed" | "blocked" | "unblocked" | "completed";
  detail: string;
}

export interface GoalOverview {
  goal: GoalRecord;
  milestones: GoalMilestoneRecord[];
  tasks: TaskRecord[];
  latestRun: AgentRunRecord | null;
  blockers: { taskId: string; title: string; reason: string }[];
  nextAction: string;
  progressEvents: GoalProgressEventRecord[];
}

// ---------------------------------------------------------------------------
// Plan generation
// ---------------------------------------------------------------------------

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
    try {
      return JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

/** Always produces at least one milestone/task, even if the model call
 * fails or returns garbage — a goal with orchestration enabled must never
 * end up with an empty, unrecoverable plan. */
function fallbackPlan(goal: GoalRecord): GoalPlan {
  return {
    successCriteria: goal.successCriteria ?? [],
    milestones: [
      {
        title: goal.title,
        tasks: [
          {
            title: goal.title,
            instruction: goal.description?.trim() || goal.title,
            priority: goal.priority,
          },
        ],
      },
    ],
  };
}

function toGoalPlan(goal: GoalRecord, raw: string): GoalPlan {
  const parsed = extractJsonObject(raw);
  const milestonesRaw = Array.isArray(parsed?.milestones) ? parsed.milestones : null;
  if (!milestonesRaw || milestonesRaw.length === 0) return fallbackPlan(goal);

  const milestones: GoalPlanMilestoneDraft[] = [];
  for (const entry of milestonesRaw) {
    if (typeof entry !== "object" || entry === null) continue;
    const title = typeof (entry as Record<string, unknown>).title === "string"
      ? ((entry as Record<string, unknown>).title as string)
      : null;
    const tasksRaw = Array.isArray((entry as Record<string, unknown>).tasks)
      ? ((entry as Record<string, unknown>).tasks as unknown[])
      : [];
    if (!title || tasksRaw.length === 0) continue;
    const tasks: GoalPlanTaskDraft[] = [];
    for (const taskEntry of tasksRaw) {
      if (typeof taskEntry !== "object" || taskEntry === null) continue;
      const taskTitle = typeof (taskEntry as Record<string, unknown>).title === "string"
        ? ((taskEntry as Record<string, unknown>).title as string)
        : null;
      const instruction =
        typeof (taskEntry as Record<string, unknown>).instruction === "string"
          ? ((taskEntry as Record<string, unknown>).instruction as string)
          : taskTitle;
      if (!taskTitle || !instruction) continue;
      tasks.push({ title: taskTitle, instruction });
    }
    if (tasks.length > 0) milestones.push({ title, tasks });
  }
  if (milestones.length === 0) return fallbackPlan(goal);

  const successCriteria = Array.isArray(parsed?.successCriteria)
    ? parsed.successCriteria.filter((c): c is string => typeof c === "string")
    : (goal.successCriteria ?? []);

  return { successCriteria, milestones };
}

/** One-shot JSON-only planning call against the workspace's default model —
 * same `streamChat` + brace-scanning-JSON-extraction pattern agent-runtime's
 * `planTask` uses for per-task plans, applied here at the goal level. Falls
 * back to a single-milestone/single-task plan (never throws) if no model is
 * configured or the call fails, so a goal is always plannable. */
export async function defaultGoalPlanner(goal: GoalRecord): Promise<GoalPlan> {
  const db = getDb();
  const workspace = await db.getWorkspace(goal.workspaceId);
  if (!workspace?.defaultModelId) return fallbackPlan(goal);

  try {
    const installedProviders = await getInstalledProvidersForWorkspace(goal.workspaceId);
    const prompt = [
      "Break this goal down into a compact execution plan.",
      "Return JSON only: { successCriteria: string[], milestones: [{ title: string, tasks: [{ title: string, instruction: string }] }] }.",
      "Keep it small — 1-4 milestones, 1-3 tasks each. Each task instruction must be self-contained (an agent will run it with no other context).",
      `Goal title: ${goal.title}`,
      `Goal description: ${goal.description?.trim() || "(none given)"}`,
      goal.successCriteria && goal.successCriteria.length > 0
        ? `Existing success criteria to keep: ${goal.successCriteria.join("; ")}`
        : "No success criteria given yet — propose some.",
    ].join("\n");
    const result = streamChat({
      modelId: workspace.defaultModelId,
      systemPrompt: "You are a planning assistant. Respond with JSON only, no prose.",
      installedProviders,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = await result.text;
    return toGoalPlan(goal, raw);
  } catch (err) {
    console.error(`Goal orchestrator: plan generation failed for goal ${goal.id}`, err);
    return fallbackPlan(goal);
  }
}

// ---------------------------------------------------------------------------
// Agent selection
// ---------------------------------------------------------------------------

function keywordOverlap(needle: string, haystack: string): number {
  if (!haystack.trim()) return 0;
  const words = (s: string) => new Set(s.split(/\W+/).filter((w) => w.length > 3));
  const a = words(needle);
  const b = words(haystack);
  let overlap = 0;
  for (const w of a) if (b.has(w)) overlap++;
  return overlap;
}

/** Picks the agent every task the orchestrator generates for this goal will
 * be assigned to. `goal.defaultAgentId` always wins if set (explicit user
 * choice). Otherwise: agents have no structured capability taxonomy today
 * (see ADR-0018's "Limitations"), so "suitable" falls back to (a) excluding
 * `autonomyLevel: "chat"` agents, which aren't built to run unattended
 * tasks, then (b) a best-effort keyword match between the goal's
 * title/description and each candidate's `role`/`goalTemplate` text.
 * Returns null if the workspace has no non-chat agent at all — the caller
 * treats that as a blocker, never as a reason to run tasks unassigned. */
export async function selectAgentForGoal(goal: GoalRecord): Promise<string | null> {
  const db = getDb();
  if (goal.defaultAgentId) {
    const agent = await db.getAgent(goal.defaultAgentId);
    if (agent && agent.workspaceId === goal.workspaceId) return agent.id;
  }

  const agents = await db.listAgentsByWorkspace(goal.workspaceId);
  const capable = agents.filter((a) => a.autonomyLevel !== "chat");
  if (capable.length === 0) return null;

  const needle = `${goal.title} ${goal.description ?? ""}`.toLowerCase();
  const scored = capable
    .map((agent) => ({
      agent,
      score: keywordOverlap(needle, `${agent.role ?? ""} ${agent.goalTemplate ?? ""}`.toLowerCase()),
    }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.agent.id ?? null;
}

// ---------------------------------------------------------------------------
// Progress evaluation
// ---------------------------------------------------------------------------

function describeBlocker(task: TaskRecord): string {
  if (task.status === "waiting_approval") {
    return `Waiting on human approval for task "${task.title}".`;
  }
  if (task.status === "pending" && !task.assignedAgentId) {
    return `Task "${task.title}" has no agent assigned.`;
  }
  if (task.status === "failed") {
    return `Task "${task.title}" failed${task.errorMessage ? `: ${task.errorMessage}` : "."}`;
  }
  const msg = task.errorMessage ?? "";
  if (/budget/i.test(msg)) {
    return `Autonomy budget exceeded on task "${task.title}".`;
  }
  if (/credential|api[ _-]?key|token|secret|not configured|unauthorized/i.test(msg)) {
    return `Task "${task.title}" looks blocked on missing credentials/configuration: ${msg}`;
  }
  return `Task "${task.title}" is blocked${msg ? `: ${msg}` : "."}`;
}

interface TaskEvaluation {
  completed: boolean;
  blockedReason: string | null;
  readyTaskIds: string[];
}

function evaluateTasks(tasks: TaskRecord[]): TaskEvaluation {
  if (tasks.length === 0) {
    return {
      completed: false,
      blockedReason: "No tasks have been generated for this goal yet.",
      readyTaskIds: [],
    };
  }
  const readyTaskIds = tasks
    .filter((t) => t.status === "ready" && !t.startedAt)
    .map((t) => t.id);
  const blocking = tasks.find(
    (t) =>
      t.status === "waiting_approval" ||
      t.status === "blocked" ||
      t.status === "failed" ||
      (t.status === "pending" && !t.assignedAgentId),
  );
  return {
    completed: tasks.every((t) => t.status === "completed"),
    blockedReason: blocking ? describeBlocker(blocking) : null,
    readyTaskIds,
  };
}

/** Marks a milestone completed the moment every task under it is — pure
 * progress reflection, not a decision the orchestrator "makes" (no audit
 * log entry, same as the milestone_status_changed event a human toggling a
 * milestone by hand already produces via the goals.updateMilestoneStatus
 * mutation). */
async function syncMilestoneProgress(goal: GoalRecord, tasks: TaskRecord[]): Promise<void> {
  const db = getDb();
  const milestoneIds = new Set(
    tasks.map((t) => t.goalMilestoneId).filter((id): id is string => Boolean(id)),
  );
  if (milestoneIds.size === 0) return;

  const milestones = await db.listMilestonesByGoal(goal.id);
  for (const milestone of milestones) {
    if (milestone.status === "completed" || !milestoneIds.has(milestone.id)) continue;
    const milestoneTasks = tasks.filter((t) => t.goalMilestoneId === milestone.id);
    if (milestoneTasks.length === 0 || !milestoneTasks.every((t) => t.status === "completed")) {
      continue;
    }
    await db.updateMilestoneStatus(milestone.id, "completed");
    await db.createGoalProgressEvent({
      goalId: goal.id,
      workspaceId: goal.workspaceId,
      kind: "milestone_status_changed",
      message: `Milestone "${milestone.title}" completed automatically — every task under it finished.`,
      payload: { milestoneId: milestone.id, status: "completed" },
    });
  }
}

// ---------------------------------------------------------------------------
// Plan → milestones/tasks
// ---------------------------------------------------------------------------

async function generatePlanAndTasks(goal: GoalRecord, planner: GoalPlanner): Promise<GoalRecord> {
  const db = getDb();
  const plan = await planner(goal);
  const agentId = await selectAgentForGoal(goal);

  let taskCount = 0;
  for (const milestoneDraft of plan.milestones) {
    const milestone = await db.addMilestone({
      goalId: goal.id,
      workspaceId: goal.workspaceId,
      title: milestoneDraft.title,
    });
    await db.createGoalProgressEvent({
      goalId: goal.id,
      workspaceId: goal.workspaceId,
      kind: "milestone_added",
      message: `Milestone added: ${milestone.title}`,
      payload: { milestoneId: milestone.id },
    });

    for (const taskDraft of milestoneDraft.tasks) {
      const task = await db.createTask({
        workspaceId: goal.workspaceId,
        goalId: goal.id,
        goalMilestoneId: milestone.id,
        assignedAgentId: agentId,
        title: taskDraft.title,
        instruction: taskDraft.instruction,
        priority: taskDraft.priority ?? goal.priority,
        status: agentId ? "ready" : "pending",
        input: { goalGenerated: true, goalId: goal.id },
      });
      taskCount++;
      await db.createTaskEvent({
        taskId: task.id,
        workspaceId: goal.workspaceId,
        agentId,
        kind: "created",
        message: `Task created by the Goal Orchestrator for "${goal.title}".`,
        payload: { goalId: goal.id, milestoneId: milestone.id },
      });
      if (agentId) {
        await db.createTaskEvent({
          taskId: task.id,
          workspaceId: goal.workspaceId,
          agentId,
          kind: "assigned",
          message: "Task assigned by the Goal Orchestrator.",
          payload: { assignedAgentId: agentId },
        });
      }
      await db.createGoalProgressEvent({
        goalId: goal.id,
        workspaceId: goal.workspaceId,
        kind: "task_created",
        message: `Task created: ${task.title}`,
        payload: { taskId: task.id, milestoneId: milestone.id, assignedAgentId: agentId },
      });
    }
  }

  const blockedReason = agentId
    ? null
    : "No suitable agent found in this workspace — set a default agent on the goal, or add an agent with autonomy above \"chat\".";
  const updated = await db.updateGoal(goal.id, {
    planGeneratedAt: new Date(),
    successCriteria: plan.successCriteria.length > 0 ? plan.successCriteria : goal.successCriteria,
    blockedReason,
  });

  await db.createGoalProgressEvent({
    goalId: goal.id,
    workspaceId: goal.workspaceId,
    kind: "plan_created",
    message: `Execution plan created: ${plan.milestones.length} milestone(s), ${taskCount} task(s).`,
    payload: { milestoneCount: plan.milestones.length, taskCount, assignedAgentId: agentId },
  });
  await logAudit({
    workspaceId: goal.workspaceId,
    actor: "goal_orchestrator",
    toolLabel: "goal.plan_created",
    input: { goalId: goal.id, title: goal.title },
    output: { milestoneCount: plan.milestones.length, taskCount, assignedAgentId: agentId },
    status: "success",
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Orchestration entry points
// ---------------------------------------------------------------------------

/**
 * Reviews one goal: generates its plan on first run (idempotent —
 * `planGeneratedAt` guards against ever re-planning), starts any ready
 * tasks, rolls task outcomes into milestone/goal status, and reschedules
 * the next review. Safe to call repeatedly (manual "review now", or the
 * scheduler's periodic poll) — every branch is read-then-conditionally-write,
 * nothing here re-runs completed work.
 */
export async function runGoalOrchestration(
  goalId: string,
  opts: { trigger: "manual" | "scheduler"; planner?: GoalPlanner } = { trigger: "manual" },
): Promise<GoalOrchestrationResult> {
  const db = getDb();
  const goal = await db.getGoal(goalId);
  if (!goal) throw new Error(`Unknown goal: ${goalId}`);

  if (!goal.orchestrationEnabled) {
    return { goal, action: "no_change", detail: "Orchestration is not enabled for this goal." };
  }
  // A manual pause or a terminal state always wins over the schedule — the
  // orchestrator never resumes a goal the user paused, and never touches a
  // goal that's already done.
  if (goal.status === "paused" || goal.status === "completed" || goal.status === "archived") {
    return {
      goal,
      action: "no_change",
      detail: `Goal is ${goal.status}; the orchestrator takes no action.`,
    };
  }

  let currentGoal = goal;
  if (!currentGoal.planGeneratedAt) {
    currentGoal = await generatePlanAndTasks(currentGoal, opts.planner ?? defaultGoalPlanner);
  }

  const tasks = await db.listTasksByGoal(currentGoal.id);
  await syncMilestoneProgress(currentGoal, tasks);
  const evaluation = evaluateTasks(tasks);

  if (evaluation.readyTaskIds.length > 0) {
    await Promise.all(
      evaluation.readyTaskIds.map((taskId) =>
        startTaskExecutionIfIdle({ taskId, trigger: "task" }).catch((err) => {
          console.error(
            `Goal orchestrator: failed to start task ${taskId} for goal ${currentGoal.id}`,
            err,
          );
        }),
      ),
    );
  }

  const now = new Date();
  let action: GoalOrchestrationResult["action"] = "progressed";
  let detail = `Reviewed ${tasks.length} task(s); started ${evaluation.readyTaskIds.length}.`;

  if (evaluation.completed) {
    action = "completed";
    detail = `All ${tasks.length} task(s) completed — success criteria met.`;
  } else if (evaluation.blockedReason) {
    action = "blocked";
    detail = evaluation.blockedReason;
  } else if (currentGoal.status === "blocked") {
    action = "unblocked";
    detail = "No blockers remain — resuming.";
  }

  let updated = await db.updateGoal(currentGoal.id, {
    lastReviewedAt: now,
    nextReviewAt: new Date(now.getTime() + REVIEW_INTERVAL_MS),
    blockedReason: action === "blocked" ? evaluation.blockedReason : null,
  });

  if (action === "completed" && updated.status !== "completed") {
    updated = await db.updateGoalStatus(updated.id, "completed");
    await db.createGoalProgressEvent({
      goalId: updated.id,
      workspaceId: updated.workspaceId,
      kind: "status_changed",
      message: "Goal marked completed — every generated task finished.",
      payload: { status: "completed" },
    });
    await logAudit({
      workspaceId: updated.workspaceId,
      actor: "goal_orchestrator",
      toolLabel: "goal.completed",
      input: { goalId: updated.id, trigger: opts.trigger },
      output: { taskCount: tasks.length },
      status: "success",
    });
    await notifyWorkspaceOwner(updated.workspaceId, {
      title: "Goal completed",
      body: updated.title,
      url: `/workspace/${updated.workspaceId}/goals/${updated.id}`,
      tag: `goal-${updated.id}`,
    });
  } else if (action === "blocked" && updated.status !== "blocked") {
    updated = await db.updateGoalStatus(updated.id, "blocked");
    await db.createGoalProgressEvent({
      goalId: updated.id,
      workspaceId: updated.workspaceId,
      kind: "status_changed",
      message: `Goal blocked: ${evaluation.blockedReason}`,
      payload: { status: "blocked", reason: evaluation.blockedReason },
    });
    await logAudit({
      workspaceId: updated.workspaceId,
      actor: "goal_orchestrator",
      toolLabel: "goal.blocked",
      input: { goalId: updated.id, trigger: opts.trigger },
      output: { reason: evaluation.blockedReason },
      status: "success",
    });
    await notifyWorkspaceOwner(updated.workspaceId, {
      title: "Goal blocked",
      body: `"${updated.title}": ${evaluation.blockedReason}`,
      url: `/workspace/${updated.workspaceId}/goals/${updated.id}`,
      tag: `goal-${updated.id}`,
    });
  } else if (action === "unblocked" && updated.status === "blocked") {
    updated = await db.updateGoalStatus(updated.id, "active");
    await db.createGoalProgressEvent({
      goalId: updated.id,
      workspaceId: updated.workspaceId,
      kind: "status_changed",
      message: "Goal unblocked — resuming.",
      payload: { status: "active" },
    });
    await logAudit({
      workspaceId: updated.workspaceId,
      actor: "goal_orchestrator",
      toolLabel: "goal.unblocked",
      input: { goalId: updated.id, trigger: opts.trigger },
      status: "success",
    });
  }

  await db.createGoalProgressEvent({
    goalId: updated.id,
    workspaceId: updated.workspaceId,
    kind: "review",
    message: detail,
    payload: {
      trigger: opts.trigger,
      taskCount: tasks.length,
      startedTaskCount: evaluation.readyTaskIds.length,
    },
  });
  await logAudit({
    workspaceId: updated.workspaceId,
    actor: "goal_orchestrator",
    toolLabel: "goal.review",
    input: { goalId: updated.id, trigger: opts.trigger },
    output: { action, taskCount: tasks.length },
    status: "success",
  });

  return { goal: updated, action, detail };
}

/** Turns orchestration on (idempotent) and runs an immediate review — the
 * single entry point the `goals.startOrchestration` tRPC mutation calls. */
export async function startOrchestration(
  goalId: string,
  planner?: GoalPlanner,
): Promise<GoalOrchestrationResult> {
  const db = getDb();
  const goal = await db.getGoal(goalId);
  if (!goal) throw new Error(`Unknown goal: ${goalId}`);

  if (!goal.orchestrationEnabled) {
    await db.updateGoal(goalId, { orchestrationEnabled: true, nextReviewAt: new Date() });
    await db.createGoalProgressEvent({
      goalId,
      workspaceId: goal.workspaceId,
      kind: "status_changed",
      message: "Orchestration enabled — the Goal Engine will plan and drive this goal.",
      payload: { orchestrationEnabled: true },
    });
    await logAudit({
      workspaceId: goal.workspaceId,
      actor: "goal_orchestrator",
      toolLabel: "goal.orchestration_enabled",
      input: { goalId },
      status: "success",
    });
  }
  return runGoalOrchestration(goalId, { trigger: "manual", planner });
}

/** Turns orchestration on/off without forcing an immediate review — used to
 * pause an in-flight goal (the orchestrator stops generating/starting new
 * work, but existing running tasks are left to finish on their own; nothing
 * here cancels a live agent run). */
export async function setOrchestrationEnabled(
  goalId: string,
  enabled: boolean,
): Promise<GoalRecord> {
  const db = getDb();
  const goal = await db.getGoal(goalId);
  if (!goal) throw new Error(`Unknown goal: ${goalId}`);

  const updated = await db.updateGoal(goalId, {
    orchestrationEnabled: enabled,
    nextReviewAt: enabled ? new Date() : null,
  });
  await db.createGoalProgressEvent({
    goalId,
    workspaceId: goal.workspaceId,
    kind: "status_changed",
    message: enabled ? "Orchestration enabled." : "Orchestration paused by user.",
    payload: { orchestrationEnabled: enabled },
  });
  await logAudit({
    workspaceId: goal.workspaceId,
    actor: "goal_orchestrator",
    toolLabel: enabled ? "goal.orchestration_enabled" : "goal.orchestration_disabled",
    input: { goalId },
    status: "success",
  });
  return updated;
}

/** Scheduler hook (see scheduler.ts's checkGoalsForReview) — reviews every
 * goal due for its periodic check. Per-goal failures are caught so one
 * broken goal can't stall the others, matching every other scheduler poll's
 * failure isolation (checkDueSeoProjects, checkFileWatchAutomations). */
export async function reviewDueGoals(now: Date = new Date()): Promise<GoalRecord[]> {
  const db = getDb();
  const due = await db.listGoalsDueForReview(now);
  const reviewed: GoalRecord[] = [];
  for (const goal of due) {
    try {
      const result = await runGoalOrchestration(goal.id, { trigger: "scheduler" });
      reviewed.push(result.goal);
    } catch (err) {
      console.error(`Goal orchestrator: scheduled review failed for goal ${goal.id}`, err);
    }
  }
  return reviewed;
}

// ---------------------------------------------------------------------------
// Read model for the goal detail page / tRPC overview procedure
// ---------------------------------------------------------------------------

export async function getGoalOverview(goalId: string): Promise<GoalOverview | null> {
  const db = getDb();
  const goal = await db.getGoal(goalId);
  if (!goal) return null;

  const [milestones, tasks, progressEvents] = await Promise.all([
    db.listMilestonesByGoal(goalId),
    db.listTasksByGoal(goalId),
    db.listGoalProgressEvents(goalId),
  ]);

  const runsByTask = await Promise.all(tasks.map((t) => db.listAgentRunsByTask(t.id)));
  const latestRun = runsByTask
    .flat()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;

  const evaluation = evaluateTasks(tasks);
  const blockers = tasks
    .filter(
      (t) =>
        t.status === "waiting_approval" ||
        t.status === "blocked" ||
        t.status === "failed" ||
        (t.status === "pending" && !t.assignedAgentId),
    )
    .map((t) => ({ taskId: t.id, title: t.title, reason: describeBlocker(t) }));

  const nextAction = !goal.orchestrationEnabled
    ? "Turn on orchestration to let the Goal Engine plan and run this goal."
    : goal.status === "completed"
      ? "Goal complete — nothing further to do."
      : goal.status === "archived"
        ? "Goal is archived."
        : goal.status === "paused"
          ? "Goal is paused — resume it to continue orchestration."
          : evaluation.blockedReason
            ? evaluation.blockedReason
            : evaluation.readyTaskIds.length > 0
              ? `${evaluation.readyTaskIds.length} task(s) about to start.`
              : tasks.length === 0
                ? "Waiting for the next scheduled review to generate a plan."
                : "In progress — waiting on running task(s).";

  return { goal, milestones, tasks, latestRun, blockers, nextAction, progressEvents };
}
