import type { AuditActor, AuditStatus } from "@nyxel/db";
import { getDb } from "@nyxel/db";

/**
 * Writes one row to the audit log (ARCHITECTURE.md section 5: "every action
 * by every agent is logged"). Logging failures are swallowed — a broken
 * audit write should never take down the actual tool call or chat response
 * it's trying to record.
 */
export async function logAudit(input: {
  workspaceId: string;
  agentId?: string | null;
  chatId?: string | null;
  automationId?: string | null;
  actor: AuditActor;
  toolLabel: string;
  input?: unknown;
  output?: unknown;
  status: AuditStatus;
}): Promise<void> {
  try {
    await getDb().createAuditLog(input);
  } catch (err) {
    console.error("Failed to write audit log entry", err);
  }
}
