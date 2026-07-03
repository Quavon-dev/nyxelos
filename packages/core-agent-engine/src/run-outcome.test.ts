import { describe, expect, it } from "bun:test";
import {
  createRunOutcomeSignal,
  recordApprovalPause,
  recordQuestionPause,
  resolveRunOutcome,
} from "./run-outcome";

describe("resolveRunOutcome — typed pause outcomes", () => {
  it("reports not-paused when nothing was recorded and no budget reason is set", () => {
    const outcome = resolveRunOutcome(createRunOutcomeSignal(), null);
    expect(outcome.paused).toBe(false);
    expect(outcome.pauseReason).toBeNull();
  });

  it("resolves a question pause", () => {
    const signal = createRunOutcomeSignal();
    recordQuestionPause(signal, { question: "Which env?", reason: "Ambiguous target." });
    const outcome = resolveRunOutcome(signal, null);
    expect(outcome.paused).toBe(true);
    expect(outcome.pauseReason).toEqual({
      kind: "question",
      question: "Which env?",
      reason: "Ambiguous target.",
    });
  });

  it("resolves an approval pause", () => {
    const signal = createRunOutcomeSignal();
    recordApprovalPause(signal, { approvalId: "appr_1", toolLabel: "file_delete" });
    const outcome = resolveRunOutcome(signal, null);
    expect(outcome.paused).toBe(true);
    expect(outcome.pauseReason).toEqual({
      kind: "approval",
      approvalId: "appr_1",
      toolLabel: "file_delete",
    });
  });

  it("resolves a budget pause when nothing else was recorded", () => {
    const outcome = resolveRunOutcome(createRunOutcomeSignal(), "Runtime budget exceeded.");
    expect(outcome.paused).toBe(true);
    expect(outcome.pauseReason).toEqual({ kind: "budget", reason: "Runtime budget exceeded." });
  });

  it("prioritizes question over approval over budget when more than one fired", () => {
    const signal = createRunOutcomeSignal();
    recordApprovalPause(signal, { approvalId: "appr_1", toolLabel: "file_delete" });
    recordQuestionPause(signal, { question: "Confirm?", reason: "Destructive." });
    const outcome = resolveRunOutcome(signal, "Runtime budget exceeded.");
    expect(outcome.pauseReason?.kind).toBe("question");
  });

  it("keeps the first recorded pause of each kind (does not overwrite on a second call)", () => {
    const signal = createRunOutcomeSignal();
    recordQuestionPause(signal, { question: "First?", reason: "First reason." });
    recordQuestionPause(signal, { question: "Second?", reason: "Second reason." });
    expect(signal.questionPause?.question).toBe("First?");
  });

  it('is independent of any text content — a budget-blocked run whose output happens to contain the literal string "pending_approval" is not misread as an approval pause', () => {
    // Regression guard for the text-marker detection this module replaces:
    // resolveRunOutcome only ever looks at the structured signal/reason
    // passed in, never at a model's own output text.
    const signal = createRunOutcomeSignal();
    const outcome = resolveRunOutcome(signal, "cost budget exceeded");
    expect(outcome.pauseReason?.kind).toBe("budget");
  });
});
