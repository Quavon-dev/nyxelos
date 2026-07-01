import type { ApprovalRequestRecord } from "@nyxel/db";
import { getDb } from "@nyxel/db";
import { logAudit } from "./audit";
import { ensureMcpServerConnected, mcpManager } from "./mcp-runtime";
import { skillRegistry } from "./skills-registry";

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
  if (approval.status !== "pending") {
    throw new Error(`Approval request ${id} was already ${approval.status}.`);
  }

  if (decision === "rejected") {
    const updated = await db.resolveApprovalRequest({ id, status: "rejected" });
    await logAudit({
      workspaceId: approval.workspaceId,
      agentId: approval.agentId,
      chatId: approval.chatId,
      automationId: approval.automationId,
      actor: "approval",
      toolLabel: approval.toolLabel,
      input: approval.input,
      status: "rejected",
    });
    return updated;
  }

  try {
    let output: unknown;
    if (approval.kind === "skill") {
      if (!approval.skillId) throw new Error("Approval request is missing skillId.");
      output = await skillRegistry.run(approval.skillId, approval.input);
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
    });
    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const updated = await db.resolveApprovalRequest({
      id,
      status: "approved",
      errorMessage: message,
    });
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
    });
    return updated;
  }
}
