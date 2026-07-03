import type { DbRepository } from "@nyxel/db";
import { describe, expect, it, mock } from "bun:test";
import { emitNyxelEvent, onNyxelEvent } from "./event-bus";

describe("emitNyxelEvent", () => {
	it("persists the event with a null payload by default", async () => {
		const createNyxelEvent = mock(async (input: unknown) => ({
			id: "evt_1",
			createdAt: new Date(),
			...(input as object),
		}));
		const db = { createNyxelEvent } as unknown as Pick<DbRepository, "createNyxelEvent">;

		await emitNyxelEvent(
			{
				workspaceId: "ws_1",
				type: "agent.run.started",
				entityType: "agent_run",
				entityId: "run_1",
			},
			db,
		);

		expect(createNyxelEvent).toHaveBeenCalledTimes(1);
		expect(createNyxelEvent).toHaveBeenCalledWith({
			workspaceId: "ws_1",
			type: "agent.run.started",
			entityType: "agent_run",
			entityId: "run_1",
			payload: null,
		});
	});

	it("passes an explicit payload through unchanged", async () => {
		const createNyxelEvent = mock(async (input: unknown) => ({
			id: "evt_2",
			createdAt: new Date(),
			...(input as object),
		}));
		const db = { createNyxelEvent } as unknown as Pick<DbRepository, "createNyxelEvent">;

		await emitNyxelEvent(
			{
				workspaceId: "ws_1",
				type: "workflow.completed",
				entityType: "workflow_run",
				entityId: "run_2",
				payload: { nodeCount: 3 },
			},
			db,
		);

		expect(createNyxelEvent).toHaveBeenCalledWith(
			expect.objectContaining({ payload: { nodeCount: 3 } }),
		);
	});

	it("swallows db errors instead of throwing", async () => {
		const createNyxelEvent = mock(async () => {
			throw new Error("db unavailable");
		});
		const db = { createNyxelEvent } as unknown as Pick<DbRepository, "createNyxelEvent">;

		await expect(
			emitNyxelEvent(
				{
					workspaceId: "ws_1",
					type: "task.failed",
					entityType: "task",
					entityId: "task_1",
				},
				db,
			),
		).resolves.toBeUndefined();
	});
});

describe("onNyxelEvent", () => {
	const db = {
		createNyxelEvent: mock(async (input: unknown) => ({
			id: "evt_3",
			createdAt: new Date(),
			...(input as object),
		})),
	} as unknown as Pick<DbRepository, "createNyxelEvent">;

	it('calls subscribers registered for the matching type and for "*"', async () => {
		const typed = mock(() => {});
		const wildcard = mock(() => {});
		const unsubTyped = onNyxelEvent("approval.created", typed);
		const unsubWildcard = onNyxelEvent("*", wildcard);

		await emitNyxelEvent(
			{
				workspaceId: "ws_1",
				type: "approval.created",
				entityType: "approval_request",
				entityId: "approval_1",
			},
			db,
		);

		expect(typed).toHaveBeenCalledTimes(1);
		expect(wildcard).toHaveBeenCalledTimes(1);
		unsubTyped();
		unsubWildcard();
	});

	it("does not call subscribers registered for a different type", async () => {
		const handler = mock(() => {});
		const unsubscribe = onNyxelEvent("workflow.completed", handler);

		await emitNyxelEvent(
			{
				workspaceId: "ws_1",
				type: "approval.resolved",
				entityType: "approval_request",
				entityId: "approval_2",
			},
			db,
		);

		expect(handler).not.toHaveBeenCalled();
		unsubscribe();
	});

	it("isolates a throwing handler from other subscribers and the caller", async () => {
		const broken = mock(() => {
			throw new Error("subscriber exploded");
		});
		const healthy = mock(() => {});
		const unsubBroken = onNyxelEvent("task.failed", broken);
		const unsubHealthy = onNyxelEvent("task.failed", healthy);

		await expect(
			emitNyxelEvent(
				{
					workspaceId: "ws_1",
					type: "task.failed",
					entityType: "task",
					entityId: "task_2",
				},
				db,
			),
		).resolves.toBeUndefined();

		expect(healthy).toHaveBeenCalledTimes(1);
		unsubBroken();
		unsubHealthy();
	});

	it("stops calling a handler after it unsubscribes", async () => {
		const handler = mock(() => {});
		const unsubscribe = onNyxelEvent("automation.triggered", handler);
		unsubscribe();

		await emitNyxelEvent(
			{
				workspaceId: "ws_1",
				type: "automation.triggered",
				entityType: "automation",
				entityId: "automation_1",
			},
			db,
		);

		expect(handler).not.toHaveBeenCalled();
	});
});
