import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { DbRepository } from "@nyxel/db";
import { getDb } from "@nyxel/db";
import { createTestUser, installTestDb } from "@nyxel/db/test-utils";
import { checkStaleAgentRuns, runAutomation } from "./scheduler";

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

describe("checkStaleAgentRuns", () => {
  it("marks a run failed once its lease has expired with no live process renewing it", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const agent = await seedAgent(db, workspace.id);
    const task = await db.createTask({
      workspaceId: workspace.id,
      assignedAgentId: agent.id,
      title: "Stuck task",
      instruction: "Do the thing.",
      status: "running",
    });
    const run = await db.createAgentRun({
      workspaceId: workspace.id,
      taskId: task.id,
      agentId: agent.id,
      trigger: "task",
      status: "running",
      startedAt: new Date(),
      workerId: "dead-process",
      heartbeatAt: new Date(Date.now() - 10 * 60_000),
      leaseUntil: new Date(Date.now() - 5 * 60_000),
    });

    await checkStaleAgentRuns();

    const recoveredRun = await db.getAgentRun(run.id);
    expect(recoveredRun?.status).toBe("failed");
    expect(recoveredRun?.errorMessage).toContain("stale-run sweep");

    const recoveredTask = await db.getTask(task.id);
    expect(recoveredTask?.status).toBe("failed");
    expect(recoveredTask?.errorMessage).toContain("stale-run sweep");
  });

  it("recovers a run that never had a lease at all (pre-dates this feature)", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const agent = await seedAgent(db, workspace.id);
    const run = await db.createAgentRun({
      workspaceId: workspace.id,
      agentId: agent.id,
      trigger: "chat",
      status: "running",
      startedAt: new Date(),
    });

    await checkStaleAgentRuns();

    const recoveredRun = await db.getAgentRun(run.id);
    expect(recoveredRun?.status).toBe("failed");
  });

  it("leaves a run alone whose lease is still valid (owning process is alive)", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const agent = await seedAgent(db, workspace.id);
    const run = await db.createAgentRun({
      workspaceId: workspace.id,
      agentId: agent.id,
      trigger: "chat",
      status: "running",
      startedAt: new Date(),
      workerId: "alive-process",
      heartbeatAt: new Date(),
      leaseUntil: new Date(Date.now() + 60_000),
    });

    await checkStaleAgentRuns();

    const untouchedRun = await db.getAgentRun(run.id);
    expect(untouchedRun?.status).toBe("running");
  });

  it("does not touch runs that already completed", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const agent = await seedAgent(db, workspace.id);
    const run = await db.createAgentRun({
      workspaceId: workspace.id,
      agentId: agent.id,
      trigger: "chat",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      leaseUntil: new Date(Date.now() - 60_000),
    });

    await checkStaleAgentRuns();

    const stillCompleted = await db.getAgentRun(run.id);
    expect(stillCompleted?.status).toBe("completed");
  });
});

describe("runAutomation", () => {
  it("skips a concurrent dispatch of the same automation instead of running it twice", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const automation = await db.createAutomation({
      workspaceId: workspace.id,
      agentId: null,
      name: "No agent configured",
      triggerType: "cron",
      cronExpression: "* * * * *",
    });

    const [first, second] = await Promise.all([
      runAutomation(automation),
      runAutomation(automation),
    ]);

    const outputs = [first.output, second.output];
    expect(outputs).toContain("Skipped — a run for this automation is already in progress.");
    expect(outputs.filter((o) => o.includes("Agent missing"))).toHaveLength(1);
  });
});
