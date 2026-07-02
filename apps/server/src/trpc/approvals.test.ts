import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import type { Context } from "./context";
import { appRouter } from "./router";

/**
 * Regression test for SECURITY_AUDIT.md SEC-00 / backlog BL-00: the
 * approvals sub-router used to be `publicProcedure`, letting any
 * unauthenticated network caller approve, reject, or enumerate pending
 * approvals in any workspace — the one human checkpoint before a sensitive
 * action (file writes, terminal_run, MCP tool calls) executes. `list` is now
 * `workspaceProcedure` and `approve`/`reject` are `protectedProcedure`, all
 * of which reject a session-less caller before any resolver body (and so
 * before any DB call) runs — see trpc.ts's protectedProcedure middleware.
 */
const unauthenticatedContext: Context = { user: null, session: null };

describe("approvals router requires authentication (SEC-00)", () => {
  test("list rejects an unauthenticated caller", async () => {
    const caller = appRouter.createCaller(unauthenticatedContext);
    await expect(caller.approvals.list({ workspaceId: "ws-1" })).rejects.toThrow(TRPCError);
  });

  test("approve rejects an unauthenticated caller", async () => {
    const caller = appRouter.createCaller(unauthenticatedContext);
    await expect(caller.approvals.approve({ id: "approval-1" })).rejects.toThrow(TRPCError);
  });

  test("reject rejects an unauthenticated caller", async () => {
    const caller = appRouter.createCaller(unauthenticatedContext);
    await expect(caller.approvals.reject({ id: "approval-1" })).rejects.toThrow(TRPCError);
  });

  test("unauthenticated rejection carries the UNAUTHORIZED code, not a generic error", async () => {
    const caller = appRouter.createCaller(unauthenticatedContext);
    try {
      await caller.approvals.approve({ id: "approval-1" });
      throw new Error("expected approve to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("UNAUTHORIZED");
    }
  });
});
