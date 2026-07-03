import { describe, expect, it } from "bun:test";
import {
  assertAgentRunTransitionAllowed,
  IllegalRunTransitionError,
  isTerminalAgentRunStatus,
  TERMINAL_AGENT_RUN_STATUSES,
} from "./run-transitions";

describe("isTerminalAgentRunStatus", () => {
  it("flags every terminal status", () => {
    for (const status of TERMINAL_AGENT_RUN_STATUSES) {
      expect(isTerminalAgentRunStatus(status)).toBe(true);
    }
  });

  it("does not flag in-flight statuses", () => {
    expect(isTerminalAgentRunStatus("pending")).toBe(false);
    expect(isTerminalAgentRunStatus("running")).toBe(false);
    expect(isTerminalAgentRunStatus("waiting_approval")).toBe(false);
  });
});

describe("assertAgentRunTransitionAllowed", () => {
  it("allows any transition out of a non-terminal status", () => {
    expect(() => assertAgentRunTransitionAllowed("running", "waiting_approval")).not.toThrow();
    expect(() => assertAgentRunTransitionAllowed("running", "completed")).not.toThrow();
    expect(() => assertAgentRunTransitionAllowed("pending", "running")).not.toThrow();
    expect(() => assertAgentRunTransitionAllowed("waiting_approval", "failed")).not.toThrow();
  });

  it("allows re-writing the same terminal status (idempotent no-op)", () => {
    expect(() => assertAgentRunTransitionAllowed("completed", "completed")).not.toThrow();
    expect(() => assertAgentRunTransitionAllowed("dead_letter", "dead_letter")).not.toThrow();
  });

  it("refuses to move a completed run back to an active status", () => {
    expect(() => assertAgentRunTransitionAllowed("completed", "running")).toThrow(
      IllegalRunTransitionError,
    );
  });

  it("refuses to move a cancelled run to any other status", () => {
    expect(() => assertAgentRunTransitionAllowed("cancelled", "waiting_approval")).toThrow(
      /terminal status/,
    );
  });

  it("refuses to move a dead_letter run back to running", () => {
    expect(() => assertAgentRunTransitionAllowed("dead_letter", "running")).toThrow(
      IllegalRunTransitionError,
    );
  });

  it("refuses to move a failed run to completed", () => {
    expect(() => assertAgentRunTransitionAllowed("failed", "completed")).toThrow(
      IllegalRunTransitionError,
    );
  });
});
