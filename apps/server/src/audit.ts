import type { AuditActor, AuditStatus } from "@nyxel/db";
import { getDb } from "@nyxel/db";

const REDACTED = "[REDACTED]";

// Matched against a normalized (lowercased, non-alphanumeric stripped) key,
// so "API-Key", "apiKey", "access_token", "Authorization" all match despite
// different casing/separator conventions across tool schemas.
const SECRET_KEY_SUBSTRINGS = ["apikey", "token", "authorization", "password", "secret", "cookie"];

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SECRET_KEY_SUBSTRINGS.some((needle) => normalized.includes(needle));
}

// Tool inputs/outputs are already JSON-serializable (they're literal
// arguments/results), so no cycle handling — just a depth cap against a
// pathologically nested value.
const MAX_REDACT_DEPTH = 12;

function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_REDACT_DEPTH) return "[TRUNCATED: max nesting depth exceeded]";
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, depth + 1));
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = isSecretKey(key) ? REDACTED : redactValue(entry, depth + 1);
    }
    return result;
  }
  return value;
}

// Serialized-size cap for a single audit_log.input/output value — tool
// output can be arbitrarily large (whole file contents, full search
// results), and the audit trail only needs enough to reconstruct what
// happened, not a full replay.
const MAX_AUDIT_VALUE_CHARS = 20_000;

/**
 * Redacts secret-shaped keys (case/separator-insensitive) anywhere in a tool
 * input/output value and caps its serialized size, before it's ever written
 * to audit_log — a leaked or over-broadly-shared audit row should never
 * itself hand over a live credential. `inputHash` (see permissions.ts's
 * hashToolInput) is computed from the raw, pre-redaction value elsewhere and
 * passed through logAudit unchanged, so redaction here doesn't affect it.
 */
export function sanitizeForAudit(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  const redacted = redactValue(value, 0);
  let serialized: string;
  try {
    serialized = JSON.stringify(redacted);
  } catch {
    return "[UNSERIALIZABLE]";
  }
  if (serialized.length <= MAX_AUDIT_VALUE_CHARS) return redacted;
  return {
    truncated: true,
    originalChars: serialized.length,
    preview: serialized.slice(0, MAX_AUDIT_VALUE_CHARS),
  };
}

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
  inputHash?: string | null;
  permissionSnapshot?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await getDb().createAuditLog({
      ...input,
      input: sanitizeForAudit(input.input),
      output: sanitizeForAudit(input.output),
      permissionSnapshot: input.permissionSnapshot
        ? (sanitizeForAudit(input.permissionSnapshot) as Record<string, unknown>)
        : input.permissionSnapshot,
    });
  } catch (err) {
    console.error("Failed to write audit log entry", err);
  }
}
