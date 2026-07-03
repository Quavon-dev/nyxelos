import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentRecord, ApprovalRequestRecord, DbRepository, McpServerRecord } from "@nyxel/db";
import { DEFAULT_CHAT_TOOL_POLICY, getDb } from "@nyxel/db";
import { createTestUser, installTestDb } from "@nyxel/db/test-utils";
import { resolveApprovalDecision } from "./approvals";
import { mcpManager } from "./mcp-runtime";
import { buildToolsForAgent, toolPolicyForAutonomyLevel } from "./tools";

/**
 * End-to-end regression tests for the approval gate (ADR-0009/ADR-0017).
 * `buildToolsForAgent` (tools.ts) is the single choke point every one of the
 * production call sites below routes sensitive tool calls through — these
 * tests exercise the exact `ctx` shape and `chatToolPolicy` each site
 * actually passes in, so a regression in any of them is caught here without
 * needing a real model round-trip (which none of these call sites need to
 * decide *whether* to defer — that decision happens purely from ctx/policy,
 * before the tool ever runs):
 *
 * - chat:                 routes/chat-stream.ts → chatToolPolicy: chat.toolPolicy (DEFAULT_CHAT_TOOL_POLICY)
 * - autonomous task:      agent-runtime.ts's runDirectExecution → chatToolPolicy: toolPolicyForAutonomyLevel(agent.autonomyLevel)
 * - scheduled automation: scheduler.ts's runAgentAutomation → executeManagedTask → same runDirectExecution path, ctx.automationId set
 * - workflow agent node:  workflow-runner.ts's runAgentNode → executeManagedTask → same runDirectExecution path (trigger "task")
 * - super-agent delegation: delegation.ts's buildDelegateToAgentTool → executeManagedTask (trigger "delegate") → same runDirectExecution path
 *
 * All five funnel through `toolPolicyForAutonomyLevel`/`chat.toolPolicy` +
 * `buildToolsForAgent` identically, so exercising that function directly
 * with each site's real ctx shape and autonomy level covers all of them.
 */

let ctx: Awaited<ReturnType<typeof installTestDb>>;
let db: DbRepository;
let workDir: string;

beforeEach(async () => {
  ctx = await installTestDb();
  db = getDb();
  workDir = await mkdtemp(path.join(tmpdir(), "approval-gate-"));
});

afterEach(async () => {
  await ctx.cleanup();
  await rm(workDir, { recursive: true, force: true });
});

async function seedWorkspace() {
  const user = createTestUser(ctx.path);
  const workspace = await db.createWorkspace({ userId: user.id, name: "Approval gate test" });
  return workspace;
}

async function seedAgent(
  workspaceId: string,
  autonomyLevel: AgentRecord["autonomyLevel"],
  overrides: Partial<Parameters<DbRepository["createAgent"]>[0]> = {},
) {
  return db.createAgent({
    workspaceId,
    name: `Agent (${autonomyLevel})`,
    modelId: "anthropic/claude-fake",
    autonomyLevel,
    ...overrides,
  });
}

async function seedTool(
  workspaceId: string,
  kind: Parameters<DbRepository["createTool"]>[0]["kind"],
  config: Record<string, unknown> = {},
) {
  return db.createTool({
    workspaceId,
    name: `Test ${kind}`,
    description: `Test tool of kind ${kind}`,
    kind,
    config,
    sensitive: true,
    enabled: true,
  });
}

/** Every sensitive-tool-kind call in these tests goes through the exact
 * same `execute()` closure production tool calls use. `buildToolsForAgent`
 * always adds a few tools of its own (run_workflow, and — for
 * super_agent/auto-assistant agents — the workspace management set), so this
 * picks the seeded tool out by its distinctive description rather than
 * assuming it's the only one in the built ToolSet. */
function toolByDescription(
  tools: Awaited<ReturnType<typeof buildToolsForAgent>>,
  description: string,
) {
  const match = Object.values(tools).find((t) => t.description === description);
  if (!match?.execute) throw new Error(`No tool found with description "${description}"`);
  return match.execute as (input: unknown, opts: unknown) => Promise<unknown>;
}

async function pendingApprovals(workspaceId: string): Promise<ApprovalRequestRecord[]> {
  return db.listApprovalsByWorkspace(workspaceId, "pending");
}

/** approvalRequest.taskId/agentRunId are real foreign keys — a literal
 * placeholder string would fail at insert time, so every test that attaches
 * an approval to a task/run needs a genuine row to point at. */
async function seedTaskRun(workspaceId: string, agentId: string) {
  const task = await db.createTask({
    workspaceId,
    assignedAgentId: agentId,
    title: "Approval gate test task",
    instruction: "do the thing",
    status: "running",
  });
  const run = await db.createAgentRun({
    workspaceId,
    taskId: task.id,
    agentId,
    trigger: "task",
    status: "running",
  });
  return { task, run };
}

describe("approval gate — always-gated tool kinds survive every autonomy level", () => {
  const ALWAYS_GATED: Array<Parameters<DbRepository["createTool"]>[0]["kind"]> = [
    "terminal_run",
    "custom_code",
    "file_delete",
  ];

  for (const autonomyLevel of ["assisted", "autonomous", "super_agent"] as const) {
    for (const kind of ALWAYS_GATED) {
      it(`defers "${kind}" for a "${autonomyLevel}" agent instead of running it directly`, async () => {
        const workspace = await seedWorkspace();
        const filePath = path.join(workDir, "must-not-be-touched.txt");
        await writeFile(filePath, "original", "utf-8");
        const config =
          kind === "file_delete" || kind === "custom_code"
            ? { allowedDirs: [workDir], code: "return 1;" }
            : {};
        const tool = await seedTool(workspace.id, kind, config);
        const agent = await seedAgent(workspace.id, autonomyLevel, { toolIds: [tool.id] });
        const { task, run } = await seedTaskRun(workspace.id, agent.id);

        // Mirrors exactly what agent-runtime.ts's runDirectExecution passes
        // for a task/automation/delegate/workflow-agent-node run.
        const tools = await buildToolsForAgent(agent, {
          taskId: task.id,
          agentRunId: run.id,
          chatToolPolicy: toolPolicyForAutonomyLevel(agent.autonomyLevel),
        });
        const execute = toolByDescription(tools, tool.description);
        const result = (await execute(kind === "file_delete" ? { path: filePath } : {}, {
          toolCallId: "call-1",
          messages: [],
        })) as { status: string; approvalId: string };

        expect(result.status).toBe("pending_approval");
        expect(result.approvalId).toBeTruthy();

        const pending = await pendingApprovals(workspace.id);
        expect(pending.length).toBe(1);
        expect(pending[0]?.toolLabel).toBe(tool.id);

        // The real action must never have run.
        expect(await readFile(filePath, "utf-8")).toBe("original");
      });
    }
  }

  it("defers terminal_run even for a live chat turn under the default policy", async () => {
    const workspace = await seedWorkspace();
    const tool = await seedTool(workspace.id, "terminal_run");
    const agent = await seedAgent(workspace.id, "assisted", { toolIds: [tool.id] });
    const chat = await db.createChat({
      workspaceId: workspace.id,
      workingDirectory: workDir,
      title: "Test chat",
      modelId: agent.modelId,
      agentId: agent.id,
    });

    // Mirrors routes/chat-stream.ts: a live chat always uses the chat's own
    // stored toolPolicy (DEFAULT_CHAT_TOOL_POLICY unless the user relaxed it).
    const tools = await buildToolsForAgent(agent, {
      chatId: chat.id,
      chatToolPolicy: DEFAULT_CHAT_TOOL_POLICY,
    });
    const execute = toolByDescription(tools, tool.description);
    const result = (await execute({}, { toolCallId: "call-1", messages: [] })) as {
      status: string;
    };

    expect(result.status).toBe("pending_approval");
    expect((await pendingApprovals(workspace.id)).length).toBe(1);
  });
});

describe("approval gate — MCP tools", () => {
  function fakeMcpServer(workspaceId: string, id: string): McpServerRecord {
    return {
      id,
      workspaceId,
      name: "Fake MCP",
      transport: "http",
      command: null,
      args: null,
      url: "https://mcp.example.test",
      env: null,
      oauthState: null,
      enabled: true,
      createdAt: new Date(),
    };
  }

  const originalIsConnected = mcpManager.isConnected.bind(mcpManager);
  const originalConnect = mcpManager.connect.bind(mcpManager);
  const originalListTools = mcpManager.listTools.bind(mcpManager);
  const originalCallTool = mcpManager.callTool.bind(mcpManager);
  let callToolInvocations = 0;

  beforeEach(() => {
    callToolInvocations = 0;
    mcpManager.isConnected = () => true;
    mcpManager.connect = async () => {};
    mcpManager.listTools = async () => [
      {
        serverId: "mcp-1",
        serverName: "Fake MCP",
        name: "send_payment",
        description: "Sends a payment.",
        inputSchema: { type: "object", properties: {} },
      },
    ];
    mcpManager.callTool = async () => {
      callToolInvocations++;
      return { ok: true };
    };
  });

  afterEach(() => {
    mcpManager.isConnected = originalIsConnected;
    mcpManager.connect = originalConnect;
    mcpManager.listTools = originalListTools;
    mcpManager.callTool = originalCallTool;
  });

  it("gates an MCP tool call for a default-policy (assisted/chat) agent", async () => {
    const workspace = await seedWorkspace();
    const server = await db.createMcpServer(fakeMcpServer(workspace.id, "mcp-1"));
    const agent = await seedAgent(workspace.id, "assisted", { mcpServerIds: [server.id] });
    const { task, run } = await seedTaskRun(workspace.id, agent.id);

    const tools = await buildToolsForAgent(agent, {
      taskId: task.id,
      agentRunId: run.id,
      chatToolPolicy: toolPolicyForAutonomyLevel(agent.autonomyLevel),
    });
    const execute = toolByDescription(tools, "Sends a payment.");
    const result = (await execute({}, { toolCallId: "call-1", messages: [] })) as {
      status: string;
    };

    expect(result.status).toBe("pending_approval");
    expect(callToolInvocations).toBe(0);
  });

  it("a fully-autonomous agent's own risk threshold still gates a medium-risk MCP call", async () => {
    const workspace = await seedWorkspace();
    const server = await db.createMcpServer(fakeMcpServer(workspace.id, "mcp-1"));
    // "auto" mode alone would let this run unattended (MCP calls are outside
    // ALWAYS_REQUIRES_APPROVAL_KINDS by design — full autonomy is meant to
    // cover MCP tools the user already vetted at connection time) — but an
    // agent whose autonomy budget sets requiresApprovalAboveRisk can still
    // force approval on top of that, which is what this test guards.
    const agent = await seedAgent(workspace.id, "autonomous", {
      mcpServerIds: [server.id],
      autonomyBudget: {
        maxToolCallsPerRun: null,
        maxRuntimeMinutes: null,
        maxEstimatedCostUsd: null,
        maxFileWritesPerRun: null,
        allowedToolKinds: null,
        blockedToolKinds: null,
        requiresApprovalAboveRisk: "medium",
      },
    });
    const { task, run } = await seedTaskRun(workspace.id, agent.id);

    const tools = await buildToolsForAgent(agent, {
      taskId: task.id,
      agentRunId: run.id,
      chatToolPolicy: toolPolicyForAutonomyLevel(agent.autonomyLevel),
    });
    const execute = toolByDescription(tools, "Sends a payment.");
    const result = (await execute({}, { toolCallId: "call-1", messages: [] })) as {
      status: string;
    };

    expect(result.status).toBe("pending_approval");
    expect(callToolInvocations).toBe(0);
  });

  it("without a risk threshold, a fully-autonomous agent's MCP call runs unattended (documented, intended behavior)", async () => {
    const workspace = await seedWorkspace();
    const server = await db.createMcpServer(fakeMcpServer(workspace.id, "mcp-1"));
    const agent = await seedAgent(workspace.id, "autonomous", { mcpServerIds: [server.id] });
    const { task, run } = await seedTaskRun(workspace.id, agent.id);

    const tools = await buildToolsForAgent(agent, {
      taskId: task.id,
      agentRunId: run.id,
      chatToolPolicy: toolPolicyForAutonomyLevel(agent.autonomyLevel),
    });
    const execute = toolByDescription(tools, "Sends a payment.");
    const result = (await execute({}, { toolCallId: "call-1", messages: [] })) as {
      ok: boolean;
    };

    expect(result.ok).toBe(true);
    expect(callToolInvocations).toBe(1);
  });
});

describe("approval gate — reject prevents execution, approve resumes safely", () => {
  it("rejecting a pending file_delete never deletes the file and cannot be re-resolved", async () => {
    const workspace = await seedWorkspace();
    const filePath = path.join(workDir, "keep-me.txt");
    await writeFile(filePath, "keep", "utf-8");
    const tool = await seedTool(workspace.id, "file_delete", { allowedDirs: [workDir] });
    const agent = await seedAgent(workspace.id, "autonomous", { toolIds: [tool.id] });
    const { task, run } = await seedTaskRun(workspace.id, agent.id);

    const tools = await buildToolsForAgent(agent, {
      taskId: task.id,
      agentRunId: run.id,
      chatToolPolicy: toolPolicyForAutonomyLevel(agent.autonomyLevel),
    });
    const execute = toolByDescription(tools, tool.description);
    const deferred = (await execute(
      { path: filePath },
      { toolCallId: "call-1", messages: [] },
    )) as { approvalId: string };

    const resolved = await resolveApprovalDecision(deferred.approvalId, "rejected");
    expect(resolved.status).toBe("rejected");
    expect(await readFile(filePath, "utf-8")).toBe("keep");

    // A resolved approval can't be resolved again — no double-execution via
    // a replayed approve/reject call.
    await expect(resolveApprovalDecision(deferred.approvalId, "approved")).rejects.toThrow(
      /already/,
    );
    expect(await readFile(filePath, "utf-8")).toBe("keep");
  });

  it("approving a pending file_delete actually deletes the file exactly once", async () => {
    const workspace = await seedWorkspace();
    const filePath = path.join(workDir, "delete-me.txt");
    await writeFile(filePath, "bye", "utf-8");
    const tool = await seedTool(workspace.id, "file_delete", { allowedDirs: [workDir] });
    const agent = await seedAgent(workspace.id, "autonomous", { toolIds: [tool.id] });
    const { task, run } = await seedTaskRun(workspace.id, agent.id);

    const tools = await buildToolsForAgent(agent, {
      taskId: task.id,
      agentRunId: run.id,
      chatToolPolicy: toolPolicyForAutonomyLevel(agent.autonomyLevel),
    });
    const execute = toolByDescription(tools, tool.description);
    const deferred = (await execute(
      { path: filePath },
      { toolCallId: "call-1", messages: [] },
    )) as { approvalId: string };

    const resolved = await resolveApprovalDecision(deferred.approvalId, "approved");
    expect(resolved.status).toBe("approved");
    await expect(readFile(filePath, "utf-8")).rejects.toThrow();

    // Re-approving/rejecting an already-approved request must not run it
    // again (or throw trying to re-delete an already-deleted file).
    await expect(resolveApprovalDecision(deferred.approvalId, "rejected")).rejects.toThrow(
      /already/,
    );
  });

  it("rejecting a task-attached approval blocks the task instead of silently continuing", async () => {
    const workspace = await seedWorkspace();
    const tool = await seedTool(workspace.id, "custom_code", { code: "return 1;" });
    const agent = await seedAgent(workspace.id, "autonomous", { toolIds: [tool.id] });
    const task = await db.createTask({
      workspaceId: workspace.id,
      assignedAgentId: agent.id,
      title: "Run custom code",
      instruction: "do it",
      status: "running",
    });
    const run = await db.createAgentRun({
      workspaceId: workspace.id,
      taskId: task.id,
      agentId: agent.id,
      trigger: "task",
      status: "waiting_approval",
    });

    const tools = await buildToolsForAgent(agent, {
      taskId: task.id,
      agentRunId: run.id,
      chatToolPolicy: toolPolicyForAutonomyLevel(agent.autonomyLevel),
    });
    const execute = toolByDescription(tools, tool.description);
    const deferred = (await execute({}, { toolCallId: "call-1", messages: [] })) as {
      approvalId: string;
    };

    await resolveApprovalDecision(deferred.approvalId, "rejected");

    const updatedTask = await db.getTask(task.id);
    expect(updatedTask?.status).toBe("blocked");
    const updatedRun = await db.getAgentRun(run.id);
    expect(updatedRun?.status).toBe("failed");
  });
});
