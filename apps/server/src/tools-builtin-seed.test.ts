import { describe, expect, test } from "bun:test";
import { BUILTIN_TOOL_SEEDS } from "./tools-builtin-seed";

/**
 * Regression test for SECURITY_AUDIT.md SEC-09 — dangerous builtin tool
 * kinds (file writes/deletes, terminal execution) must stay `sensitive:
 * true` so they always go through the approval workflow (ADR-0009) rather
 * than running unattended. Catches an accidental flip in the seed data
 * itself; does not exercise the full approval-gate wiring end to end (that
 * needs Agent Runtime integration tests — see AGENTIC_OS_BACKLOG.md BL-09).
 */
const DANGEROUS_KINDS = [
  "file_create",
  "file_patch",
  "file_move",
  "directory_create",
  "notebook_edit",
  "terminal_run",
  "terminal_send_input",
  "terminal_kill",
];

describe("BUILTIN_TOOL_SEEDS sensitivity (SEC-09)", () => {
  test.each(DANGEROUS_KINDS)("%s is seeded as sensitive: true", (kind) => {
    const seed = BUILTIN_TOOL_SEEDS.find((s) => s.kind === kind);
    expect(seed).toBeDefined();
    expect(seed?.sensitive).toBe(true);
  });

  test("every seeded tool has an explicit sensitive value (no implicit default)", () => {
    for (const seed of BUILTIN_TOOL_SEEDS) {
      expect(typeof seed.sensitive).toBe("boolean");
    }
  });
});
