import {
  assertAgentRunTransitionAllowed,
  buildPermissionSnapshot,
  hashToolInput,
  permissionForSource,
  permissionForToolKind,
} from "@nyxel/core-agent-engine";
import type { ApprovalRequestRecord } from "@nyxel/db";
import { getDb } from "@nyxel/db";
import { createSkillContext } from "@nyxel/skills-sdk";
import { logAudit } from "./audit";
import { emitNyxelEvent } from "./event-bus";
import { NyxelEvent } from "./events";
import { ensureMcpServerConnected, mcpManager } from "./mcp-runtime";
import { resolveSkillDefinition } from "./skills-resolve";
import { resolveToolDefinition } from "./tools-resolve";

/** Same permission-snapshot enrichment tools.ts applies at defer time
 * (ADR-0017), computed here for the resolution side of the same
 * approval — a human decision, not a policy evaluation, hence the fixed
 * "human_approval" policyMode rather than the chat's actual policy. */
async function approvalPermissionFields(approval: ApprovalRequestRecord) {
  const db = getDb();
  const [agent, toolRecord] = await Promise.all([
    db.getAgent(approval.agentId),
    approval.kind === "tool" && approval.toolId ? db.getTool(approval.toolId) : null,
  ]);
  const category =
    approval.kind === "mcp"
      ? permissionForSource("mcp")
      : approval.kind === "tool"
        ? toolRecord
          ? permissionForToolKind(toolRecord.kind)
          : permissionForSource("skill")
        : permissionForSource("skill");
  return {
    inputHash: await hashToolInput(approval.input),
    permissionSnapshot: buildPermissionSnapshot({
      category,
      autonomyLevel: agent?.autonomyLevel ?? "unknown",
      policyMode: "human_approval",
      requiredApproval: true,
    }),
  };
}

/**
 * Writes an agentRun's status, skipping the write (instead of throwing) if
 * it would revive an already-terminal run (see run-transitions.ts) — e.g. a
 * late approval resolution racing a run that was independently cancelled or
 * that already failed for an unrelated reason. This is bookkeeping, not the
 * security boundary against double execution (that's `claimApprovalRequest`'s
 * atomic CAS below); it only keeps the run's terminal status from being
 * silently clobbered by a stale write, so it fails soft rather than
 * aborting the rest of `resolveApprovalDecision`'s own bookkeeping.
 */
async function updateAgentRunStatusGuarded(
  db: ReturnType<typeof getDb>,
  agentRunId: string,
  update: Parameters<ReturnType<typeof getDb>["updateAgentRun"]>[1],
): Promise<void> {
  const current = await db.getAgentRun(agentRunId);
  if (!current) return;
  if (update.status) {
    try {
      assertAgentRunTransitionAllowed(current.status, update.status);
    } catch {
      return;
    }
  }
  await db.updateAgentRun(agentRunId, update);
}

/**
 * Runs the real action behind a pending approval once a human decides on it.
 * See ADR-0009: the model's tool call already returned a "pending approval"
 * placeholder and moved on — this function is the other half of that
 * defer-and-resolve pattern, invoked from the approvals.approve/reject tRPC
 * mutations, not from inside any model generation.
 */
export async function resolveApprovalDecision(
  id: string,
  decision: "approved" | "rejected",
): Promise<ApprovalRequestRecord> {
  const db = getDb();
  const approval = await db.getApprovalRequest(id);
  if (!approval) throw new Error(`Unknown approval request: ${id}`);

  // Atomic compare-and-swap on the approval row itself: only one of two
  // concurrent resolve calls for the same id can win this update, since it's
  // a single conditional UPDATE (not a check-then-write race). The loser
  // gets null back and never reaches the action-execution code below.
  const claimed = await db.claimApprovalRequest({
    id,
    status: decision === "approved" ? "approved" : "rejected",
  });
  if (!claimed) {
    const current = await db.getApprovalRequest(id);
    throw new Error(`Approval request ${id} was already ${current?.status ?? approval.status}.`);
  }

  if (decision === "rejected") {
    const updated = claimed;
    if (approval.taskId) {
      await db.updateTask(approval.taskId, {
        status: "blocked",
        errorMessage: `Approval rejected for ${approval.toolLabel}.`,
      });
      await db.createTaskEvent({
        taskId: approval.taskId,
        workspaceId: approval.workspaceId,
        agentRunId: approval.agentRunId,
        agentId: approval.agentId,
        kind: "approval_resolved",
        message: `Approval rejected: ${approval.toolLabel}`,
        payload: { decision: "rejected" },
      });
    }
    if (approval.agentRunId) {
      await updateAgentRunStatusGuarded(db, approval.agentRunId, {
        status: "failed",
        errorMessage: `Approval rejected for ${approval.toolLabel}.`,
        completedAt: new Date(),
      });
    }
    await logAudit({
      workspaceId: approval.workspaceId,
      agentId: approval.agentId,
      chatId: approval.chatId,
      automationId: approval.automationId,
      actor: "approval",
      toolLabel: approval.toolLabel,
      input: approval.input,
      status: "rejected",
      ...(await approvalPermissionFields(approval)),
    });
    await emitNyxelEvent({
      workspaceId: approval.workspaceId,
      type: NyxelEvent.ApprovalResolved,
      entityType: "approval_request",
      entityId: approval.id,
      payload: { decision: "rejected", toolLabel: approval.toolLabel },
    });
    return updated;
  }

  try {
    let output: unknown;
    if (approval.kind === "skill") {
      if (!approval.skillId) throw new Error("Approval request is missing skillId.");
      const skill = await resolveSkillDefinition(approval.workspaceId, approval.skillId);
      if (!skill) throw new Error(`Skill no longer exists: ${approval.skillId}`);
      const parsedInput = skill.inputSchema.parse(approval.input);
      output = await skill.run(parsedInput, createSkillContext(skill.permissions));
    } else if (approval.kind === "tool") {
      if (!approval.toolId) throw new Error("Approval request is missing toolId.");
      const workspaceTool = await resolveToolDefinition(approval.workspaceId, approval.toolId);
      if (!workspaceTool)
        throw new Error(`Tool no longer exists or is disabled: ${approval.toolId}`);
      const parsedInput = workspaceTool.inputSchema.parse(approval.input);
      output = await workspaceTool.run(parsedInput, createSkillContext(workspaceTool.permissions));
    } else {
      if (!approval.mcpServerId || !approval.mcpToolName) {
        throw new Error("Approval request is missing its MCP server/tool.");
      }
      const server = await db.getMcpServer(approval.mcpServerId);
      if (!server) throw new Error(`MCP server no longer exists: ${approval.mcpServerId}`);
      await ensureMcpServerConnected(server);
      output = await mcpManager.callTool(server.id, approval.mcpToolName, approval.input);
    }

    const updated = await db.resolveApprovalRequest({
      id,
      status: "approved",
      resultOutput: output,
    });
    if (approval.taskId) {
      await db.updateTask(approval.taskId, {
        status: "ready",
        errorMessage: null,
      });
      await db.createTaskEvent({
        taskId: approval.taskId,
        workspaceId: approval.workspaceId,
        agentRunId: approval.agentRunId,
        agentId: approval.agentId,
        kind: "approval_resolved",
        message: `Approval approved: ${approval.toolLabel}`,
        payload: { decision: "approved" },
      });
    }
    if (approval.agentRunId) {
      await updateAgentRunStatusGuarded(db, approval.agentRunId, {
        status: "pending",
        errorMessage: null,
      });
    }
    await logAudit({
      workspaceId: approval.workspaceId,
      agentId: approval.agentId,
      chatId: approval.chatId,
      automationId: approval.automationId,
      actor: "approval",
      toolLabel: approval.toolLabel,
      input: approval.input,
      output,
      status: "success",
      ...(await approvalPermissionFields(approval)),
    });
    await emitNyxelEvent({
      workspaceId: approval.workspaceId,
      type: NyxelEvent.ApprovalResolved,
      entityType: "approval_request",
      entityId: approval.id,
      payload: { decision: "approved", toolLabel: approval.toolLabel },
    });
    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const updated = await db.resolveApprovalRequest({
      id,
      status: "approved",
      errorMessage: message,
    });
    if (approval.taskId) {
      await db.updateTask(approval.taskId, {
        status: "blocked",
        errorMessage: message,
      });
      await db.createTaskEvent({
        taskId: approval.taskId,
        workspaceId: approval.workspaceId,
        agentRunId: approval.agentRunId,
        agentId: approval.agentId,
        kind: "failed",
        message: `Approved action failed: ${approval.toolLabel}`,
        payload: { error: message },
      });
    }
    if (approval.agentRunId) {
      await updateAgentRunStatusGuarded(db, approval.agentRunId, {
        status: "failed",
        errorMessage: message,
        completedAt: new Date(),
      });
    }
    await logAudit({
      workspaceId: approval.workspaceId,
      agentId: approval.agentId,
      chatId: approval.chatId,
      automationId: approval.automationId,
      actor: "approval",
      toolLabel: approval.toolLabel,
      input: approval.input,
      output: { error: message },
      status: "error",
      ...(await approvalPermissionFields(approval)),
    });
    await emitNyxelEvent({
      workspaceId: approval.workspaceId,
      type: NyxelEvent.ApprovalResolved,
      entityType: "approval_request",
      entityId: approval.id,
      payload: { decision: "approved", toolLabel: approval.toolLabel, error: message },
    });
    return updated;
  }
}
