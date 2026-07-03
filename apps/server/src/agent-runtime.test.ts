import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AutonomyBudget, DbRepository } from "@nyxel/db";
import { DEFAULT_AUTONOMY_BUDGET, getDb } from "@nyxel/db";
import { createTestUser, installTestDb } from "@nyxel/db/test-utils";
import type {
  ChatStreamPart,
  ChatStreamResult,
  StreamChatInput,
  streamChat,
} from "@nyxel/model-providers";
import {
  __resetStreamChatImplForTests,
  __setStreamChatImplForTests,
  cancelAgentRun,
  executeManagedTask,
} from "./agent-runtime";
import { resolveApprovalDecision } from "./approvals";

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

/**
 * Mockable-model reliability tests. `__setStreamChatImplForTests` swaps the
 * single `streamChatImpl` reference agent-runtime.ts calls for every model
 * request (planning, direct execution, delegation synthesis/verifier) —
 * these tests never resolve a real model or spawn a local/cloud provider.
 *
 * `makeScriptedStreamChat` hands back a fake `streamChat` that consumes one
 * "turn" per call (falling back to the last turn once the script is
 * exhausted, since a retried attempt re-runs planning + execution from the
 * top). A turn can request real tool calls — the fake invokes the actual
 * `execute()` closure from the input's own `tools` (the same ToolSet
 * `buildToolsForAgent` builds, wired through approvals/budget/audit exactly
 * as production does), so approval-gate/budget behavior triggered by a tool
 * call is real, not simulated.
 */
interface ScriptedToolCall {
  /** Exact ToolSet key — use for skills with a stable id (e.g. builtin
   * skills like "get_current_time"). */
  toolName?: string;
  /** Resolves the ToolSet key by matching `description` instead — needed
   * for DB-backed workspace tools, whose key is derived from a random UUID
   * (sanitizeToolNamePart(tool.id) in tools.ts) that a test can't predict
   * ahead of time. */
  matchDescription?: string;
  input: unknown;
  toolCallId?: string;
}
interface ScriptedTurn {
  toolCalls?: ScriptedToolCall[];
  text?: string;
  throws?: unknown;
}

function makeScriptedStreamChat(turns: ScriptedTurn[]): typeof streamChat {
  let callIndex = -1;
  return ((input: StreamChatInput): ChatStreamResult => {
    callIndex++;
    const turn = turns[Math.min(callIndex, turns.length - 1)] ?? { text: "" };

    const materialized = (async (): Promise<{ parts: ChatStreamPart[]; text: string }> => {
      if (turn.throws) throw turn.throws;
      const parts: ChatStreamPart[] = [];
      for (const call of turn.toolCalls ?? []) {
        const resolvedName =
          call.toolName ??
          Object.entries(input.tools ?? {}).find(
            ([, def]) => def.description === call.matchDescription,
          )?.[0];
        if (!resolvedName) {
          throw new Error(
            `Scripted tool call matched no tool in the built ToolSet (toolName=${call.toolName}, matchDescription=${call.matchDescription}). Available: ${Object.keys(input.tools ?? {}).join(", ")}`,
          );
        }
        const toolCallId = call.toolCallId ?? `call-${callIndex}-${resolvedName}`;
        parts.push({ type: "tool-call", toolCallId, toolName: resolvedName, input: call.input });
        const toolDef = input.tools?.[resolvedName];
        const execute = toolDef?.execute as
          | ((input: unknown, opts: unknown) => Promise<unknown>)
          | undefined;
        if (execute) {
          try {
            const output = await execute(call.input, { toolCallId, messages: [] });
            parts.push({ type: "tool-result", toolCallId, toolName: resolvedName, output });
          } catch (err) {
            parts.push({ type: "tool-error", toolCallId, toolName: resolvedName, error: err });
          }
        }
      }
      if (turn.text) parts.push({ type: "text-delta", text: turn.text });
      const text = parts
        .filter(
          (p): p is Extract<ChatStreamPart, { type: "text-delta" }> => p.type === "text-delta",
        )
        .map((p) => p.text)
        .join("");
      input.onFinish?.({ text });
      return { parts, text };
    })();
    materialized.catch(() => {});

    async function* fullStream(): AsyncGenerator<ChatStreamPart> {
      const { parts } = await materialized;
      for (const part of parts) yield part;
    }
    async function* textStream(): AsyncGenerator<string> {
      const { parts } = await materialized;
      for (const part of parts) if (part.type === "text-delta") yield part.text;
    }

    // Every call constructs all three regardless of which one the caller
    // actually reads (planTask reads only `.text`, streamWithLiveUpdates
    // only `.fullStream`) — the unused one is otherwise a floating rejected
    // promise Bun reports as an unhandled rejection once `materialized`
    // rejects, even though the caller correctly awaits/handles the one it
    // does use.
    const text = materialized.then((m) => m.text);
    text.catch(() => {});
    return {
      fullStream: fullStream(),
      textStream: textStream(),
      text,
    };
  }) as typeof streamChat;
}

/** An AsyncIterable that never produces a value — only rejects once `hang`
 * does. A generator function would never reach a `yield`, which the linter
 * (rightly) flags as suspicious, so this builds the iterator protocol by
 * hand instead. */
function neverYieldingIterable<T>(hang: Promise<never>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<T>> {
          await hang;
          return { done: true, value: undefined as unknown as T };
        },
      };
    },
  };
}

/** A streamChat stand-in that never resolves on its own — only rejects once
 * the caller's abortSignal fires — for exercising cancellation mid-call. */
function makeHangingStreamChat(): typeof streamChat {
  return ((input: StreamChatInput): ChatStreamResult => {
    const hang = new Promise<never>((_resolve, reject) => {
      input.abortSignal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
    hang.catch(() => {});
    return {
      fullStream: neverYieldingIterable<ChatStreamPart>(hang),
      textStream: neverYieldingIterable<string>(hang),
      text: hang,
    };
  }) as typeof streamChat;
}

afterEach(() => {
  __resetStreamChatImplForTests();
});

describe("executeManagedTask — planning through completion (mocked model)", () => {
  it("runs planning then direct execution and lands the task/run completed", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const agent = await seedAgent(db, workspace.id);
    const task = await db.createTask({
      workspaceId: workspace.id,
      assignedAgentId: agent.id,
      title: "Simple task",
      instruction: "Say hello.",
      status: "ready",
    });

    __setStreamChatImplForTests(
      makeScriptedStreamChat([
        { text: "{}" }, // planning call — empty plan JSON, falls back to a default plan
        { text: "Hello there." }, // direct execution call
      ]),
    );

    const result = await executeManagedTask({ taskId: task.id, agent, trigger: "task" });

    expect(result.task.status).toBe("completed");
    expect(result.task.resultSummary).toBe("Hello there.");
    expect(result.run.status).toBe("completed");
    expect(result.output).toBe("Hello there.");
  });

  it("persists a real tool call the model makes to the task event timeline", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const agent = await seedAgent(db, workspace.id, {});
    await db.updateAgent(agent.id, { skillIds: ["get_current_time"] });
    const updatedAgent = await db.getAgent(agent.id);
    if (!updatedAgent) throw new Error("agent not found");
    const task = await db.createTask({
      workspaceId: workspace.id,
      assignedAgentId: updatedAgent.id,
      title: "Tool-calling task",
      instruction: "What time is it?",
      status: "ready",
    });

    __setStreamChatImplForTests(
      makeScriptedStreamChat([
        { text: "{}" },
        {
          toolCalls: [{ toolName: "get_current_time", input: {} }],
          text: "It's now.",
        },
      ]),
    );

    const result = await executeManagedTask({
      taskId: task.id,
      agent: updatedAgent,
      trigger: "task",
    });

    expect(result.task.status).toBe("completed");
    const events = await db.listTaskEvents(task.id);
    const toolEvent = events.find((e) => e.kind === "tool_called");
    expect(toolEvent).toBeDefined();
    expect(toolEvent?.payload).toMatchObject({ toolLabel: "get_current_time" });
  });
});

describe("executeManagedTask — approval pause / approve / reject (mocked model)", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "agent-runtime-approval-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  async function seedAgentWithDeleteTool(db: DbRepository, workspaceId: string) {
    const tool = await db.createTool({
      workspaceId,
      name: "Delete file",
      description: "Delete a file",
      kind: "file_delete",
      config: { allowedDirs: [workDir] },
      sensitive: true,
      enabled: true,
    });
    const agent = await seedAgent(db, workspaceId, {});
    await db.updateAgent(agent.id, { toolIds: [tool.id] });
    const updated = await db.getAgent(agent.id);
    if (!updated) throw new Error("agent not found");
    return { tool, agent: updated };
  }

  it("pauses the run waiting_approval when the model calls a sensitive tool, then resumes on approve", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const { tool, agent } = await seedAgentWithDeleteTool(db, workspace.id);
    const filePath = path.join(workDir, "delete-me.txt");
    await writeFile(filePath, "bye", "utf-8");
    const task = await db.createTask({
      workspaceId: workspace.id,
      assignedAgentId: agent.id,
      title: "Delete a file",
      instruction: `Delete ${filePath}`,
      status: "ready",
    });

    __setStreamChatImplForTests(
      makeScriptedStreamChat([
        { text: "{}" },
        {
          toolCalls: [{ matchDescription: tool.description, input: { path: filePath } }],
          text: "Requesting approval to delete the file.",
        },
      ]),
    );

    const result = await executeManagedTask({ taskId: task.id, agent, trigger: "task" });

    expect(result.task.status).toBe("waiting_approval");
    expect(result.run.status).toBe("waiting_approval");

    const approvals = await db.listApprovalsByWorkspace(workspace.id, "pending");
    expect(approvals).toHaveLength(1);
    const approval = approvals[0];
    if (!approval) throw new Error("approval not found");

    const resolved = await resolveApprovalDecision(approval.id, "approved");
    expect(resolved.status).toBe("approved");

    const finalTask = await db.getTask(task.id);
    expect(finalTask?.status).toBe("ready");
    const finalRun = await db.getAgentRun(result.run.id);
    expect(finalRun?.status).toBe("pending");
    await expect(Bun.file(filePath).text()).rejects.toThrow();
  });

  it("blocks the task and fails the run when the pending approval is rejected", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const { tool, agent } = await seedAgentWithDeleteTool(db, workspace.id);
    const filePath = path.join(workDir, "keep-me.txt");
    await writeFile(filePath, "keep", "utf-8");
    const task = await db.createTask({
      workspaceId: workspace.id,
      assignedAgentId: agent.id,
      title: "Delete a file",
      instruction: `Delete ${filePath}`,
      status: "ready",
    });

    __setStreamChatImplForTests(
      makeScriptedStreamChat([
        { text: "{}" },
        {
          toolCalls: [{ matchDescription: tool.description, input: { path: filePath } }],
          text: "Requesting approval to delete the file.",
        },
      ]),
    );

    const result = await executeManagedTask({ taskId: task.id, agent, trigger: "task" });
    const approvals = await db.listApprovalsByWorkspace(workspace.id, "pending");
    expect(approvals).toHaveLength(1);
    const approval = approvals[0];
    if (!approval) throw new Error("approval not found");

    await resolveApprovalDecision(approval.id, "rejected");

    const finalTask = await db.getTask(task.id);
    expect(finalTask?.status).toBe("blocked");
    const finalRun = await db.getAgentRun(result.run.id);
    expect(finalRun?.status).toBe("failed");
  });
});

describe("executeManagedTask — autonomy budget pause (mocked model)", () => {
  it("pauses the task blocked once the run's tool-call budget is exhausted mid-run", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const agent = await seedAgent(db, workspace.id, {
      autonomyBudget: { ...DEFAULT_AUTONOMY_BUDGET, maxToolCallsPerRun: 1 },
    });
    await db.updateAgent(agent.id, { skillIds: ["get_current_time"] });
    const updatedAgent = await db.getAgent(agent.id);
    if (!updatedAgent) throw new Error("agent not found");
    const task = await db.createTask({
      workspaceId: workspace.id,
      assignedAgentId: updatedAgent.id,
      title: "Two tool calls, budget of one",
      instruction: "Check the time twice.",
      status: "ready",
    });

    __setStreamChatImplForTests(
      makeScriptedStreamChat([
        { text: "{}" },
        {
          toolCalls: [
            { toolName: "get_current_time", input: {}, toolCallId: "call-1" },
            { toolName: "get_current_time", input: {}, toolCallId: "call-2" },
          ],
          text: "Checked twice.",
        },
      ]),
    );

    const result = await executeManagedTask({
      taskId: task.id,
      agent: updatedAgent,
      trigger: "task",
    });

    expect(result.task.status).toBe("blocked");
    expect(result.task.errorMessage).toContain("Autonomy budget exceeded");
  });
});

describe("executeManagedTask — transient retry and dead-letter (mocked model)", () => {
  it("retries a transient failure in place and succeeds on the next attempt", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const agent = await seedAgent(db, workspace.id);
    const task = await db.createTask({
      workspaceId: workspace.id,
      assignedAgentId: agent.id,
      title: "Flaky task",
      instruction: "Do the thing.",
      status: "ready",
    });

    __setStreamChatImplForTests(
      makeScriptedStreamChat([
        { text: "{}" }, // attempt 1 planning
        { throws: new Error("ECONNRESET") }, // attempt 1 execution — transient
        { text: "{}" }, // attempt 2 planning
        { text: "Succeeded on retry." }, // attempt 2 execution
      ]),
    );

    const result = await executeManagedTask({ taskId: task.id, agent, trigger: "task" });

    expect(result.task.status).toBe("completed");
    expect(result.run.retryCount).toBe(1);
  });

  it("lands in dead_letter once retries are exhausted on a persistently transient failure", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const agent = await seedAgent(db, workspace.id);
    const task = await db.createTask({
      workspaceId: workspace.id,
      assignedAgentId: agent.id,
      title: "Always-flaky task",
      instruction: "Do the thing.",
      status: "ready",
    });

    __setStreamChatImplForTests(
      makeScriptedStreamChat([{ text: "{}" }, { throws: new Error("ECONNRESET") }]),
    );

    await expect(executeManagedTask({ taskId: task.id, agent, trigger: "task" })).rejects.toThrow(
      "ECONNRESET",
    );

    const runs = await db.listAgentRunsByTask(task.id);
    expect(runs).toHaveLength(1);
    const deadLetterRun = runs[0];
    if (!deadLetterRun) throw new Error("run not found");
    expect(deadLetterRun.status).toBe("dead_letter");
    expect(deadLetterRun.retryCount).toBe(3);
    const finalTask = await db.getTask(task.id);
    expect(finalTask?.status).toBe("failed");
  }, 15_000);

  it("fails immediately (no retry) for a non-transient error", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const agent = await seedAgent(db, workspace.id);
    const task = await db.createTask({
      workspaceId: workspace.id,
      assignedAgentId: agent.id,
      title: "Broken task",
      instruction: "Do the thing.",
      status: "ready",
    });

    __setStreamChatImplForTests(
      makeScriptedStreamChat([{ text: "{}" }, { throws: new Error("bad prompt schema") }]),
    );

    await expect(executeManagedTask({ taskId: task.id, agent, trigger: "task" })).rejects.toThrow(
      "bad prompt schema",
    );

    const runs = await db.listAgentRunsByTask(task.id);
    const failedRun = runs[0];
    if (!failedRun) throw new Error("run not found");
    expect(failedRun.status).toBe("failed");
    expect(failedRun.retryCount).toBe(0);
  });
});

describe("executeManagedTask — cancellation (mocked model)", () => {
  it("cancels a run that's mid-model-call and lands task/run cancelled", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const agent = await seedAgent(db, workspace.id);
    const task = await db.createTask({
      workspaceId: workspace.id,
      assignedAgentId: agent.id,
      title: "Cancel me",
      instruction: "Do the thing.",
      status: "ready",
    });

    __setStreamChatImplForTests(makeHangingStreamChat());

    const execPromise = executeManagedTask({ taskId: task.id, agent, trigger: "task" });
    // Wait until the task has actually reached "planning" — runManagedTask
    // writes that status synchronously before calling the (hanging) model,
    // so this confirms the run is genuinely mid-call rather than racing its
    // own startup bookkeeping (which would otherwise clobber a cancellation
    // that landed before the "planning" write did).
    let run = null;
    for (let i = 0; i < 40 && !run; i++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      const currentTask = await db.getTask(task.id);
      if (currentTask?.status !== "planning") continue;
      const runs = await db.listAgentRunsByTask(task.id);
      run = runs[0] ?? null;
    }
    if (!run) throw new Error("run was never created");

    await cancelAgentRun(run.id);
    await execPromise;

    // cancelAgentRun's own writes are unconditional (once the task wasn't
    // already completed/cancelled) and are already awaited above — assert
    // against the persisted state rather than execPromise's return value,
    // which can race cancelAgentRun's DB writes and return a stale snapshot
    // read a moment before the cancellation itself committed.
    const finalTask = await db.getTask(task.id);
    const finalRun = await db.getAgentRun(run.id);
    expect(finalTask?.status).toBe("cancelled");
    expect(finalRun?.status).toBe("cancelled");
  });
});

describe("executeManagedTask — delegation depth limit and cycle prevention (mocked model)", () => {
  it("does not auto-delegate past the max delegation depth (delegate_to_agent hidden, planner's own auto-delegation skipped)", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const delegateAgent = await seedAgent(db, workspace.id);
    const managerAgent = await db.createAgent({
      workspaceId: workspace.id,
      name: "Manager",
      modelId: "anthropic/claude-fake",
      autonomyLevel: "super_agent",
      delegateAgentIds: [delegateAgent.id],
    });
    const task = await db.createTask({
      workspaceId: workspace.id,
      assignedAgentId: managerAgent.id,
      title: "Delegating task",
      instruction: "Delegate this out.",
      status: "ready",
    });

    __setStreamChatImplForTests(
      makeScriptedStreamChat([
        {
          text: JSON.stringify({
            goal: "delegate",
            steps: ["delegate"],
            delegationCandidates: [delegateAgent.id],
            delegationTasks: [{ agentId: delegateAgent.id, instruction: "do the sub-task" }],
          }),
        },
        { text: "Delegated." },
      ]),
    );

    // MAX_DELEGATION_DEPTH is 3 — starting a run already at that depth means
    // filterCyclicCandidates/canDelegateDeeper must refuse to go deeper, so
    // this falls back to direct execution instead of spawning a child run.
    const result = await executeManagedTask({
      taskId: task.id,
      agent: managerAgent,
      trigger: "task",
      delegationDepth: 3,
      delegationChain: ["ancestor-1", "ancestor-2", "ancestor-3"],
    });

    expect(result.task.status).toBe("completed");
    expect(result.output).toBe("Delegated.");
    const children = await db.listTaskTree(task.id);
    expect(children).toHaveLength(0);
  });

  it("drops a delegate candidate already in its own delegation chain (cycle prevention)", async () => {
    const db = getDb();
    const { workspace } = await seedWorkspace(db, ctx.path);
    const agentA = await db.createAgent({
      workspaceId: workspace.id,
      name: "Agent A",
      modelId: "anthropic/claude-fake",
      autonomyLevel: "super_agent",
    });
    await db.updateAgent(agentA.id, { delegateAgentIds: [agentA.id] });
    const updatedA = await db.getAgent(agentA.id);
    if (!updatedA) throw new Error("agent not found");
    const task = await db.createTask({
      workspaceId: workspace.id,
      assignedAgentId: updatedA.id,
      title: "Self-delegating task",
      instruction: "Delegate to yourself.",
      status: "ready",
    });

    __setStreamChatImplForTests(
      makeScriptedStreamChat([
        {
          text: JSON.stringify({
            goal: "delegate to self",
            steps: ["delegate"],
            delegationCandidates: [updatedA.id],
            delegationTasks: [{ agentId: updatedA.id, instruction: "do it" }],
          }),
        },
        { text: "Handled without delegating back to myself." },
      ]),
    );

    // agentA is already in its own delegation chain (it's delegating to
    // itself), so filterCyclicCandidates must drop it — the run falls back
    // to direct execution instead of an infinite delegate-to-self loop.
    const result = await executeManagedTask({
      taskId: task.id,
      agent: updatedA,
      trigger: "task",
      delegationDepth: 1,
      delegationChain: [updatedA.id],
    });

    expect(result.task.status).toBe("completed");
    expect(result.output).toBe("Handled without delegating back to myself.");
  });
});
