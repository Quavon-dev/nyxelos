import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { DbRepository } from "@nyxel/db";
import { getDb } from "@nyxel/db";
import { createTestUser, installTestDb } from "@nyxel/db/test-utils";
import {
  type GoalPlan,
  getGoalOverview,
  reviewDueGoals,
  runGoalOrchestration,
  startOrchestration,
} from "./goal-orchestrator";

// A fixed, deterministic plan — never calls a model, keeping these tests
// hermetic (see ADR-0018: defaultGoalPlanner is injectable for exactly this
// reason).
const FAKE_PLAN: GoalPlan = {
  successCriteria: ["Ship the thing"],
  milestones: [
    {
      title: "Milestone A",
      tasks: [{ title: "Task A1", instruction: "Do the first thing." }],
    },
    {
      title: "Milestone B",
      tasks: [{ title: "Task B1", instruction: "Do the second thing." }],
    },
  ],
};
const fakePlanner = async (): Promise<GoalPlan> => FAKE_PLAN;

async function seedWorkspace(db: DbRepository, path: string) {
  const user = createTestUser(path);
  const workspace = await db.createWorkspace({ userId: user.id, name: "Test workspace" });
  return { user, workspace };
}

async function seedAgent(db: DbRepository, workspaceId: string, name = "Worker") {
  return db.createAgent({
    workspaceId,
    name,
    modelId: "anthropic/claude-fake",
    autonomyLevel: "autonomous",
  });
}

let ctx: Awaited<ReturnType<typeof installTestDb>>;

beforeEach(async () => {
  ctx = await installTestDb();
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("goal creation to task tree", () => {
  it("generates milestones and tasks assigned to a suitable agent", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const agent = await seedAgent(db, workspace.id);

    const goal = await db.createGoal({ workspaceId: workspace.id, title: "Launch feature X" });
    const result = await startOrchestration(goal.id, fakePlanner);

    expect(result.goal.planGeneratedAt).not.toBeNull();
    expect(result.goal.orchestrationEnabled).toBe(true);

    const milestones = await db.listMilestonesByGoal(goal.id);
    expect(milestones.map((m) => m.title).sort()).toEqual(["Milestone A", "Milestone B"]);

    const tasks = await db.listTasksByGoal(goal.id);
    expect(tasks).toHaveLength(2);
    for (const task of tasks) {
      expect(task.goalId).toBe(goal.id);
      expect(task.assignedAgentId).toBe(agent.id);
      expect(task.goalMilestoneId).not.toBeNull();
    }

    // Traceability: every automatic decision left both a goal-timeline
    // event and a workspace audit log entry.
    const events = await db.listGoalProgressEvents(goal.id);
    expect(events.some((e) => e.kind === "plan_created")).toBe(true);
    expect(events.some((e) => e.kind === "task_created")).toBe(true);

    const audit = await db.listAuditLogByWorkspace(workspace.id);
    expect(
      audit.some((a) => a.actor === "goal_orchestrator" && a.toolLabel === "goal.plan_created"),
    ).toBe(true);

    // Re-running orchestration must not re-plan (planGeneratedAt guards it).
    const before = await db.listTasksByGoal(goal.id);
    await runGoalOrchestration(goal.id, { trigger: "manual", planner: fakePlanner });
    const after = await db.listTasksByGoal(goal.id);
    expect(after).toHaveLength(before.length);
  });

  it("stays a pure record until orchestration is explicitly enabled", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const goal = await db.createGoal({ workspaceId: workspace.id, title: "Just a record" });

    const result = await runGoalOrchestration(goal.id, { trigger: "manual", planner: fakePlanner });
    expect(result.action).toBe("no_change");
    expect(await db.listTasksByGoal(goal.id)).toHaveLength(0);
  });
});

describe("blocked goal on approval / missing agent", () => {
  it("marks the goal blocked when a generated task is waiting on approval", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const agent = await seedAgent(db, workspace.id);
    const goal = await db.createGoal({ workspaceId: workspace.id, title: "Needs a human" });

    // Skip planning and seed the task tree directly so this test exercises
    // evaluation/status-transition logic without depending on real agent
    // execution (no network calls).
    await db.updateGoal(goal.id, {
      orchestrationEnabled: true,
      planGeneratedAt: new Date(),
    });
    const task = await db.createTask({
      workspaceId: workspace.id,
      goalId: goal.id,
      assignedAgentId: agent.id,
      title: "Delete production data",
      instruction: "irrelevant",
      status: "waiting_approval",
    });

    const result = await runGoalOrchestration(goal.id, { trigger: "manual" });
    expect(result.action).toBe("blocked");
    expect(result.goal.status).toBe("blocked");
    expect(result.goal.blockedReason).toContain(task.title);

    const overview = await getGoalOverview(goal.id);
    expect(overview?.blockers).toHaveLength(1);
    expect(overview?.blockers[0]?.taskId).toBe(task.id);
    expect(overview?.nextAction).toContain("approval");

    const audit = await db.listAuditLogByWorkspace(workspace.id);
    expect(
      audit.some((a) => a.actor === "goal_orchestrator" && a.toolLabel === "goal.blocked"),
    ).toBe(true);

    // The orchestrator never resolves approvals itself — it only reflects
    // task state, so the approval request path (approvals.ts) is
    // untouched by anything here.
    expect(await db.listApprovalsByWorkspace(workspace.id)).toHaveLength(0);
  });

  it("blocks when no suitable (non-chat) agent exists in the workspace", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    // Only a chat-only agent exists — not eligible to run unattended tasks.
    await db.createAgent({
      workspaceId: workspace.id,
      name: "Chat only",
      modelId: "anthropic/claude-fake",
      autonomyLevel: "chat",
    });
    const goal = await db.createGoal({ workspaceId: workspace.id, title: "No worker available" });

    const result = await startOrchestration(goal.id, fakePlanner);
    expect(result.action).toBe("blocked");
    const tasks = await db.listTasksByGoal(goal.id);
    expect(tasks.every((t) => t.assignedAgentId === null && t.status === "pending")).toBe(true);
  });
});

describe("completed goal on success criteria met", () => {
  it("marks the goal completed once every generated task finishes", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const agent = await seedAgent(db, workspace.id);
    const goal = await db.createGoal({ workspaceId: workspace.id, title: "Small goal" });

    await db.updateGoal(goal.id, { orchestrationEnabled: true, planGeneratedAt: new Date() });
    const milestone = await db.addMilestone({
      goalId: goal.id,
      workspaceId: workspace.id,
      title: "Only milestone",
    });
    await db.createTask({
      workspaceId: workspace.id,
      goalId: goal.id,
      goalMilestoneId: milestone.id,
      assignedAgentId: agent.id,
      title: "Finish it",
      instruction: "irrelevant",
      status: "completed",
      completedAt: new Date(),
    });

    const result = await runGoalOrchestration(goal.id, { trigger: "manual" });
    expect(result.action).toBe("completed");
    expect(result.goal.status).toBe("completed");

    const updatedMilestone = await db.getMilestone(milestone.id);
    expect(updatedMilestone?.status).toBe("completed");

    const events = await db.listGoalProgressEvents(goal.id);
    expect(events.some((e) => e.kind === "status_changed" && e.message.includes("completed"))).toBe(
      true,
    );

    const audit = await db.listAuditLogByWorkspace(workspace.id);
    expect(
      audit.some((a) => a.actor === "goal_orchestrator" && a.toolLabel === "goal.completed"),
    ).toBe(true);

    // A completed goal is a terminal state — re-review takes no action.
    const again = await runGoalOrchestration(goal.id, { trigger: "manual" });
    expect(again.action).toBe("no_change");
  });
});

describe("no cross-workspace access", () => {
  it("never assigns an agent from a different workspace, even if configured as defaultAgentId", async () => {
    const db = getDb();
    const { workspace: workspaceA } = await seedWorkspace(db, ctx.path);
    const { workspace: workspaceB } = await seedWorkspace(db, ctx.path);
    const agentInB = await seedAgent(db, workspaceB.id, "Agent in B");

    const goalInA = await db.createGoal({
      workspaceId: workspaceA.id,
      title: "Goal in workspace A",
      defaultAgentId: agentInB.id,
    });

    const result = await startOrchestration(goalInA.id, fakePlanner);
    const tasks = await db.listTasksByGoal(goalInA.id);
    // The cross-workspace defaultAgentId must never be used — falls back
    // to "no suitable agent" since workspace A has no agent of its own.
    expect(tasks.every((t) => t.assignedAgentId !== agentInB.id)).toBe(true);
    expect(result.action).toBe("blocked");

    // And nothing generated for goal A ever touches workspace B's data.
    for (const task of tasks) {
      expect(task.workspaceId).toBe(workspaceA.id);
    }
    expect(await db.listTasksByGoal(goalInA.id)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ workspaceId: workspaceB.id })]),
    );
    expect(await db.listGoalsByWorkspace(workspaceB.id)).toHaveLength(0);
  });
});

describe("scheduler-triggered goal review", () => {
  it("reviews only goals due for review, leaving others untouched", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    await seedAgent(db, workspace.id);

    const dueGoal = await db.createGoal({ workspaceId: workspace.id, title: "Due for review" });
    await db.updateGoal(dueGoal.id, {
      orchestrationEnabled: true,
      nextReviewAt: new Date(Date.now() - 60_000),
    });

    const futureGoal = await db.createGoal({ workspaceId: workspace.id, title: "Not due yet" });
    await db.updateGoal(futureGoal.id, {
      orchestrationEnabled: true,
      planGeneratedAt: new Date(),
      nextReviewAt: new Date(Date.now() + 60 * 60_000),
    });

    const disabledGoal = await db.createGoal({
      workspaceId: workspace.id,
      title: "Orchestration off",
    });

    const reviewed = await reviewDueGoals(new Date());
    const reviewedIds = reviewed.map((g) => g.id);

    expect(reviewedIds).toContain(dueGoal.id);
    expect(reviewedIds).not.toContain(futureGoal.id);
    expect(reviewedIds).not.toContain(disabledGoal.id);

    const reviewedDueGoal = await db.getGoal(dueGoal.id);
    expect(reviewedDueGoal?.lastReviewedAt).not.toBeNull();
    expect(reviewedDueGoal?.nextReviewAt?.getTime() ?? 0).toBeGreaterThan(Date.now());

    const untouchedFutureGoal = await db.getGoal(futureGoal.id);
    expect(untouchedFutureGoal?.lastReviewedAt).toBeNull();

    const events = await db.listGoalProgressEvents(dueGoal.id);
    expect(events.some((e) => e.kind === "review")).toBe(true);
  });
});
