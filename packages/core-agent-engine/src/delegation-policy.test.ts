import { describe, expect, it } from "bun:test";
import {
  canDelegateDeeper,
  filterCyclicCandidates,
  MAX_DELEGATION_DEPTH,
} from "./delegation-policy";

describe("canDelegateDeeper", () => {
  it("allows depths below the max", () => {
    for (let depth = 0; depth < MAX_DELEGATION_DEPTH; depth++) {
      expect(canDelegateDeeper(depth)).toBe(true);
    }
  });

  it("refuses at and beyond the max depth", () => {
    expect(canDelegateDeeper(MAX_DELEGATION_DEPTH)).toBe(false);
    expect(canDelegateDeeper(MAX_DELEGATION_DEPTH + 5)).toBe(false);
  });
});

describe("filterCyclicCandidates", () => {
  it("returns candidates unchanged when the chain is empty (top-level run)", () => {
    expect(filterCyclicCandidates(["a", "b"], [])).toEqual(["a", "b"]);
  });

  it("drops a candidate already present in the delegation chain", () => {
    // A -> B -> A: by the time B is deciding who to delegate to, A is
    // already in the chain, so it must be dropped even though it's still
    // on B's whitelist.
    expect(filterCyclicCandidates(["a", "c"], ["a"])).toEqual(["c"]);
  });

  it("drops every chain member, not just the immediate parent", () => {
    expect(filterCyclicCandidates(["a", "b", "c", "d"], ["a", "b"])).toEqual(["c", "d"]);
  });

  it("returns an empty list when every candidate is a cycle", () => {
    expect(filterCyclicCandidates(["a", "b"], ["a", "b", "c"])).toEqual([]);
  });
});
