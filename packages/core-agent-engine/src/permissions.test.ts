import { describe, expect, it } from "bun:test";
import {
  ALWAYS_REQUIRES_APPROVAL_KINDS,
  permissionForToolKind,
  resolveToolPermission,
} from "./permissions";

describe("resolveToolPermission — permission matrix", () => {
  it("classifies a workspace tool by its ToolKind, low risk, no baseline approval", () => {
    const descriptor = resolveToolPermission({ source: "tool", toolKind: "file_read" });
    expect(descriptor.category).toBe("file.read");
    expect(descriptor.riskLevel).toBe("low");
    expect(descriptor.sideEffects).toBe(false);
    expect(descriptor.requiresApproval).toBe(false);
    expect(descriptor.sandboxRequired).toBe(false);
  });

  it("marks every ALWAYS_REQUIRES_APPROVAL_KINDS entry as requiring approval regardless of sensitive flag", () => {
    for (const kind of ALWAYS_REQUIRES_APPROVAL_KINDS) {
      const descriptor = resolveToolPermission({
        source: "tool",
        toolKind: kind,
        sensitive: false,
      });
      expect(descriptor.requiresApproval).toBe(true);
    }
  });

  it("flags custom_code as sandbox-required and high risk", () => {
    const descriptor = resolveToolPermission({ source: "tool", toolKind: "custom_code" });
    expect(descriptor.sandboxRequired).toBe(true);
    expect(descriptor.riskLevel).toBe("high");
    expect(descriptor.requiresApproval).toBe(true);
  });

  it("treats every MCP tool as requiring approval by default (deny-by-default for undeclared side effects)", () => {
    const descriptor = resolveToolPermission({ source: "mcp", toolKind: null });
    expect(descriptor.category).toBe("mcp.call");
    expect(descriptor.requiresApproval).toBe(true);
    expect(descriptor.sideEffects).toBe(true);
  });

  it("respects a skill's own sensitive flag when it has no ToolKind", () => {
    const sensitive = resolveToolPermission({ source: "skill", toolKind: null, sensitive: true });
    const notSensitive = resolveToolPermission({
      source: "skill",
      toolKind: null,
      sensitive: false,
    });
    expect(sensitive.requiresApproval).toBe(true);
    expect(notSensitive.requiresApproval).toBe(false);
    expect(sensitive.category).toBe("skill.execute");
  });

  it("classifies workflow and delegation tool sources under their own categories", () => {
    expect(resolveToolPermission({ source: "workflow", toolKind: null }).category).toBe(
      "workflow.execute",
    );
    expect(resolveToolPermission({ source: "delegation", toolKind: null }).category).toBe(
      "delegation.execute",
    );
  });

  it("never contradicts the underlying permissionForToolKind mapping", () => {
    const kind = "terminal_run" as const;
    expect(resolveToolPermission({ source: "tool", toolKind: kind }).category).toBe(
      permissionForToolKind(kind),
    );
  });
});
