/**
 * Structured run-pause tracking (replaces string-marker detection like
 * `output.includes("pending_approval")`). Tool execution (apps/server/src/
 * tools.ts) records a pause reason directly onto a `RunOutcomeSignal` at the
 * moment it defers a call for approval or blocks on a user question — the
 * caller (apps/server/src/agent-runtime.ts) reads that structured signal
 * back instead of pattern-matching the model's own (potentially paraphrased,
 * never guaranteed to echo a literal tool result) final text.
 */

export interface QuestionPauseReason {
  kind: "question";
  question: string;
  reason: string;
}

export interface ApprovalPauseReason {
  kind: "approval";
  approvalId: string;
  toolLabel: string;
}

export interface BudgetPauseReason {
  kind: "budget";
  reason: string;
}

export type PauseReason = QuestionPauseReason | ApprovalPauseReason | BudgetPauseReason;

/** Mutable, per-run collector passed through AgentRunContext — tools write
 * into it as they execute; at most one of each kind is kept (first write
 * wins), since only the *fact* that a question/approval pause happened during
 * the run matters to the caller, not which of possibly several fired first. */
export interface RunOutcomeSignal {
  questionPause: QuestionPauseReason | null;
  approvalPause: ApprovalPauseReason | null;
}

export function createRunOutcomeSignal(): RunOutcomeSignal {
  return { questionPause: null, approvalPause: null };
}

export function recordQuestionPause(
  signal: RunOutcomeSignal | undefined,
  reason: Omit<QuestionPauseReason, "kind">,
): void {
  if (!signal || signal.questionPause) return;
  signal.questionPause = { kind: "question", ...reason };
}

export function recordApprovalPause(
  signal: RunOutcomeSignal | undefined,
  reason: Omit<ApprovalPauseReason, "kind">,
): void {
  if (!signal || signal.approvalPause) return;
  signal.approvalPause = { kind: "approval", ...reason };
}

export interface RunOutcome {
  paused: boolean;
  pauseReason: PauseReason | null;
}

/**
 * Combines the structured tool-call-level pause signals collected during a
 * run with the (already-structured) autonomy-budget block reason into one
 * outcome. Priority — question > approval > budget — mirrors the original
 * text-marker checks this replaces (`pausedOnQuestion` was checked before
 * `pausedOnApproval`, which was checked before the budget fallback).
 */
export function resolveRunOutcome(
  signal: RunOutcomeSignal,
  budgetBlockedReason: string | null,
): RunOutcome {
  if (signal.questionPause) return { paused: true, pauseReason: signal.questionPause };
  if (signal.approvalPause) return { paused: true, pauseReason: signal.approvalPause };
  if (budgetBlockedReason) {
    return { paused: true, pauseReason: { kind: "budget", reason: budgetBlockedReason } };
  }
  return { paused: false, pauseReason: null };
}
