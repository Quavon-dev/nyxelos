import { getDb } from "@nyxel/db";
import { TRPCError } from "@trpc/server";

/**
 * Every workspace has exactly one owner (workspace.userId) — NyxelOS is
 * single-owner-per-workspace today (ARCHITECTURE.md section 11: "a clean
 * single-user implementation" is the current target, team support is
 * future work). Ownership check is therefore a direct equality test, not
 * an ACL/role lookup.
 */
export async function requireWorkspaceOwner(userId: string, workspaceId: string) {
	const workspace = await getDb().getWorkspace(workspaceId);
	if (!workspace || workspace.userId !== userId) {
		throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized for this workspace" });
	}
	return workspace;
}

/**
 * For procedures that only take an entity id (no workspaceId in the input
 * directly) — looks the entity up, then checks its workspace's owner
 * matches the caller. `getEntity` is one of the DbRepository's existing
 * getters (getTask, getAgent, getChat, ...), all of which return a record
 * carrying workspaceId. Throws NOT_FOUND if the entity doesn't exist so a
 * missing id and an unauthorized id look the same to the caller.
 */
export async function requireEntityWorkspaceOwner<T extends { workspaceId: string }>(
	userId: string,
	getEntity: () => Promise<T | null>,
	notFoundMessage: string,
): Promise<T> {
	const entity = await getEntity();
	if (!entity) {
		throw new TRPCError({ code: "NOT_FOUND", message: notFoundMessage });
	}
	await requireWorkspaceOwner(userId, entity.workspaceId);
	return entity;
}
