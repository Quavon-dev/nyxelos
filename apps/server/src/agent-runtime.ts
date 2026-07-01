import type { AgentRecord, AgentRunRecord, TaskRecord } from "@nyxel/db";
import { getDb } from "@nyxel/db";
import { streamChat } from "@nyxel/model-providers";
import { getKnowledgeBaseContextForPrompt } from "./knowledge-base";
import { getInstalledProvidersForWorkspace } from "./models";
import { buildToolsForAgent, type AgentRunContext } from "./tools";

export interface ExecutionPlan {
	goal: string;
	successCriteria: string[];
	steps: string[];
	neededCapabilities: string[];
	delegationCandidates: string[];
	completionCheck: string;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
	const fenced = text.match(/```json\s*([\s\S]*?)```/i);
	const candidate = fenced?.[1] ?? text;
	try {
		return JSON.parse(candidate) as Record<string, unknown>;
	} catch {
		const firstBrace = candidate.indexOf("{");
		const lastBrace = candidate.lastIndexOf("}");
		if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
			return null;
		}
		try {
			return JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as Record<
				string,
				unknown
			>;
		} catch {
			return null;
		}
	}
}

function toExecutionPlan(task: TaskRecord, raw: string): ExecutionPlan {
	const parsed = extractJsonObject(raw);
	const stringArray = (value: unknown, fallback: string[]) =>
		Array.isArray(value)
			? value.filter((entry): entry is string => typeof entry === "string")
			: fallback;
	return {
		goal:
			typeof parsed?.goal === "string" ? parsed.goal : `${task.title}: ${task.instruction}`,
		successCriteria: stringArray(parsed?.successCriteria, [
			"Return a concrete result for the requested task.",
		]),
		steps: stringArray(parsed?.steps, [task.instruction]),
		neededCapabilities: stringArray(parsed?.neededCapabilities, []),
		delegationCandidates: stringArray(parsed?.delegationCandidates, []),
		completionCheck:
			typeof parsed?.completionCheck === "string"
				? parsed.completionCheck
				: "Verify the final result addresses the task instruction directly.",
	};
}

async function buildSystemPrompt(agent: AgentRecord) {
	const db = getDb();
	const [workspace, knowledgeBaseContext] = await Promise.all([
		db.getWorkspace(agent.workspaceId),
		getKnowledgeBaseContextForPrompt(agent.workspaceId),
	]);
	return (
		[workspace?.customInstructions, agent.systemPrompt, knowledgeBaseContext]
			.filter(Boolean)
			.join("\n\n") || undefined
	);
}

async function planTask(
	agent: AgentRecord,
	task: TaskRecord,
	instructionOverride?: string,
): Promise<ExecutionPlan> {
	const installedProviders = await getInstalledProvidersForWorkspace(agent.workspaceId);
	const systemPrompt = await buildSystemPrompt(agent);
	const planningPrompt = [
		"Create a compact JSON execution plan for this task.",
		"Return JSON only with keys: goal, successCriteria, steps, neededCapabilities, delegationCandidates, completionCheck.",
		`Task title: ${task.title}`,
		`Task instruction: ${buildTaskPrompt(task, instructionOverride)}`,
		agent.delegateAgentIds.length > 0
			? `Delegate candidates available: ${agent.delegateAgentIds.join(", ")}`
			: "Delegate candidates available: none",
	].join("\n");
	const result = streamChat({
		modelId: agent.modelId,
		systemPrompt,
		installedProviders,
		messages: [{ role: "user", content: planningPrompt }],
	});
	const raw = await result.text;
  return toExecutionPlan(task, raw);
}

function buildTaskPrompt(task: TaskRecord, instructionOverride?: string): string {
	const base = task.instruction.trim();
	const override = instructionOverride?.trim();
	if (!override) return base;
	return [
		"Original task:",
		base,
		"",
		"Follow-up instruction:",
		override,
	].join("\n");
}

async function runDirectExecution(
	agent: AgentRecord,
	task: TaskRecord,
	run: AgentRunRecord,
	instructionOverride?: string,
): Promise<string> {
	const installedProviders = await getInstalledProvidersForWorkspace(agent.workspaceId);
	const systemPrompt = await buildSystemPrompt(agent);
	const tools = await buildToolsForAgent(agent, {
		taskId: task.id,
		agentRunId: run.id,
	});
	const result = streamChat({
		modelId: agent.modelId,
		systemPrompt,
		installedProviders,
		tools,
		messages: [
			{ role: "user", content: buildTaskPrompt(task, instructionOverride) },
		],
	});
	return result.text;
}

export async function executeManagedTask(input: {
	taskId: string;
	agent: AgentRecord;
	trigger: "task" | "automation" | "delegate" | "chat";
	chatId?: string | null;
	automationId?: string | null;
	instructionOverride?: string;
}): Promise<{ task: TaskRecord; run: AgentRunRecord; output: string }> {
	const db = getDb();
	const task = await db.getTask(input.taskId);
	if (!task) throw new Error(`Unknown task: ${input.taskId}`);

	let run = await db.createAgentRun({
		workspaceId: task.workspaceId,
		taskId: task.id,
		agentId: input.agent.id,
		chatId: input.chatId ?? null,
		automationId: input.automationId ?? null,
		trigger: input.trigger,
		status: "running",
		startedAt: new Date(),
	});

	await db.updateTask(task.id, {
		status: "planning",
		startedAt: task.startedAt ?? new Date(),
		assignedAgentId: task.assignedAgentId ?? input.agent.id,
		completedAt: null,
		errorMessage: null,
	});
	await db.createTaskEvent({
		taskId: task.id,
		workspaceId: task.workspaceId,
		agentRunId: run.id,
		agentId: input.agent.id,
		kind: "run_started",
		message: `Run started by ${input.agent.name}.`,
	});

	const activeTask: TaskRecord = {
		...task,
		status: "planning",
		startedAt: task.startedAt ?? new Date(),
		assignedAgentId: task.assignedAgentId ?? input.agent.id,
		completedAt: null,
		errorMessage: null,
	};
	const plan = await planTask(input.agent, activeTask, input.instructionOverride);
	await db.updateTask(task.id, {
		status: "running",
		plan: plan as unknown as Record<string, unknown>,
		assignedAgentId: input.agent.id,
	});
	await db.createTaskEvent({
		taskId: task.id,
		workspaceId: task.workspaceId,
		agentRunId: run.id,
		agentId: input.agent.id,
		kind: "planned",
		message: "Execution plan created.",
		payload: plan as unknown as Record<string, unknown>,
	});

	let output: string;

	if (
		input.agent.autonomyLevel === "super_agent" &&
		input.agent.delegateAgentIds.length > 0 &&
		plan.delegationCandidates.length > 0
	) {
		const children: { agentId: string; resultSummary: string }[] = [];
		for (const delegateAgentId of plan.delegationCandidates) {
			if (!input.agent.delegateAgentIds.includes(delegateAgentId)) continue;
			const delegateAgent = await db.getAgent(delegateAgentId);
			if (!delegateAgent) continue;
			const childTask = await db.createTask({
				workspaceId: task.workspaceId,
				parentTaskId: task.id,
				createdByAgentId: input.agent.id,
				assignedAgentId: delegateAgent.id,
				title: `${task.title} · ${delegateAgent.name}`,
				instruction: task.instruction,
				status: "ready",
				priority: task.priority,
				input: { delegatedBy: input.agent.id, parentTaskId: task.id },
			});
			await db.createTaskEvent({
				taskId: task.id,
				workspaceId: task.workspaceId,
				agentRunId: run.id,
				agentId: input.agent.id,
				kind: "delegated",
				message: `Delegated child task to ${delegateAgent.name}.`,
				payload: { childTaskId: childTask.id, delegateAgentId: delegateAgent.id },
			});
			const childResult = await executeManagedTask({
				taskId: childTask.id,
				agent: delegateAgent,
				trigger: "delegate",
			});
			children.push({
				agentId: delegateAgent.id,
				resultSummary: childResult.output,
			});
		}

		const synthesisPrompt = [
			"Merge the delegated task results into one final response.",
			`Original task: ${buildTaskPrompt(task, input.instructionOverride)}`,
			"Delegated outputs:",
			...children.map(
				(child) => `- ${child.agentId}: ${child.resultSummary.slice(0, 4000)}`,
			),
		].join("\n");
		const installedProviders = await getInstalledProvidersForWorkspace(
			input.agent.workspaceId,
		);
		const systemPrompt = await buildSystemPrompt(input.agent);
		const synthesis = streamChat({
			modelId: input.agent.modelId,
			systemPrompt,
			installedProviders,
			messages: [{ role: "user", content: synthesisPrompt }],
		});
		output = await synthesis.text;
	} else {
		output = await runDirectExecution(
			input.agent,
			task,
			run,
			input.instructionOverride,
		);
	}

	run = await db.updateAgentRun(run.id, {
		status: output.includes("pending_approval")
			? "waiting_approval"
			: "completed",
		finalOutput: output,
		completedAt: output.includes("pending_approval") ? null : new Date(),
		stepCount: Math.max(1, plan.steps.length),
	});
	const finalTask = await db.updateTask(task.id, {
		status: output.includes("pending_approval")
			? "waiting_approval"
			: "completed",
		resultSummary: output,
		completedAt: output.includes("pending_approval") ? null : new Date(),
	});
	await db.createTaskEvent({
		taskId: task.id,
		workspaceId: task.workspaceId,
		agentRunId: run.id,
		agentId: input.agent.id,
		kind: output.includes("pending_approval") ? "approval_waiting" : "completed",
		message: output.includes("pending_approval")
			? "Run paused pending approval."
			: "Run completed.",
	});

	return { task: finalTask, run, output };
}

export async function startTaskExecutionIfIdle(input: {
	taskId: string;
	trigger: "task" | "automation" | "delegate" | "chat";
	chatId?: string | null;
	automationId?: string | null;
	instructionOverride?: string;
}): Promise<{ task: TaskRecord; run: AgentRunRecord; output: string } | null> {
	const db = getDb();
	const task = await db.getTask(input.taskId);
	if (!task || !task.assignedAgentId) return null;
	if (task.status === "completed" || task.status === "cancelled") return null;
	if (task.startedAt || task.status === "running" || task.status === "planning") {
		return null;
	}

	const agent = await db.getAgent(task.assignedAgentId);
	if (!agent) return null;

	return executeManagedTask({
		taskId: task.id,
		agent,
		trigger: input.trigger,
		chatId: input.chatId ?? task.sourceChatId ?? null,
		automationId: input.automationId ?? null,
		instructionOverride: input.instructionOverride,
	});
}
