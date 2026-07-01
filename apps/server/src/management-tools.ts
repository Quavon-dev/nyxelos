import type { AgentRecord } from "@nyxel/db";
import { getDb } from "@nyxel/db";
import { type Tool, tool } from "ai";
import { z } from "zod";
import { startTaskExecutionIfIdle } from "./agent-runtime";
import { getWorkspaceDefaultToolIds } from "./auto-agent";
import { computeNextRunAt } from "./scheduler";

function defaultAutonomyLevel(input: {
	role?: string | null;
	autonomyLevel?: AgentRecord["autonomyLevel"];
}) {
	if (input.autonomyLevel) return input.autonomyLevel;
	const role = input.role?.toLowerCase() ?? "";
	return /orchestr|manager|lead|supervisor/.test(role)
		? "super_agent"
		: "assisted";
}

function defaultSystemPrompt(input: {
	name: string;
	role?: string | null;
	goalTemplate?: string | null;
}) {
	const parts = [
		`You are ${input.name}.`,
		input.role ? `Role: ${input.role}.` : null,
		input.goalTemplate
			? `Default goal pattern: ${input.goalTemplate}.`
			: null,
		"Operate inside the assigned workspace and only use tools needed for the current task.",
	];
	return parts.filter(Boolean).join(" ");
}

export async function buildWorkspaceManagementTools(
	agent: AgentRecord,
	ctx: { chatId?: string } = {},
): Promise<Record<string, Tool>> {
	const db = getDb();
	const workspaceId = agent.workspaceId;

	return {
		workspace_agent_list: tool({
			description:
				"List saved agents in this workspace, including autonomy, role, and delegate policy.",
			inputSchema: z.object({}),
			execute: async () => db.listAgentsByWorkspace(workspaceId),
		}),

		workspace_agent_create: tool({
			description:
				"Create a workspace agent. Use for requests like creating coding, marketing, security, or orchestrator agents.",
			inputSchema: z.object({
				name: z.string().min(1),
				role: z.string().optional(),
				goalTemplate: z.string().optional(),
				systemPrompt: z.string().optional(),
				modelId: z.string(),
				autonomyLevel: z
					.enum(["chat", "assisted", "autonomous", "super_agent"])
					.optional(),
				mcpServerIds: z.array(z.string()).optional(),
				toolIds: z.array(z.string()).optional(),
				skillIds: z.array(z.string()).optional(),
				delegateAgentIds: z.array(z.string()).optional(),
				autoAttachWorkspaceTools: z.boolean().default(true),
			}),
			execute: async (input) => {
				const workspaceDefaults = input.autoAttachWorkspaceTools
					? await getWorkspaceDefaultToolIds(workspaceId)
					: {
							skillIds: input.skillIds ?? [],
							toolIds: input.toolIds ?? [],
							mcpServerIds: input.mcpServerIds ?? [],
						};
				return db.createAgent({
					workspaceId,
					name: input.name,
					role: input.role ?? null,
					goalTemplate: input.goalTemplate ?? null,
					systemPrompt:
						input.systemPrompt ??
						defaultSystemPrompt({
							name: input.name,
							role: input.role,
							goalTemplate: input.goalTemplate,
						}),
					modelId: input.modelId,
					autonomyLevel: defaultAutonomyLevel(input),
					skillIds: workspaceDefaults.skillIds,
					toolIds: workspaceDefaults.toolIds,
					mcpServerIds: workspaceDefaults.mcpServerIds,
					delegateAgentIds: input.delegateAgentIds ?? [],
				});
			},
		}),

		workspace_agent_update: tool({
			description:
				"Update a saved workspace agent's prompt, role, model, autonomy, or tool assignments.",
			inputSchema: z.object({
				agentId: z.string(),
				name: z.string().optional(),
				role: z.string().nullable().optional(),
				goalTemplate: z.string().nullable().optional(),
				systemPrompt: z.string().nullable().optional(),
				modelId: z.string().optional(),
				autonomyLevel: z
					.enum(["chat", "assisted", "autonomous", "super_agent"])
					.optional(),
				mcpServerIds: z.array(z.string()).optional(),
				toolIds: z.array(z.string()).optional(),
				skillIds: z.array(z.string()).optional(),
				delegateAgentIds: z.array(z.string()).optional(),
			}),
			execute: async ({ agentId, ...input }) => db.updateAgent(agentId, input),
		}),

		workspace_agent_assign_delegate: tool({
			description:
				"Assign or replace the delegate whitelist for a super-agent.",
			inputSchema: z.object({
				agentId: z.string(),
				delegateAgentIds: z.array(z.string()),
			}),
			execute: async ({ agentId, delegateAgentIds }) =>
				db.updateAgent(agentId, { delegateAgentIds }),
		}),

		workspace_task_create: tool({
			description:
				"Create a durable workspace task and optionally assign it to an agent.",
			inputSchema: z.object({
				title: z.string().min(1),
				instruction: z.string().min(1),
				assignedAgentId: z.string().optional(),
				parentTaskId: z.string().optional(),
				priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
				input: z.record(z.string(), z.unknown()).optional(),
			}),
			execute: async (input) =>
				{
				const task = await db.createTask({
					workspaceId,
					parentTaskId: input.parentTaskId ?? null,
					sourceChatId: ctx.chatId ?? null,
					createdByAgentId: agent.id,
					assignedAgentId: input.assignedAgentId ?? null,
					title: input.title,
					instruction: input.instruction,
					priority: input.priority ?? "normal",
					status: input.assignedAgentId ? "ready" : "pending",
					input: input.input ?? {},
				});
				await db.createTaskEvent({
					taskId: task.id,
					workspaceId,
					kind: "created",
					message: `Task created: ${task.title}`,
					payload: { title: task.title, priority: task.priority },
				});
				if (task.assignedAgentId) {
					await db.createTaskEvent({
						taskId: task.id,
						workspaceId,
						agentId: task.assignedAgentId,
						kind: "assigned",
						message: `Task assigned to agent ${task.assignedAgentId}`,
						payload: { assignedAgentId: task.assignedAgentId },
					});
					void startTaskExecutionIfIdle({
						taskId: task.id,
						trigger: "chat",
						chatId: ctx.chatId ?? null,
					});
				}
				return task;
				},
		}),

		workspace_task_assign: tool({
			description:
				"Assign an existing durable task to an agent and mark it ready to run.",
			inputSchema: z.object({
				taskId: z.string(),
				assignedAgentId: z.string(),
			}),
			execute: async ({ taskId, assignedAgentId }) => {
				const task = await db.updateTask(taskId, {
					assignedAgentId,
					status: "ready",
				});
				await db.createTaskEvent({
					taskId: task.id,
					workspaceId,
					agentId: assignedAgentId,
					kind: "assigned",
					message: `Task assigned to agent ${assignedAgentId}`,
					payload: { assignedAgentId },
				});
				void startTaskExecutionIfIdle({
					taskId: task.id,
					trigger: "chat",
				});
				return task;
			},
		}),

		workspace_task_list: tool({
			description:
				"List workspace tasks filtered by status and assignee when needed.",
			inputSchema: z.object({
				status: z
					.enum([
						"pending",
						"planning",
						"ready",
						"running",
						"blocked",
						"waiting_approval",
						"completed",
						"failed",
						"cancelled",
					])
					.optional(),
				assignedAgentId: z.string().nullable().optional(),
			}),
			execute: async (input) => db.listTasksByWorkspace(workspaceId, input),
		}),

		workspace_task_get: tool({
			description:
				"Get one task together with its child tasks and timeline events.",
			inputSchema: z.object({
				taskId: z.string(),
			}),
			execute: async ({ taskId }) => ({
				task: await db.getTask(taskId),
				children: await db.listTaskTree(taskId),
				events: await db.listTaskEvents(taskId),
				runs: await db.listAgentRunsByTask(taskId),
			}),
		}),

		workspace_task_complete: tool({
			description:
				"Mark a task complete and attach a final summary.",
			inputSchema: z.object({
				taskId: z.string(),
				resultSummary: z.string().min(1),
			}),
			execute: async ({ taskId, resultSummary }) => {
				const task = await db.updateTask(taskId, {
					status: "completed",
					resultSummary,
					completedAt: new Date(),
				});
				await db.createTaskEvent({
					taskId: task.id,
					workspaceId,
					kind: "completed",
					message: "Task marked complete.",
					payload: { resultSummary },
				});
				return task;
			},
		}),

		workspace_automation_create: tool({
			description:
				"Create a workspace automation for an autonomous or super-agent.",
			inputSchema: z.object({
				agentId: z.string(),
				name: z.string().min(1),
				prompt: z.string().min(1),
				triggerType: z.enum(["cron", "file_watch"]).default("cron"),
				cronExpression: z.string().optional(),
				watchPath: z.string().optional(),
				watchGlob: z.string().optional(),
			}),
			execute: async (input) => {
				const nextRunAt =
					input.triggerType === "cron" && input.cronExpression
						? computeNextRunAt(input.cronExpression, new Date())
						: null;
				return db.createAutomation({
					workspaceId,
					agentId: input.agentId,
					name: input.name,
					prompt: input.prompt,
					triggerType: input.triggerType,
					cronExpression: input.triggerType === "cron" ? input.cronExpression ?? "" : "",
					watchPath: input.watchPath ?? null,
					watchGlob: input.watchGlob ?? null,
					nextRunAt,
				});
			},
		}),

		workspace_automation_list: tool({
			description:
				"List configured automations in this workspace.",
			inputSchema: z.object({}),
			execute: async () => db.listAutomationsByWorkspace(workspaceId),
		}),
	};
}
