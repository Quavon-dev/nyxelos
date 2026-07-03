/**
 * Super-agent delegation safety limits (ADR-0011's whitelist is "who can be
 * delegated to"; this module is "how far, and never back to yourself"). Both
 * NyxelOS's delegation paths — the model-driven `delegate_to_agent` tool
 * (apps/server/src/delegation.ts) and the planner-driven auto-delegation
 * branch (apps/server/src/agent-runtime.ts) — thread a depth counter and an
 * ancestor-agent-id chain through every recursive `executeManagedTask` call
 * and consult this module before recursing again.
 */

/** A super-agent delegating to a super-agent delegating to a super-agent...
 * three levels deep is already a lot of unattended fan-out; deeper than that
 * is far more likely a misconfiguration than a intentional design, and an
 * unbounded chain risks unbounded cost/runtime even when every hop is
 * otherwise a legitimate, human-approved whitelist entry. */
export const MAX_DELEGATION_DEPTH = 3;

export function canDelegateDeeper(depth: number): boolean {
  return depth < MAX_DELEGATION_DEPTH;
}

/** Drops any candidate agent id already present in the delegation chain
 * (every ancestor that delegated down to the current run) — the whitelist
 * alone doesn't stop A -> B -> A once B is also configured to delegate back
 * to A; this is what actually breaks that cycle. */
export function filterCyclicCandidates(candidateIds: string[], chain: string[]): string[] {
  if (chain.length === 0) return candidateIds;
  const seen = new Set(chain);
  return candidateIds.filter((id) => !seen.has(id));
}
