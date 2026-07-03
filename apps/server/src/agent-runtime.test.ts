import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { AutonomyBudget, DbRepository } from "@nyxel/db";
import { DEFAULT_AUTONOMY_BUDGET, getDb } from "@nyxel/db";
import { createTestUser, installTestDb } from "@nyxel/db/test-utils";
import { cancelAgentRun, executeManagedTask } from "./agent-runtime";

async function seedWorkspace(db: DbRepository, path: string) {
  const user = createTestUser(path);
  const workspace = await db.createWorkspace({ userId: user.id, name: "Test workspace" });
  return { user, workspace };
}

async function seedAgent(
  db: DbRepository,
  workspaceId: string,
  overrides: { modelId?: string; autonomyBudget?: AutonomyBudget } = {},
) {
  return db.createAgent({
    workspaceId,
    name: "Worker",
    modelId: overrides.modelId ?? "anthropic/claude-fake",
    autonomyLevel: "autonomous",
    autonomyBudget: overrides.autonomyBudget,
  });
}

let ctx: Awaited<ReturnType<typeof installTestDb>>;

beforeEach(async () => {
  ctx = await installTestDb();
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("cancelAgentRun", () => {
  it("marks the run cancelled in the DB even with no in-memory AbortController for it", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const agent = await seedAgent(db, workspace.id);
    const task = await db.createTask({
      workspaceId: workspace.id,
      assignedAgentId: agent.id,
      title: "Orphaned run's task",
      instruction: "Do the thing.",
      status: "running",
    });
    // Simulates a run whose owning process died/restarted: this test never
    // calls executeManagedTask, so there is no activeRunControllers entry
    // for this run in this process — cancelAgentRun must still succeed.
    const run = await db.createAgentRun({
      workspaceId: workspace.id,
      taskId: task.id,
      agentId: agent.id,
      trigger: "task",
      status: "running",
      startedAt: new Date(),
      workerId: "some-other-process",
    });

    const cancelled = await cancelAgentRun(run.id);

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelRequestedAt).not.toBeNull();
    expect(cancelled.completedAt).not.toBeNull();

    const persisted = await db.getAgentRun(run.id);
    expect(persisted?.status).toBe("cancelled");

    const cancelledTask = await db.getTask(task.id);
    expect(cancelledTask?.status).toBe("cancelled");
  });

  it("throws for an unknown run id", async () => {
    await expect(cancelAgentRun("does-not-exist")).rejects.toThrow("Unknown agent run");
  });
});

describe("executeManagedTask — cost budget preflight (Autonomy Budgets v1)", () => {
  it("blocks the run before ever calling the model when the projected cost exceeds maxEstimatedCostUsd", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    // A model that's actually in the price table ($3/$15 per million
    // in/out tokens) — the point is the budget itself blocks the call, not
    // that the model is unpriced.
    const agent = await seedAgent(db, workspace.id, {
      modelId: "anthropic/claude-sonnet-5",
      autonomyBudget: { ...DEFAULT_AUTONOMY_BUDGET, maxEstimatedCostUsd: 0.0001 },
    });
    const task = await db.createTask({
      workspaceId: workspace.id,
      assignedAgentId: agent.id,
      title: "Expensive task",
      instruction: "Write a very long report.",
      status: "ready",
    });

    // If the preflight didn't block, this would instead throw once the
    // model call actually reached the (fake, network-less) provider — it
    // resolving cleanly is itself proof the model was never called.
    const result = await executeManagedTask({ taskId: task.id, agent, trigger: "task" });

    expect(result.task.status).toBe("blocked");
    expect(result.task.errorMessage).toContain("Autonomy budget exceeded");
    expect(result.task.errorMessage).toContain("Estimated cost budget exceeded");
  });

  it("blocks the run when the model's price is unknown and a cost budget is set (fails closed on uncertainty)", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const agent = await seedAgent(db, workspace.id, {
      modelId: "anthropic/claude-fake", // not in the price table
      autonomyBudget: { ...DEFAULT_AUTONOMY_BUDGET, maxEstimatedCostUsd: 100 },
    });
    const task = await db.createTask({
      workspaceId: workspace.id,
      assignedAgentId: agent.id,
      title: "Unpriced-model task",
      instruction: "Do the thing.",
      status: "ready",
    });

    const result = await executeManagedTask({ taskId: task.id, agent, trigger: "task" });

    expect(result.task.status).toBe("blocked");
    expect(result.task.errorMessage).toContain("known price");
  });

  it("never blocks when the agent has no autonomy budget configured (existing-agent default)", async () => {
    // No budget set — resolveAutonomyBudget falls back to DEFAULT_AUTONOMY_BUDGET
    // (maxEstimatedCostUsd: null), so checkModelCallCostBudget must be a
    // no-op and the run proceeds to the (fake, erroring) model call as
    // before this feature existed.
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const agent = await seedAgent(db, workspace.id, { modelId: "anthropic/claude-fake" });
    const task = await db.createTask({
      workspaceId: workspace.id,
      assignedAgentId: agent.id,
      title: "No-budget task",
      instruction: "Do the thing.",
      status: "ready",
    });

    await expect(executeManagedTask({ taskId: task.id, agent, trigger: "task" })).rejects.toThrow();
  });
});
