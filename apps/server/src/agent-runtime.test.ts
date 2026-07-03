import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { DbRepository } from "@nyxel/db";
import { getDb } from "@nyxel/db";
import { createTestUser, installTestDb } from "@nyxel/db/test-utils";
import { cancelAgentRun } from "./agent-runtime";

async function seedWorkspace(db: DbRepository, path: string) {
  const user = createTestUser(path);
  const workspace = await db.createWorkspace({ userId: user.id, name: "Test workspace" });
  return { user, workspace };
}

async function seedAgent(db: DbRepository, workspaceId: string) {
  return db.createAgent({
    workspaceId,
    name: "Worker",
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
