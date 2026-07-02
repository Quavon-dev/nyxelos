import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create();

export const router = t.router;

/**
 * Use only for endpoints that must work with no session: pre-login
 * bootstrap (installation.status/complete), health checks, and genuinely
 * public share links. Every workspace-scoped or account-scoped procedure
 * must use protectedProcedure or workspaceProcedure instead — see
 * ADR-0017 for why publicProcedure was the default everywhere before this.
 */
export const publicProcedure = t.procedure;

/** Requires a valid better-auth session; does not check resource ownership. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.user) {
		throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in required" });
	}
	return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * Requires a session AND, when the raw (pre-zod) input carries a
 * `workspaceId` field, verifies the caller owns that workspace before the
 * resolver runs. Reads via getRawInput() so this works as one shared
 * middleware across every procedure's own zod schema instead of needing a
 * bespoke check written into each resolver body.
 *
 * Procedures that only take an entity id (task/agent/chat/etc, no
 * workspaceId in the input) are NOT covered by this check — those look up
 * the entity's workspaceId themselves via requireEntityWorkspaceOwner
 * (workspace-guard.ts) at the top of the resolver.
 */
export const workspaceProcedure = protectedProcedure.use(async ({ ctx, next, getRawInput }) => {
	const raw = await getRawInput().catch(() => undefined);
	if (raw && typeof raw === "object" && "workspaceId" in raw) {
		const workspaceId = (raw as Record<string, unknown>).workspaceId;
		if (typeof workspaceId === "string") {
			const { requireWorkspaceOwner } = await import("./workspace-guard");
			await requireWorkspaceOwner(ctx.user.id, workspaceId);
		}
	}
	return next();
});
