import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createTestSqliteRepository } from "../test-utils";
import type { DbRepository } from "./types";

/**
 * `claimTaskForRetry` — the atomic CAS backing `tasks.retry`
 * (apps/server/src/trpc/router.ts). A single conditional `UPDATE ... WHERE
 * status = 'failed'`, not a check-then-write, so two concurrent retry
 * requests for the same task can't both observe "failed" and each kick off
 * their own `executeManagedTask` call — see approvals.ts's
 * `claimApprovalRequest` for the same pattern applied to approvals.
 */

let ctx: Awaited<ReturnType<typeof createTestSqliteRepository>>;
let db: DbRepository;

beforeEach(async () => {
  ctx = await createTestSqliteRepository();
  db = ctx.db;
});

afterEach(async () => {
  await ctx.cleanup();
});

async function seedFailedTask() {
  const user = await db.getOrCreateDemoUser();
  const workspace = await db.createWorkspace({ userId: user.id, name: "Test workspace" });
  const agent = await db.createAgent({
    workspaceId: workspace.id,
    name: "Worker",
    modelId: "anthropic/claude-fake",
  });
  const task = await db.createTask({
    workspaceId: workspace.id,
    assignedAgentId: agent.id,
    title: "Retry me",
    instruction: "Do the thing.",
    status: "ready",
  });
  return db.updateTask(task.id, {
    status: "failed",
    startedAt: new Date(),
    completedAt: new Date(),
    errorMessage: "Something went wrong.",
  });
}

describe("claimTaskForRetry", () => {
  it("reopens a failed task and clears its terminal fields", async () => {
    const task = await seedFailedTask();
    const claimed = await db.claimTaskForRetry(task.id);
    expect(claimed?.status).toBe("ready");
    expect(claimed?.completedAt).toBeNull();
    expect(claimed?.errorMessage).toBeNull();
    expect(claimed?.startedAt).not.toBeNull();
  });

  it("returns null (and leaves the task untouched) when the task isn't in failed status", async () => {
    const user = await db.getOrCreateDemoUser();
    const workspace = await db.createWorkspace({ userId: user.id, name: "Test workspace 2" });
    const agent = await db.createAgent({
      workspaceId: workspace.id,
      name: "Worker",
      modelId: "anthropic/claude-fake",
    });
    const task = await db.createTask({
      workspaceId: workspace.id,
      assignedAgentId: agent.id,
      title: "Not failed",
      instruction: "Do the thing.",
      status: "running",
    });

    const claimed = await db.claimTaskForRetry(task.id);
    expect(claimed).toBeNull();
    const reloaded = await db.getTask(task.id);
    expect(reloaded?.status).toBe("running");
  });

  it("only lets one of two concurrent retry claims for the same task succeed", async () => {
    const task = await seedFailedTask();
    const [first, second] = await Promise.all([
      db.claimTaskForRetry(task.id),
      db.claimTaskForRetry(task.id),
    ]);
    const successes = [first, second].filter((r) => r !== null);
    expect(successes).toHaveLength(1);
  });
});
