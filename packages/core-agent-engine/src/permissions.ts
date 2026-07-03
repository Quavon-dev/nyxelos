import type { ToolKind } from "@nyxel/db";

/**
 * The permission taxonomy every tool call is classified into before
 * execution. This is deliberately coarser than `ToolKind` (~40 values) —
 * `ToolKind` is "what specific tool," `PermissionCategory` is "what kind of
 * access does it need," which is what an approval dialog, an audit log
 * filter, or a future per-agent permission grant actually wants to reason
 * about. See ADR-0017.
 */
export type PermissionCategory =
  | "file.read"
  | "file.write"
  | "file.delete"
  | "repo.read"
  | "repo.write"
  | "terminal.run"
  | "network.fetch"
  | "browser.use"
  | "mcp.call"
  | "plugin.execute"
  | "skill.execute"
  | "workflow.execute"
  | "delegation.execute"
  | "secret.read"
  | "automation.create"
  | "email.send"
  | "calendar.write"
  | "database.write";

export type PermissionRisk = "low" | "medium" | "high";

export const PERMISSION_RISK: Record<PermissionCategory, PermissionRisk> = {
  "file.read": "low",
  "file.write": "medium",
  "file.delete": "high",
  "repo.read": "low",
  "repo.write": "medium",
  "terminal.run": "high",
  "network.fetch": "medium",
  "browser.use": "medium",
  "mcp.call": "medium",
  "plugin.execute": "high",
  "skill.execute": "low",
  "workflow.execute": "medium",
  "delegation.execute": "medium",
  "secret.read": "high",
  "automation.create": "medium",
  "email.send": "medium",
  "calendar.write": "medium",
  "database.write": "high",
};

/**
 * Maps every existing `ToolKind` (packages/db) onto the taxonomy above.
 * Kept as an explicit exhaustive record (not a fallback/default branch) so
 * adding a new ToolKind without updating this file is a TypeScript error,
 * not a silent under-classification.
 */
export const TOOL_KIND_PERMISSION: Record<ToolKind, PermissionCategory> = {
  http_fetch: "network.fetch",
  file_read: "file.read",
  file_write: "file.write",
  file_list: "file.read",
  file_delete: "file.delete",
  kb_search: "file.read",
  custom_code: "plugin.execute",
  file_create: "file.write",
  file_patch: "file.write",
  file_move: "file.write",
  directory_create: "file.write",
  notebook_edit: "file.write",
  file_stat: "file.read",
  file_view_image: "file.read",
  notebook_summary: "file.read",
  notebook_cell_output: "file.read",
  terminal_last_command: "terminal.run",
  terminal_output: "terminal.run",
  problems: "repo.read",
  file_search: "file.read",
  text_search: "file.read",
  usages: "repo.read",
  codebase_search: "repo.read",
  changes: "repo.read",
  terminal_run: "terminal.run",
  terminal_send_input: "terminal.run",
  terminal_kill: "terminal.run",
  task_run: "terminal.run",
  test_run: "terminal.run",
  browser_navigate: "browser.use",
  browser_click: "browser.use",
  browser_drag: "browser.use",
  browser_hover: "browser.use",
  browser_type: "browser.use",
  browser_handle_dialog: "browser.use",
  browser_screenshot: "browser.use",
  browser_read_page: "browser.use",
  browser_run_playwright_code: "browser.use",
  github_repo_fetch: "repo.read",
  github_code_search: "repo.read",
  generate_image: "network.fetch",
  generate_video: "network.fetch",
  edit_video: "file.write",
  generate_speech: "network.fetch",
  transcribe_audio: "network.fetch",
};

export function permissionForToolKind(kind: ToolKind): PermissionCategory {
  return TOOL_KIND_PERMISSION[kind];
}

export function permissionForSource(
  source: "skill" | "mcp" | "plugin" | "workflow" | "delegation",
): PermissionCategory {
  if (source === "mcp") return "mcp.call";
  if (source === "plugin") return "plugin.execute";
  if (source === "workflow") return "workflow.execute";
  if (source === "delegation") return "delegation.execute";
  return "skill.execute";
}

/**
 * Tool kinds that stay gated behind human approval regardless of autonomy
 * level or chat tool policy (see apps/server/src/tools.ts's
 * shouldDeferToolForApproval — "auto" mode waives approval for everything
 * *except* these). Centralized here (rather than duplicated per tool source)
 * so skills, workspace tools, workflow tools, and delegation tools all read
 * the same list instead of each keeping their own copy that could drift.
 */
export const ALWAYS_REQUIRES_APPROVAL_KINDS = new Set<ToolKind>([
  "terminal_run",
  "terminal_send_input",
  "terminal_kill",
  "task_run",
  "test_run",
  "custom_code",
  "file_delete",
  "browser_run_playwright_code",
]);

/** Which tool sources are expected to run inside the process-isolated
 * sandbox (plugin-sandbox.ts) rather than in-process — used to flag a
 * descriptor's `sandboxRequired` so a future caller/audit can assert the
 * boundary was actually applied rather than inferring it from the tool kind
 * alone. */
const SANDBOX_REQUIRED_KINDS = new Set<ToolKind>(["custom_code"]);

export type ToolSource = "skill" | "tool" | "mcp" | "workflow" | "delegation";

/**
 * The single descriptor every tool call is evaluated against before
 * execution — skills, workspace tools, MCP tools, workflow tools, and
 * delegation tools all resolve one of these instead of each re-deriving
 * category/risk/approval/sandbox facts independently (see ADR-0017 and
 * apps/server/src/tools.ts's buildToolsForAgent). `requiresApproval` here is
 * the *baseline* the tool kind itself imposes (ALWAYS_REQUIRES_APPROVAL_KINDS
 * plus MCP's "undeclared side effects" default) — a caller's own policy/
 * risk-threshold checks can only ever add approval requirements on top of
 * this, never remove one.
 */
export interface ToolPermissionDescriptor {
  source: ToolSource;
  toolKind: ToolKind | null;
  category: PermissionCategory;
  riskLevel: PermissionRisk;
  /** Whether calling this tool can change external state (files, network
   * resources, other systems) as opposed to being purely read-only. */
  sideEffects: boolean;
  /** Placeholder for a future fine-grained scope system — always empty
   * today (every currently-modeled grant is per-server/per-tool-kind, not
   * scope-based), kept on the descriptor so a scope model can be added
   * without changing every call site's shape. */
  requiredScopes: string[];
  requiresApproval: boolean;
  sandboxRequired: boolean;
}

const READ_ONLY_CATEGORIES = new Set<PermissionCategory>([
  "file.read",
  "repo.read",
  "skill.execute",
]);

/**
 * Resolves the central permission descriptor for one tool call. `sensitive`
 * mirrors the skill/workspace-tool record's own `sensitive` flag (MCP tools
 * have no such flag — every MCP tool call is treated as side-effecting by
 * default per ADR-0009, since the server doesn't declare what its tools do).
 */
export function resolveToolPermission(input: {
  source: ToolSource;
  toolKind: ToolKind | null;
  sensitive?: boolean;
}): ToolPermissionDescriptor {
  const category =
    input.source === "skill" || input.source === "tool"
      ? input.toolKind
        ? permissionForToolKind(input.toolKind)
        : permissionForSource("skill")
      : permissionForSource(input.source);
  const riskLevel = PERMISSION_RISK[category];
  const alwaysApproval = input.toolKind
    ? ALWAYS_REQUIRES_APPROVAL_KINDS.has(input.toolKind)
    : false;
  const mcpDefaultApproval = input.source === "mcp";
  return {
    source: input.source,
    toolKind: input.toolKind,
    category,
    riskLevel,
    sideEffects: input.sensitive === true || !READ_ONLY_CATEGORIES.has(category),
    requiredScopes: [],
    requiresApproval: alwaysApproval || mcpDefaultApproval || input.sensitive === true,
    sandboxRequired: input.toolKind ? SANDBOX_REQUIRED_KINDS.has(input.toolKind) : false,
  };
}

/**
 * A stable, non-reversible fingerprint of a tool call's input — stored on
 * the audit log (audit_log.inputHash) so two calls with identical
 * arguments are recognizable without keeping the raw input around forever,
 * and so a leaked audit row never itself leaks secrets that happened to be
 * part of an input (e.g. an API key argument to a custom tool).
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return Object.fromEntries(entries.map(([key, val]) => [key, canonicalize(val)]));
  }
  return value;
}

export async function hashToolInput(input: unknown): Promise<string> {
  const json = JSON.stringify(canonicalize(input ?? null));
  const bytes = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * What actually got checked for one tool call — persisted alongside the
 * audit log entry (audit_log.permissionSnapshot) so "what were the rules
 * at the time this ran" survives later changes to an agent's policy or
 * autonomy level. Answers "why was this allowed/blocked" after the fact
 * without needing to reconstruct policy state from other tables.
 */
export interface PermissionSnapshot extends Record<string, unknown> {
  category: PermissionCategory;
  risk: PermissionRisk;
  autonomyLevel: string;
  policyMode: string;
  requiredApproval: boolean;
}

export function buildPermissionSnapshot(input: {
  category: PermissionCategory;
  autonomyLevel: string;
  policyMode: string;
  requiredApproval: boolean;
}): PermissionSnapshot {
  return {
    category: input.category,
    risk: PERMISSION_RISK[input.category],
    autonomyLevel: input.autonomyLevel,
    policyMode: input.policyMode,
    requiredApproval: input.requiredApproval,
  };
}
