import { PERMISSION_RISK, type PermissionCategory, type PermissionRisk } from "@nyxel/core-agent-engine";
import type { AgentRecord, AutonomyBudget, AutonomyBudgetRiskLevel, ToolKind } from "@nyxel/db";
import { DEFAULT_AUTONOMY_BUDGET } from "@nyxel/db";

/**
 * Autonomy Budgets v1 (ADR: none yet — see docs/ARCHITECTURE.md section 6
 * for the coarse autonomyLevel this layers on top of).
 *
 * What's actually enforced here vs. only prepared:
 *
 * ENFORCED — allowedToolKinds / blockedToolKinds: checked in tools.ts before
 * a tool ever runs (isToolKindAllowed), independent of the approval gate.
 *
 * ENFORCED — maxToolCallsPerRun / maxFileWritesPerRun: checked and consumed
 * in tools.ts right before a tool actually executes
 * (checkAndConsumeRunBudget). Once exceeded, every further tool call in the
 * run is blocked (sticky) instead of executed — the model keeps running
 * but every subsequent tool call comes back with a clear "budget exceeded"
 * result instead of a crash.
 *
 * ENFORCED (best-effort) — maxRuntimeMinutes: checked the same way at every
 * tool call boundary (checkAndConsumeRunBudget), AND independently enforced
 * with a hard wall-clock timeout on the run's AbortController in
 * agent-runtime.ts's executeManagedTask, so a run with no tool calls at all
 * still gets cut off. The tool-call check only covers task/automation runs
 * and live chat turns that go through tools.ts; the hard timeout only
 * covers durable task/automation runs (agent-runtime.ts owns the
 * AbortController there — a live chat turn's HTTP request has its own
 * lifecycle this feature doesn't touch).
 *
 * ENFORCED — requiresApprovalAboveRisk: folded into tools.ts's approval
 * decision (exceedsRiskThreshold) — it can only ever ADD approval
 * requirements on top of the existing autonomy-level/chat-tool-policy gate,
 * never remove one.
 *
 * PREPARED, NOT ENFORCED — maxEstimatedCostUsd: the field exists, is
 * persisted, and has a sensible null-means-unlimited default, but nothing
 * in the current streaming pipeline computes cost mid-run (usage is only
 * known once a whole streamText call — including its entire internal
 * tool-calling loop — finishes, via onFinish; too late to gate mid-run). A
 * future iteration could wire per-step usage (AI SDK's onStepFinish) into
 * the same tracker used here.
 */

/** Tool kinds treated as a "file write" for maxFileWritesPerRun — mirrors
 * tools.ts's classifyBuiltinSkillKind's file_write bucket plus every other
 * ToolKind that mutates the filesystem. Includes file_delete: a delete
 * still counts against the write budget even though it's always separately
 * approval-gated (ALWAYS_REQUIRES_APPROVAL_KINDS in tools.ts). */
const FILE_WRITE_TOOL_KINDS = new Set<ToolKind>([
	"file_write",
	"file_create",
	"file_patch",
	"file_move",
	"directory_create",
	"notebook_edit",
	"file_delete",
]);

export function isFileWriteToolKind(kind: ToolKind | null): boolean {
	return kind !== null && FILE_WRITE_TOOL_KINDS.has(kind);
}

/** Agents created before this feature (or never configured) have a null
 * `autonomyBudget` column — resolve that to the all-null "no limit" default
 * so callers never have to null-check the budget itself. */
export function resolveAutonomyBudget(agent: Pick<AgentRecord, "autonomyBudget">): AutonomyBudget {
	return agent.autonomyBudget ?? DEFAULT_AUTONOMY_BUDGET;
}

/** Per-run mutable counters, created fresh for every agent run (task run or
 * live chat turn) — see buildToolsForAgent in tools.ts. `blockedReason` is
 * sticky: once a run-level budget (tool calls, runtime, file writes) is
 * exceeded, every subsequent tool call is blocked for the rest of the run
 * rather than re-checked, so a slow model that keeps trying doesn't get a
 * second wind the moment one counter dips back under some other limit. */
export interface AutonomyBudgetTracker {
	budget: AutonomyBudget;
	startedAt: number;
	toolCallCount: number;
	fileWriteCount: number;
	blockedReason: string | null;
}

export function createAutonomyBudgetTracker(budget: AutonomyBudget): AutonomyBudgetTracker {
	return {
		budget,
		startedAt: Date.now(),
		toolCallCount: 0,
		fileWriteCount: 0,
		blockedReason: null,
	};
}

export interface BudgetCheckResult {
	allowed: boolean;
	reason?: string;
}

/** Pure allow/block-list check — no side effects, doesn't touch the tracker.
 * Independent of approval policy: a blocked tool kind never runs even if a
 * human would otherwise approve it. */
export function isToolKindAllowed(
	budget: AutonomyBudget,
	toolKind: ToolKind | null,
): BudgetCheckResult {
	if (!toolKind) return { allowed: true };
	if (budget.blockedToolKinds?.includes(toolKind)) {
		return {
			allowed: false,
			reason: `Tool kind "${toolKind}" is blocked by this agent's autonomy budget.`,
		};
	}
	if (budget.allowedToolKinds && !budget.allowedToolKinds.includes(toolKind)) {
		return {
			allowed: false,
			reason: `Tool kind "${toolKind}" is not in this agent's allowed tool kinds.`,
		};
	}
	return { allowed: true };
}

/** Checks the run-level counters (tool calls / runtime / file writes)
 * immediately before a tool is actually executed, and increments them when
 * the call is allowed. Must be called after the approval-defer decision —
 * a call that's merely queued for human approval hasn't consumed anything
 * yet. */
export function checkAndConsumeRunBudget(
	tracker: AutonomyBudgetTracker,
	toolKind: ToolKind | null,
): BudgetCheckResult {
	if (tracker.blockedReason) return { allowed: false, reason: tracker.blockedReason };

	const { budget } = tracker;

	if (budget.maxRuntimeMinutes != null) {
		const elapsedMinutes = (Date.now() - tracker.startedAt) / 60_000;
		if (elapsedMinutes >= budget.maxRuntimeMinutes) {
			tracker.blockedReason = `Runtime budget exceeded (limit ${budget.maxRuntimeMinutes} minute(s) per run).`;
			return { allowed: false, reason: tracker.blockedReason };
		}
	}

	if (budget.maxToolCallsPerRun != null && tracker.toolCallCount >= budget.maxToolCallsPerRun) {
		tracker.blockedReason = `Tool-call budget exceeded (limit ${budget.maxToolCallsPerRun} call(s) per run).`;
		return { allowed: false, reason: tracker.blockedReason };
	}

	if (
		budget.maxFileWritesPerRun != null &&
		isFileWriteToolKind(toolKind) &&
		tracker.fileWriteCount >= budget.maxFileWritesPerRun
	) {
		tracker.blockedReason = `File-write budget exceeded (limit ${budget.maxFileWritesPerRun} write(s) per run).`;
		return { allowed: false, reason: tracker.blockedReason };
	}

	tracker.toolCallCount++;
	if (isFileWriteToolKind(toolKind)) tracker.fileWriteCount++;
	return { allowed: true };
}

const RISK_ORDER: Record<PermissionRisk, number> = { low: 0, medium: 1, high: 2 };

/** Whether a tool call's permission risk meets or exceeds the agent's
 * `requiresApprovalAboveRisk` threshold — folded into tools.ts's approval
 * decision as an additional (never-loosening) condition. Null threshold
 * means no extra approval requirement beyond the existing policy. */
export function exceedsRiskThreshold(
	category: PermissionCategory,
	threshold: AutonomyBudgetRiskLevel | null,
): boolean {
	if (!threshold) return false;
	return RISK_ORDER[PERMISSION_RISK[category]] >= RISK_ORDER[threshold];
}
