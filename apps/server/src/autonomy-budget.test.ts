import { describe, expect, it } from "bun:test";
import { DEFAULT_AUTONOMY_BUDGET } from "@nyxel/db";
import {
	checkAndConsumeRunBudget,
	createAutonomyBudgetTracker,
	exceedsRiskThreshold,
	isFileWriteToolKind,
	isToolKindAllowed,
	resolveAutonomyBudget,
} from "./autonomy-budget";

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
