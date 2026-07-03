import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MAX_DELEGATION_DEPTH } from "@nyxel/core-agent-engine";
import type { ChatToolPolicy, DbRepository } from "@nyxel/db";
import { DEFAULT_CHAT_TOOL_POLICY, getDb } from "@nyxel/db";
import { createTestUser, installTestDb } from "@nyxel/db/test-utils";
import {
  buildChatScopedBuiltinSkill,
  buildToolsForAgent,
  shouldDeferToolForApproval,
} from "./tools";

function policy(overrides: Partial<ChatToolPolicy>): ChatToolPolicy {
  return {
    ...DEFAULT_CHAT_TOOL_POLICY,
    ...overrides,
    mode: overrides.mode ?? "automatic",
  };
}

describe("shouldDeferToolForApproval", () => {
  it("keeps default mode fully approval-gated for sensitive tools", () => {
    expect(
      shouldDeferToolForApproval(
        { kind: "tool", sensitive: true, toolKind: "file_write" },
        DEFAULT_CHAT_TOOL_POLICY,
      ),
    ).toBe(true);
    expect(shouldDeferToolForApproval({ kind: "mcp" }, DEFAULT_CHAT_TOOL_POLICY)).toBe(true);
  });

  it("lets automatic mode run writes when that guardrail is disabled", () => {
    expect(
      shouldDeferToolForApproval(
        { kind: "tool", sensitive: true, toolKind: "file_write" },
        policy({ approveFileWrites: false }),
      ),
    ).toBe(false);
  });

  it("still gates deletes when delete approval stays enabled", () => {
    expect(
      shouldDeferToolForApproval(
        { kind: "tool", sensitive: true, toolKind: "file_delete" },
        policy({ approveFileDeletes: true }),
      ),
    ).toBe(true);
  });

  it("lets AUTO mode run MCP tools when the MCP guardrail is disabled", () => {
    expect(
      shouldDeferToolForApproval({ kind: "mcp" }, policy({ mode: "auto", approveMcpTools: false })),
    ).toBe(false);
  });

  it("binds workspace file tools to the current chat working directory", () => {
    const tool = buildChatScopedBuiltinSkill("workspace_file_list", "/tmp/chat-root");
    expect(tool?.permissions.filesystem).toEqual(["/tmp/chat-root"]);
  });

  it("exposes patch editing as a chat-scoped workspace tool", () => {
    const tool = buildChatScopedBuiltinSkill("workspace_file_patch", "/tmp/chat-root");
    expect(tool?.id).toBe("workspace_file_patch");
    expect(tool?.permissions.filesystem).toEqual(["/tmp/chat-root"]);
  });
});

describe("buildToolsForAgent — delegate_to_agent depth gating", () => {
  let ctx: Awaited<ReturnType<typeof installTestDb>>;

  beforeEach(async () => {
    ctx = await installTestDb();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  async function seedSuperAgentWithDelegate(db: DbRepository) {
    const user = createTestUser(ctx.path);
    const workspace = await db.createWorkspace({ userId: user.id, name: "Test workspace" });
    const delegate = await db.createAgent({
      workspaceId: workspace.id,
      name: "Delegate",
      modelId: "anthropic/claude-fake",
      autonomyLevel: "chat",
    });
    const superAgent = await db.createAgent({
      workspaceId: workspace.id,
      name: "Super",
      modelId: "anthropic/claude-fake",
      autonomyLevel: "super_agent",
      delegateAgentIds: [delegate.id],
    });
    return superAgent;
  }

  it("exposes delegate_to_agent below the max delegation depth", async () => {
    const db = getDb();
    const superAgent = await seedSuperAgentWithDelegate(db);

    const tools = await buildToolsForAgent(superAgent, { delegationDepth: 0 });
    expect(tools.delegate_to_agent).toBeDefined();
  });

  it("hides delegate_to_agent once the max delegation depth is reached", async () => {
    const db = getDb();
    const superAgent = await seedSuperAgentWithDelegate(db);

    const tools = await buildToolsForAgent(superAgent, { delegationDepth: MAX_DELEGATION_DEPTH });
    expect(tools.delegate_to_agent).toBeUndefined();
  });
});
