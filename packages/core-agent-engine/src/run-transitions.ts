import type { AgentRunStatus } from "@nyxel/db";

/**
 * Guards against reviving an `agentRun` row that has already reached a
 * terminal status — the concrete failure mode this closes is a stale or
 * duplicate caller (a slow retry-loop tick, a second approval resolution
 * racing the first, the stale-run sweep) writing `"running"`/`"waiting_approval"`
 * back onto a run that already finished, which would make whatever sensitive
 * action the run performs look eligible to run again.
 */
export const TERMINAL_AGENT_RUN_STATUSES: readonly AgentRunStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "dead_letter",
];

export function isTerminalAgentRunStatus(status: AgentRunStatus): boolean {
  return (TERMINAL_AGENT_RUN_STATUSES as readonly string[]).includes(status);
}

export class IllegalRunTransitionError extends Error {
  constructor(current: AgentRunStatus, next: AgentRunStatus) {
    super(`Cannot transition agent run from terminal status "${current}" to "${next}".`);
    this.name = "IllegalRunTransitionError";
  }
}

/**
 * Throws if `current` is already terminal and `next` would move it to a
 * different status. Re-writing the same terminal status (e.g. a duplicate
 * `"completed"` -> `"completed"`) is a no-op, not an illegal transition.
 */
export function assertAgentRunTransitionAllowed(
  current: AgentRunStatus,
  next: AgentRunStatus,
): void {
  if (isTerminalAgentRunStatus(current) && current !== next) {
    throw new IllegalRunTransitionError(current, next);
  }
}
