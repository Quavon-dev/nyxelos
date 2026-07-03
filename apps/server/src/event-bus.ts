import type { DbRepository, NyxelEventRecord, NyxelEventType } from "@nyxel/db";
import { getDb } from "@nyxel/db";
import type { NyxelEventEntityType } from "./events";

type NyxelEventHandler = (event: NyxelEventRecord) => void | Promise<void>;

/** Process-local subscriber registry — v1's whole "dispatch" mechanism.
 * Deliberately not Redis/BullMQ/a queue: emitNyxelEvent already runs
 * in-process at the moment the event happens, so an in-memory fan-out is
 * enough for anything that reacts synchronously within this server process.
 * Does not survive a restart and isn't shared across processes — a real
 * queue only becomes worth it once something needs either of those. */
const subscribers = new Map<NyxelEventType | "*", Set<NyxelEventHandler>>();

/** Registers `handler` to run after every persisted event of `type` (or
 * every event, via `"*"`). Returns an unsubscribe function. Handler errors
 * are caught and logged per-handler — one broken subscriber can't stop
 * sibling subscribers or the emitting call site. No autonomy is wired up
 * here in v1; this is just the plumbing for whatever's added next. */
export function onNyxelEvent(type: NyxelEventType | "*", handler: NyxelEventHandler): () => void {
	const set = subscribers.get(type) ?? new Set();
	set.add(handler);
	subscribers.set(type, set);
	return () => set.delete(handler);
}

async function dispatchNyxelEvent(event: NyxelEventRecord): Promise<void> {
	const handlers = [...(subscribers.get(event.type) ?? []), ...(subscribers.get("*") ?? [])];
	for (const handler of handlers) {
		try {
			await handler(event);
		} catch (err) {
			console.error(`Nyxel event handler failed for ${event.type}`, err);
		}
	}
}

/**
 * Persists one system event to the event-bus v1 fundament (`nyxel_event`
 * table) so automations/agents can later react to it, then fans it out to
 * any in-process subscribers (see onNyxelEvent). Never store raw tool
 * input/output or secrets in `payload` — small structured facts only (ids,
 * counts, status strings), same rule as `logAudit`'s `permissionSnapshot`.
 *
 * Failures are swallowed — a broken event write should never take down the
 * agent run / approval / workflow flow it's describing (same rationale as
 * `logAudit` in ./audit.ts).
 *
 * `db` defaults to the real singleton and only exists as a seam for tests —
 * callers should never pass it.
 */
export async function emitNyxelEvent(
	input: {
		workspaceId: string;
		type: NyxelEventType;
		entityType: NyxelEventEntityType;
		entityId: string;
		payload?: Record<string, unknown> | null;
	},
	db: Pick<DbRepository, "createNyxelEvent"> = getDb(),
): Promise<void> {
	try {
		const event = await db.createNyxelEvent({
			workspaceId: input.workspaceId,
			type: input.type,
			entityType: input.entityType,
			entityId: input.entityId,
			payload: input.payload ?? null,
		});
		await dispatchNyxelEvent(event);
	} catch (err) {
		console.error("Failed to emit nyxel event", input.type, err);
	}
}
