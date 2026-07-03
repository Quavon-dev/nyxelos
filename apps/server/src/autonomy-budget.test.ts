import { describe, expect, it } from "bun:test";
import { DEFAULT_AUTONOMY_BUDGET } from "@nyxel/db";
import {
  checkAndConsumeRunBudget,
  checkModelCallCostBudget,
  createAutonomyBudgetTracker,
  exceedsRiskThreshold,
  isFileWriteToolKind,
  isToolKindAllowed,
  recordModelCallCost,
  resolveAutonomyBudget,
} from "./autonomy-budget";

// A model that's actually in packages/model-providers' price table, so
// these tests exercise the real cost math instead of always hitting the
// "unknown model" fail-closed branch.
const PRICED_MODEL = "anthropic/claude-sonnet-5"; // $3/$15 per million in/out tokens
const UNPRICED_MODEL = "custom:my-endpoint/some-fine-tune";

describe("resolveAutonomyBudget", () => {
  it("falls back to the all-null default for agents with no budget configured", () => {
    expect(resolveAutonomyBudget({ autonomyBudget: null })).toEqual(DEFAULT_AUTONOMY_BUDGET);
  });

  it("returns the agent's own budget when set", () => {
    const budget = { ...DEFAULT_AUTONOMY_BUDGET, maxToolCallsPerRun: 5 };
    expect(resolveAutonomyBudget({ autonomyBudget: budget })).toBe(budget);
  });
});

describe("checkAndConsumeRunBudget — tool-call limit", () => {
  it("allows calls under the limit and blocks once it's reached", () => {
    const tracker = createAutonomyBudgetTracker({
      ...DEFAULT_AUTONOMY_BUDGET,
      maxToolCallsPerRun: 2,
    });

    expect(checkAndConsumeRunBudget(tracker, "file_read").allowed).toBe(true);
    expect(checkAndConsumeRunBudget(tracker, "file_read").allowed).toBe(true);
    const third = checkAndConsumeRunBudget(tracker, "file_read");
    expect(third.allowed).toBe(false);
    expect(third.reason).toContain("Tool-call budget exceeded");
  });

  it("stays blocked for the rest of the run once tripped (sticky)", () => {
    const tracker = createAutonomyBudgetTracker({
      ...DEFAULT_AUTONOMY_BUDGET,
      maxToolCallsPerRun: 1,
    });
    expect(checkAndConsumeRunBudget(tracker, "file_read").allowed).toBe(true);
    expect(checkAndConsumeRunBudget(tracker, "file_read").allowed).toBe(false);
    // Even a kind that wouldn't itself trip any limit stays blocked.
    expect(checkAndConsumeRunBudget(tracker, "file_stat").allowed).toBe(false);
  });

  it("never blocks when maxToolCallsPerRun is unset (existing-agent default)", () => {
    const tracker = createAutonomyBudgetTracker(DEFAULT_AUTONOMY_BUDGET);
    for (let i = 0; i < 50; i++) {
      expect(checkAndConsumeRunBudget(tracker, "file_read").allowed).toBe(true);
    }
  });
});

describe("checkAndConsumeRunBudget — file-write limit", () => {
  it("only counts file-write-kind calls against the write budget", () => {
    const tracker = createAutonomyBudgetTracker({
      ...DEFAULT_AUTONOMY_BUDGET,
      maxFileWritesPerRun: 1,
    });
    expect(checkAndConsumeRunBudget(tracker, "file_read").allowed).toBe(true);
    expect(checkAndConsumeRunBudget(tracker, "file_read").allowed).toBe(true);
    expect(checkAndConsumeRunBudget(tracker, "file_write").allowed).toBe(true);
    const blocked = checkAndConsumeRunBudget(tracker, "file_write");
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain("File-write budget exceeded");
  });
});

describe("checkAndConsumeRunBudget — runtime limit", () => {
  it("blocks once the elapsed wall-clock time passes the limit", () => {
    const tracker = createAutonomyBudgetTracker({
      ...DEFAULT_AUTONOMY_BUDGET,
      maxRuntimeMinutes: 1,
    });
    // Simulate time having passed without needing a real sleep.
    tracker.startedAt = Date.now() - 2 * 60_000;
    const result = checkAndConsumeRunBudget(tracker, "file_read");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Runtime budget exceeded");
  });
});

describe("isToolKindAllowed", () => {
  it("allows everything when both lists are unset", () => {
    expect(isToolKindAllowed(DEFAULT_AUTONOMY_BUDGET, "terminal_run").allowed).toBe(true);
  });

  it("blocks a kind on the block-list even if also on the allow-list", () => {
    const budget = {
      ...DEFAULT_AUTONOMY_BUDGET,
      allowedToolKinds: ["file_read", "terminal_run"] as const,
      blockedToolKinds: ["terminal_run"] as const,
    };
    expect(isToolKindAllowed(budget as any, "terminal_run").allowed).toBe(false);
    expect(isToolKindAllowed(budget as any, "file_read").allowed).toBe(true);
  });

  it("blocks a kind missing from a non-null allow-list", () => {
    const budget = { ...DEFAULT_AUTONOMY_BUDGET, allowedToolKinds: ["file_read"] as const };
    expect(isToolKindAllowed(budget as any, "terminal_run").allowed).toBe(false);
  });
});

describe("isFileWriteToolKind", () => {
  it("classifies known write kinds", () => {
    expect(isFileWriteToolKind("file_write")).toBe(true);
    expect(isFileWriteToolKind("file_delete")).toBe(true);
    expect(isFileWriteToolKind("file_read")).toBe(false);
    expect(isFileWriteToolKind(null)).toBe(false);
  });
});

describe("exceedsRiskThreshold", () => {
  it("never forces approval when threshold is null", () => {
    expect(exceedsRiskThreshold("terminal.run", null)).toBe(false);
  });

  it("forces approval once category risk meets the threshold", () => {
    expect(exceedsRiskThreshold("file.write", "medium")).toBe(true);
    expect(exceedsRiskThreshold("file.read", "medium")).toBe(false);
    expect(exceedsRiskThreshold("terminal.run", "high")).toBe(true);
  });
});

describe("checkModelCallCostBudget", () => {
  it("never blocks when maxEstimatedCostUsd is unset (existing-agent default)", () => {
    const tracker = createAutonomyBudgetTracker(DEFAULT_AUTONOMY_BUDGET);
    expect(checkModelCallCostBudget(tracker, UNPRICED_MODEL, 1_000_000).allowed).toBe(true);
  });

  it("blocks before an expensive call whose projected cost alone exceeds the budget", () => {
    const tracker = createAutonomyBudgetTracker({
      ...DEFAULT_AUTONOMY_BUDGET,
      maxEstimatedCostUsd: 0.01,
    });
    // 1,000,000 output tokens at $15/million ≈ $15 — way over a $0.01 budget.
    const result = checkModelCallCostBudget(tracker, PRICED_MODEL, 1_000_000);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Estimated cost budget exceeded");
  });

  it("allows a call whose projected cost fits comfortably under the budget", () => {
    const tracker = createAutonomyBudgetTracker({
      ...DEFAULT_AUTONOMY_BUDGET,
      maxEstimatedCostUsd: 5,
    });
    // 8,192 output tokens at $15/million ≈ $0.12 — comfortably under $5.
    expect(checkModelCallCostBudget(tracker, PRICED_MODEL, 8_192).allowed).toBe(true);
  });

  it("blocks a model with no known price once a cost budget is set — fails closed on uncertainty", () => {
    const tracker = createAutonomyBudgetTracker({
      ...DEFAULT_AUTONOMY_BUDGET,
      maxEstimatedCostUsd: 100,
    });
    const result = checkModelCallCostBudget(tracker, UNPRICED_MODEL, 1_000);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("known price");
  });

  it("judges a second call against real spend recorded from the first, not just its own projection", () => {
    const tracker = createAutonomyBudgetTracker({
      ...DEFAULT_AUTONOMY_BUDGET,
      maxEstimatedCostUsd: 0.2,
    });
    // First call projected fine and actually cost ~$0.12 (8,192 output tokens).
    expect(checkModelCallCostBudget(tracker, PRICED_MODEL, 8_192).allowed).toBe(true);
    recordModelCallCost(tracker, PRICED_MODEL, { inputTokens: 0, outputTokens: 8_192 });
    expect(tracker.estimatedCostMicros).toBeGreaterThan(0);

    // A second call projecting another ~$0.12 would push total spend to
    // ~$0.24, over the $0.20 budget — must be blocked even though the
    // second call's own projection alone would have fit.
    const second = checkModelCallCostBudget(tracker, PRICED_MODEL, 8_192);
    expect(second.allowed).toBe(false);
  });

  it("stays blocked for the rest of the run once tripped (sticky)", () => {
    const tracker = createAutonomyBudgetTracker({
      ...DEFAULT_AUTONOMY_BUDGET,
      maxEstimatedCostUsd: 0.01,
    });
    expect(checkModelCallCostBudget(tracker, PRICED_MODEL, 1_000_000).allowed).toBe(false);
    // Even a call cheap enough to have passed on its own stays blocked.
    expect(checkModelCallCostBudget(tracker, PRICED_MODEL, 1).allowed).toBe(false);
  });
});

describe("recordModelCallCost", () => {
  it("accumulates real usage cost across multiple calls", () => {
    const tracker = createAutonomyBudgetTracker(DEFAULT_AUTONOMY_BUDGET);
    recordModelCallCost(tracker, PRICED_MODEL, { inputTokens: 1000, outputTokens: 1000 });
    const afterFirst = tracker.estimatedCostMicros;
    expect(afterFirst).toBeGreaterThan(0);
    recordModelCallCost(tracker, PRICED_MODEL, { inputTokens: 1000, outputTokens: 1000 });
    expect(tracker.estimatedCostMicros).toBe(afterFirst * 2);
  });

  it("is a no-op for a model with no known price", () => {
    const tracker = createAutonomyBudgetTracker(DEFAULT_AUTONOMY_BUDGET);
    recordModelCallCost(tracker, UNPRICED_MODEL, { inputTokens: 1000, outputTokens: 1000 });
    expect(tracker.estimatedCostMicros).toBe(0);
  });

  it("treats undefined usage as zero tokens rather than throwing", () => {
    const tracker = createAutonomyBudgetTracker(DEFAULT_AUTONOMY_BUDGET);
    recordModelCallCost(tracker, PRICED_MODEL, undefined);
    expect(tracker.estimatedCostMicros).toBe(0);
  });
});
