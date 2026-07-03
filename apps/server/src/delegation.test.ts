import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { DbRepository } from "@nyxel/db";
import { getDb } from "@nyxel/db";
import { createTestUser, installTestDb } from "@nyxel/db/test-utils";
import { buildDelegateToAgentTool } from "./delegation";

async function seedWorkspace(db: DbRepository, path: string) {
  const user = createTestUser(path);
  const workspace = await db.createWorkspace({ userId: user.id, name: "Test workspace" });
  return { user, workspace };
}

async function seedAgent(
  db: DbRepository,
  workspaceId: string,
  name: string,
  delegateAgentIds: string[] = [],
) {
  return db.createAgent({
    workspaceId,
    name,
    modelId: "anthropic/claude-fake",
    autonomyLevel: "super_agent",
    delegateAgentIds,
  });
}

let ctx: Awaited<ReturnType<typeof installTestDb>>;

beforeEach(async () => {
  ctx = await installTestDb();
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("buildDelegateToAgentTool — cycle and depth protection", () => {
  it("offers every whitelisted delegate when the chain is empty (top-level run)", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const b = await seedAgent(db, workspace.id, "B");
    const a = await seedAgent(db, workspace.id, "A", [b.id]);

    const t = await buildDelegateToAgentTool(a, {});
    expect(t).not.toBeNull();
  });

  it("drops a candidate already in the delegation chain (A -> B -> A cycle)", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const a = await seedAgent(db, workspace.id, "A");
    const b = await seedAgent(db, workspace.id, "B", [a.id]);
    // Close the loop after both exist.
    await db.updateAgent(a.id, { delegateAgentIds: [b.id] });
    const freshA = await db.getAgent(a.id);
    if (!freshA) throw new Error("agent A missing");

    // B is deciding who to delegate to, with A already in its own chain
    // (A delegated down to B to get here) — A must not be offered back.
    const toolForB = await buildDelegateToAgentTool(b, {
      delegationDepth: 1,
      delegationChain: [a.id],
    });
    expect(toolForB).toBeNull();
  });

  it("still offers a non-cyclic whitelisted delegate even while deep in an unrelated chain", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const c = await seedAgent(db, workspace.id, "C");
    const b = await seedAgent(db, workspace.id, "B", [c.id]);

    const toolForB = await buildDelegateToAgentTool(b, {
      delegationDepth: 1,
      delegationChain: ["some-other-ancestor"],
    });
    expect(toolForB).not.toBeNull();
  });
});
