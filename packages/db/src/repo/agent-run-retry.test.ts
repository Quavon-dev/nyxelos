import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createTestSqliteRepository } from "../test-utils";
import type { DbRepository } from "./types";

/**
 * Durable execution (see apps/server/src/agent-runtime.ts) — retryCount/
 * maxRetries/nextRetryAt bookkeeping and the "dead_letter" terminal state
 * are new agentRun columns; this proves the repository round-trips them
 * correctly (defaults on create, partial updates, dead_letter as a valid
 * status) independent of the in-process retry loop that actually drives
 * them.
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

async function seedRun(
  overrides: { retryCount?: number; maxRetries?: number; nextRetryAt?: Date | null } = {},
) {
  const user = await db.getOrCreateDemoUser();
  const workspace = await db.createWorkspace({ userId: user.id, name: "Test workspace" });
  const agent = await db.createAgent({
    workspaceId: workspace.id,
    name: "Worker",
    modelId: "anthropic/claude-fake",
  });
  return db.createAgentRun({
    workspaceId: workspace.id,
    agentId: agent.id,
    trigger: "task",
    ...overrides,
  });
}

describe("agentRun retry/dead-letter fields", () => {
  it("defaults retryCount to 0 and maxRetries to 3 when not specified", async () => {
    const run = await seedRun();
    expect(run.retryCount).toBe(0);
    expect(run.maxRetries).toBe(3);
    expect(run.nextRetryAt).toBeNull();
  });

  it("accepts explicit retryCount/maxRetries/nextRetryAt on create", async () => {
    // SQLite's integer timestamp mode round-trips to second resolution, not
    // millisecond — compare at that granularity rather than exact getTime().
    const nextRetryAt = new Date(Date.now() + 60_000);
    const run = await seedRun({ retryCount: 1, maxRetries: 5, nextRetryAt });
    expect(run.retryCount).toBe(1);
    expect(run.maxRetries).toBe(5);
    expect(Math.floor((run.nextRetryAt?.getTime() ?? 0) / 1000)).toBe(
      Math.floor(nextRetryAt.getTime() / 1000),
    );
  });

  it("updates retryCount/nextRetryAt independently of other fields", async () => {
    const run = await seedRun();
    const nextRetryAt = new Date(Date.now() + 5_000);
    const updated = await db.updateAgentRun(run.id, { retryCount: 2, nextRetryAt });
    expect(updated.retryCount).toBe(2);
    expect(Math.floor((updated.nextRetryAt?.getTime() ?? 0) / 1000)).toBe(
      Math.floor(nextRetryAt.getTime() / 1000),
    );
    expect(updated.maxRetries).toBe(3);
  });

  it("accepts dead_letter as a terminal status", async () => {
    const run = await seedRun();
    const updated = await db.updateAgentRun(run.id, {
      status: "dead_letter",
      retryCount: 3,
      errorMessage: "Transient failure after 3 retries.",
    });
    expect(updated.status).toBe("dead_letter");
    const reloaded = await db.getAgentRun(run.id);
    expect(reloaded?.status).toBe("dead_letter");
  });

  it("does not surface a dead_letter run as active", async () => {
    const run = await seedRun();
    await db.updateAgentRun(run.id, { status: "dead_letter" });
    const active = await db.listActiveAgentRunsByWorkspace(run.workspaceId);
    expect(active.find((r) => r.id === run.id)).toBeUndefined();
  });
});
