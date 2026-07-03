import {
	buildPermissionSnapshot,
	hashToolInput,
	permissionForSource,
	permissionForToolKind,
} from "@nyxel/core-agent-engine";
import type { AgentRecord, AuditStatus, ChatToolPolicy, ToolKind } from "@nyxel/db";
import { DEFAULT_CHAT_TOOL_POLICY, getDb } from "@nyxel/db";
import {
	createSkillContext,
	createWorkspaceFileAppendSkill,
	createWorkspaceFileDeleteSkill,
	createWorkspaceFileListSkill,
	createWorkspaceFileMoveSkill,
	createWorkspaceFilePatchSkill,
	createWorkspaceFileReadSkill,
	createWorkspaceFileReadRangeSkill,
	createWorkspaceFileStatSkill,
	createWorkspaceFileWriteSkill,
} from "@nyxel/skills-sdk";
import { dynamicTool, jsonSchema, type ToolSet, tool } from "ai";
import { z } from "zod";
import { isAutoAssistant } from "./auto-agent";
import { logAudit } from "./audit";
import {
	type AutonomyBudgetTracker,
	checkAndConsumeRunBudget,
	createAutonomyBudgetTracker,
	exceedsRiskThreshold,
	isToolKindAllowed,
	resolveAutonomyBudget,
} from "./autonomy-budget";
import { buildDelegateToAgentTool } from "./delegation";
import { buildWorkspaceManagementTools } from "./management-tools";
import { ensureMcpServerConnected, mcpManager } from "./mcp-runtime";
import { notifyWorkspaceOwner } from "./push";
import { resolveSkillDefinition } from "./skills-resolve";
import { resolveToolDefinition } from "./tools-resolve";
import { buildRunWorkflowTool } from "./workflow-tool";

/**
 * Unattended task/automation runs have no human present to act on an
 * approval request, so an agent whose autonomy level says it should run
 * unattended ("autonomous"/"super_agent" — see ADR-0011, the same set
 * `AUTOMATABLE_LEVELS` in trpc/router.ts allows to be scheduled) must not
 * have its tool calls silently deferred. Lower autonomy levels keep the
 * default human-in-the-loop approval gate.
 */
export function toolPolicyForAutonomyLevel(
	autonomyLevel: AgentRecord["autonomyLevel"],
): ChatToolPolicy {
	if (autonomyLevel === "autonomous" || autonomyLevel === "super_agent") {
		return { ...DEFAULT_CHAT_TOOL_POLICY, mode: "auto" };
	}
	return DEFAULT_CHAT_TOOL_POLICY;
}

export interface AgentRunContext {
	/** Set when this run is a live chat turn. */
	chatId?: string;
	/** Fixed per-chat root directory for builtin file tools. */
	workingDirectory?: string;
	/** Per-chat tool execution policy, loaded from the chat row. */
	chatToolPolicy?: ChatToolPolicy;
	/** Set when this run is an unattended scheduled run. See ADR-0010. */
	automationId?: string;
	/** Set when this run is attached to a durable task. */
	taskId?: string;
	/** Set when this run is attached to a durable agent run row. */
	agentRunId?: string;
	/**
	 * Whether this agent is allowed to expose delegate_to_agent. Defaults to
	 * true; set to false when building tools for a *delegated* sub-agent
	 * invocation, so a chain of super-agents can't delegate to each other in
	 * a cycle. See ADR-0011.
	 */
	allowDelegation?: boolean;
	/**
	 * Autonomy Budgets v1 (see ./autonomy-budget.ts) — per-run tool-call/
	 * runtime/file-write counters. Callers that need to inspect the outcome
	 * after the run (agent-runtime.ts, to decide whether to pause the task)
	 * create one themselves and pass it in; otherwise a fresh tracker is
	 * built from the agent's own autonomyBudget so every caller (including
	 * live chat turns) gets the allow/block-list and risk-threshold
	 * protections even without wiring this through explicitly.
	 */
	budgetTracker?: AutonomyBudgetTracker;
}

function actorFor(ctx: AgentRunContext): "chat" | "automation" {
	return ctx.automationId ? "automation" : "chat";
}

/**
 * Every tool-call audit entry goes through here rather than calling
 * logAudit directly, so `inputHash`/`permissionSnapshot` (ADR-0017) are
 * computed consistently for all three tool sources (skill/workspace
 * tool/MCP) instead of being recomputed ad hoc at each of the nine call
 * sites below.
 */
async function logToolAudit(input: {
	workspaceId: string;
	agentId: string;
	chatId?: string;
	automationId?: string;
	actor: "chat" | "automation";
	toolLabel: string;
	input: unknown;
	output?: unknown;
	status: AuditStatus;
	autonomyLevel: AgentRecord["autonomyLevel"];
	policyMode: ChatToolPolicy["mode"];
	category: ReturnType<typeof permissionForSource>;
}) {
	const [inputHash, permissionSnapshot] = await Promise.all([
		hashToolInput(input.input),
		Promise.resolve(
			buildPermissionSnapshot({
				category: input.category,
				autonomyLevel: input.autonomyLevel,
				policyMode: input.policyMode,
				requiredApproval: input.status === "pending_approval",
			}),
		),
	]);
	await logAudit({
		workspaceId: input.workspaceId,
		agentId: input.agentId,
		chatId: input.chatId,
		automationId: input.automationId,
		actor: input.actor,
		toolLabel: input.toolLabel,
		input: input.input,
		output: input.output,
		status: input.status,
		inputHash,
		permissionSnapshot,
	});
}

/**
 * A pending-approval placeholder returned to the model in place of a
 * sensitive tool's real output. See ADR-0009 — the tool call returns
 * immediately so the chat turn / scheduled run can finish; the actual
 * action only happens once a human calls approvals.approve.
 */
function pendingApprovalResult(approvalId: string, toolLabel: string) {
	return {
		status: "pending_approval" as const,
		approvalId,
		message: `"${toolLabel}" requires human approval before it runs and has been queued (approval id: ${approvalId}). Do not assume it has completed — tell the user it's awaiting approval in the workspace's Approvals page.`,
	};
}

/**
 * Returned in place of a tool's real output when Autonomy Budgets v1 (see
 * ./autonomy-budget.ts) blocks the call outright — no approval is queued
 * because there is nothing to approve, this action simply isn't allowed to
 * run under the agent's current budget. Mirrors pendingApprovalResult's
 * shape: the tool call itself never throws, so the model's turn (and the
 * run overall) finishes cleanly instead of crashing.
 */
function budgetExceededResult(toolLabel: string, reason: string) {
	return {
		status: "budget_exceeded" as const,
		message: `"${toolLabel}" was blocked by this agent's autonomy budget: ${reason} Do not retry this action — summarize progress so far and this limit in your final answer instead.`,
	};
}

/**
 * Model providers (Gemini in particular) validate function/tool names
 * against `^[a-zA-Z_][a-zA-Z0-9_.:-]{0,127}$`. MCP server display names are
 * free text (e.g. "SEO/GEO/AEO Analyzer") and were being used verbatim in
 * the tool key, so any server name with a space or slash broke every tool
 * call for that server with a 400 from the provider. Sanitize before using
 * a name as part of a model-facing tool key.
 */
function sanitizeToolNamePart(name: string): string {
	const cleaned = name.replace(/[^a-zA-Z0-9_.:-]/g, "_");
	return /^[a-zA-Z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

function classifyBuiltinSkillKind(skillId: string): ToolKind | null {
	switch (skillId) {
		case "workspace_file_read":
		case "workspace_file_read_range":
		case "workspace_file_stat":
			return "file_read";
		case "workspace_file_list":
			return "file_list";
		case "workspace_file_write":
		case "workspace_file_append":
		case "workspace_file_patch":
		case "workspace_file_move":
		case "write_note":
			return "file_write";
		case "workspace_file_delete":
			return "file_delete";
		default:
			return null;
	}
}

function normalizeChatToolPolicy(
	policy: ChatToolPolicy | undefined,
): ChatToolPolicy {
	return policy ?? DEFAULT_CHAT_TOOL_POLICY;
}

export function buildChatScopedBuiltinSkill(
	skillId: string,
	workingDirectory: string,
) {
	switch (skillId) {
		case "workspace_file_read":
			return createWorkspaceFileReadSkill(workingDirectory);
		case "workspace_file_read_range":
			return createWorkspaceFileReadRangeSkill(workingDirectory);
		case "workspace_file_list":
			return createWorkspaceFileListSkill(workingDirectory);
		case "workspace_file_stat":
			return createWorkspaceFileStatSkill(workingDirectory);
		case "workspace_file_write":
			return createWorkspaceFileWriteSkill(workingDirectory);
		case "workspace_file_append":
			return createWorkspaceFileAppendSkill(workingDirectory);
		case "workspace_file_patch":
			return createWorkspaceFilePatchSkill(workingDirectory);
		case "workspace_file_move":
			return createWorkspaceFileMoveSkill(workingDirectory);
		case "workspace_file_delete":
			return createWorkspaceFileDeleteSkill(workingDirectory);
		default:
			return null;
	}
}

/**
 * Tool kinds that stay gated behind human approval even for
 * "autonomous"/"super_agent" agents whose policy.mode is "auto" (see
 * toolPolicyForAutonomyLevel above). Full autonomy must never mean
 * unbounded shell execution or destructive file operations — these are
 * the categories with the least reversibility and the largest blast
 * radius, so "auto" mode is not allowed to waive approval for them the
 * way it does for everything else. See ADR-0017.
 */
const ALWAYS_REQUIRES_APPROVAL_KINDS = new Set<ToolKind>([
	"terminal_run",
	"terminal_send_input",
	"terminal_kill",
	"task_run",
	"test_run",
	"custom_code",
	"file_delete",
	"browser_run_playwright_code",
]);

export function shouldDeferToolForApproval(
	target:
		| { kind: "mcp" }
		| {
				kind: "skill" | "tool";
				sensitive: boolean;
				toolKind: ToolKind | null;
		  },
	policy: ChatToolPolicy | undefined,
): boolean {
	const effectivePolicy = normalizeChatToolPolicy(policy);

	if (
		target.kind !== "mcp" &&
		target.toolKind &&
		ALWAYS_REQUIRES_APPROVAL_KINDS.has(target.toolKind)
	) {
		return true;
	}

	// AUTO mode: the agent runs fully autonomously — never defer anything
	// else. Individual guardrail switches are only meaningful in "automatic"
	// mode.
	if (effectivePolicy.mode === "auto") return false;

	if (target.kind === "mcp") {
		return effectivePolicy.mode === "default"
			? true
			: effectivePolicy.approveMcpTools;
	}

	if (!target.sensitive) return false;
	if (effectivePolicy.mode === "default") return true;

	// "automatic" mode — respect individual guardrail flags.
	switch (target.toolKind) {
		case "file_write":
			return effectivePolicy.approveFileWrites;
		case "file_delete":
			return effectivePolicy.approveFileDeletes;
		case "custom_code":
			return effectivePolicy.approveCustomCode;
		default:
			return true;
	}
}

/**
 * Builds the AI SDK tool set an agent is allowed to call for one run: its
 * assigned runtime skills (packages/skills-sdk), workspace tools
 * (DB-backed config), tools from its assigned, connected MCP servers
 * (packages/mcp-client), and — for super-agents — a delegate_to_agent tool.
 * Sensitive actions (skill.sensitive === true; tool.sensitive === true; every
 * MCP tool, since their side effects aren't declared) are deferred for
 * approval instead of executed immediately (ADR-0009). Unknown/removed
 * skills/tools and unreachable MCP servers are skipped rather than failing
 * the whole run — a partially-degraded tool set is better than no response at
 * all.
 */
export async function buildToolsForAgent(
	agent: AgentRecord,
	ctx: AgentRunContext = {},
): Promise<ToolSet> {
	const tools: ToolSet = {};
	const db = getDb();
	const actor = actorFor(ctx);
	// Autonomy Budgets v1 (ADR: none yet, see ./autonomy-budget.ts) — a caller
	// that needs to inspect the outcome after the run (agent-runtime.ts, to
	// decide whether to pause the task) passes its own tracker in; every
	// other caller (e.g. a live chat turn) still gets a fresh one built from
	// the agent's own budget, so allow/block-lists and the risk-threshold
	// approval gate below apply everywhere tools are built.
	const budgetTracker = ctx.budgetTracker ?? createAutonomyBudgetTracker(resolveAutonomyBudget(agent));

	for (const skillId of agent.skillIds) {
		const chatScopedBuiltin = ctx.workingDirectory
			? buildChatScopedBuiltinSkill(skillId, ctx.workingDirectory)
			: null;
		const skill =
			chatScopedBuiltin ??
			(await resolveSkillDefinition(agent.workspaceId, skillId));
		if (!skill) continue;
		// Sanitized because this key doubles as the model-facing function name
		// (see sanitizeToolNamePart) — file/plugin skill ids are safe already,
		// but nothing here guarantees a leading letter/underscore.
		const skillToolKey = sanitizeToolNamePart(skill.id).slice(0, 128);
		tools[skillToolKey] = tool({
			description: skill.description,
			inputSchema: skill.inputSchema,
			execute: async (input) => {
				const skillKind = classifyBuiltinSkillKind(skill.id);
				const skillCategory = skillKind
					? permissionForToolKind(skillKind)
					: permissionForSource("skill");
				const skillKindCheck = isToolKindAllowed(budgetTracker.budget, skillKind);
				if (!skillKindCheck.allowed) {
					await logToolAudit({
						workspaceId: agent.workspaceId,
						agentId: agent.id,
						chatId: ctx.chatId,
						automationId: ctx.automationId,
						actor,
						toolLabel: skill.id,
						input,
						status: "rejected",
						autonomyLevel: agent.autonomyLevel,
						policyMode: normalizeChatToolPolicy(ctx.chatToolPolicy).mode,
						category: skillCategory,
					});
					if (ctx.taskId) {
						await db.createTaskEvent({
							taskId: ctx.taskId,
							workspaceId: agent.workspaceId,
							agentRunId: ctx.agentRunId,
							agentId: agent.id,
							kind: "failed",
							message: `Autonomy budget blocked "${skill.id}": ${skillKindCheck.reason}`,
							payload: { toolLabel: skill.id, reason: skillKindCheck.reason },
						});
					}
					return budgetExceededResult(skill.id, skillKindCheck.reason ?? "Blocked by autonomy budget.");
				}
				if (
					shouldDeferToolForApproval(
						{ kind: "skill", sensitive: skill.sensitive, toolKind: skillKind },
						ctx.chatToolPolicy,
					) ||
					exceedsRiskThreshold(skillCategory, budgetTracker.budget.requiresApprovalAboveRisk)
				) {
					const approval = await db.createApprovalRequest({
						workspaceId: agent.workspaceId,
						agentId: agent.id,
						chatId: ctx.chatId,
						automationId: ctx.automationId,
						taskId: ctx.taskId,
						agentRunId: ctx.agentRunId,
						kind: "skill",
						skillId: skill.id,
						toolId: null,
						toolLabel: skill.id,
						input: input as Record<string, unknown>,
					});
					await logToolAudit({
						workspaceId: agent.workspaceId,
						agentId: agent.id,
						chatId: ctx.chatId,
						automationId: ctx.automationId,
						actor,
						toolLabel: skill.id,
						input,
						status: "pending_approval",
						autonomyLevel: agent.autonomyLevel,
						policyMode: normalizeChatToolPolicy(ctx.chatToolPolicy).mode,
						category: skillKind ? permissionForToolKind(skillKind) : permissionForSource("skill"),
					});
					await notifyWorkspaceOwner(agent.workspaceId, {
						title: "Approval needed",
						body: `${agent.name} wants to run "${skill.id}"`,
						url: `/workspace/${agent.workspaceId}/approvals`,
						tag: `approval-${approval.id}`,
					});
					if (ctx.taskId) {
						await db.createTaskEvent({
							taskId: ctx.taskId,
							workspaceId: agent.workspaceId,
							agentRunId: ctx.agentRunId,
							agentId: agent.id,
							kind: "approval_waiting",
							message: `Waiting for approval: ${skill.id}`,
							payload: { approvalId: approval.id, toolLabel: skill.id },
						});
					}
					return pendingApprovalResult(approval.id, skill.id);
				}

				const skillBudgetCheck = checkAndConsumeRunBudget(budgetTracker, skillKind);
				if (!skillBudgetCheck.allowed) {
					await logToolAudit({
						workspaceId: agent.workspaceId,
						agentId: agent.id,
						chatId: ctx.chatId,
						automationId: ctx.automationId,
						actor,
						toolLabel: skill.id,
						input,
						status: "rejected",
						autonomyLevel: agent.autonomyLevel,
						policyMode: normalizeChatToolPolicy(ctx.chatToolPolicy).mode,
						category: skillCategory,
					});
					if (ctx.taskId) {
						await db.createTaskEvent({
							taskId: ctx.taskId,
							workspaceId: agent.workspaceId,
							agentRunId: ctx.agentRunId,
							agentId: agent.id,
							kind: "failed",
							message: `Autonomy budget blocked "${skill.id}": ${skillBudgetCheck.reason}`,
							payload: { toolLabel: skill.id, reason: skillBudgetCheck.reason },
						});
					}
					return budgetExceededResult(skill.id, skillBudgetCheck.reason ?? "Blocked by autonomy budget.");
				}

				try {
					const parsedInput = skill.inputSchema.parse(input);
					const skillCtx = createSkillContext(skill.permissions);
					const output = await skill.run(parsedInput, skillCtx);
					await logToolAudit({
						workspaceId: agent.workspaceId,
						agentId: agent.id,
						chatId: ctx.chatId,
						automationId: ctx.automationId,
						actor,
						toolLabel: skill.id,
						input,
						output,
						status: "success",
						autonomyLevel: agent.autonomyLevel,
						policyMode: normalizeChatToolPolicy(ctx.chatToolPolicy).mode,
						category: skillKind ? permissionForToolKind(skillKind) : permissionForSource("skill"),
					});
					if (ctx.taskId) {
						await db.createTaskEvent({
							taskId: ctx.taskId,
							workspaceId: agent.workspaceId,
							agentRunId: ctx.agentRunId,
							agentId: agent.id,
							kind: "tool_called",
							message: `Tool succeeded: ${skill.id}`,
							payload: {
								toolLabel: skill.id,
							},
						});
					}
					return output;
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					await logToolAudit({
						workspaceId: agent.workspaceId,
						agentId: agent.id,
						chatId: ctx.chatId,
						automationId: ctx.automationId,
						actor,
						toolLabel: skill.id,
						input,
						output: { error: message },
						status: "error",
						autonomyLevel: agent.autonomyLevel,
						policyMode: normalizeChatToolPolicy(ctx.chatToolPolicy).mode,
						category: skillKind ? permissionForToolKind(skillKind) : permissionForSource("skill"),
					});
					if (ctx.taskId) {
						await db.createTaskEvent({
							taskId: ctx.taskId,
							workspaceId: agent.workspaceId,
							agentRunId: ctx.agentRunId,
							agentId: agent.id,
							kind: "failed",
							message: `Tool failed: ${skill.id}`,
							payload: { toolLabel: skill.id, error: message },
						});
					}
					throw err;
				}
			},
		});
	}

	for (const toolId of agent.toolIds) {
		const workspaceTool = await resolveToolDefinition(agent.workspaceId, toolId);
		if (!workspaceTool) continue;
		// Sanitized because this key doubles as the model-facing function name
		// (see sanitizeToolNamePart) — workspace tool ids are randomUUID() and
		// can start with a digit, which Gemini's function-name regex rejects.
		const workspaceToolKey = sanitizeToolNamePart(workspaceTool.id).slice(0, 128);
		tools[workspaceToolKey] = tool({
			description: workspaceTool.description,
			inputSchema: workspaceTool.inputSchema,
			execute: async (input) => {
				const toolRecord = await db.getTool(workspaceTool.id);
				const toolKind = toolRecord?.kind ?? classifyBuiltinSkillKind(workspaceTool.id);
				const toolCategory = toolKind
					? permissionForToolKind(toolKind)
					: permissionForSource("skill");
				const toolKindCheck = isToolKindAllowed(budgetTracker.budget, toolKind);
				if (!toolKindCheck.allowed) {
					await logToolAudit({
						workspaceId: agent.workspaceId,
						agentId: agent.id,
						chatId: ctx.chatId,
						automationId: ctx.automationId,
						actor,
						toolLabel: workspaceTool.id,
						input,
						status: "rejected",
						autonomyLevel: agent.autonomyLevel,
						policyMode: normalizeChatToolPolicy(ctx.chatToolPolicy).mode,
						category: toolCategory,
					});
					if (ctx.taskId) {
						await db.createTaskEvent({
							taskId: ctx.taskId,
							workspaceId: agent.workspaceId,
							agentRunId: ctx.agentRunId,
							agentId: agent.id,
							kind: "failed",
							message: `Autonomy budget blocked "${workspaceTool.id}": ${toolKindCheck.reason}`,
							payload: { toolLabel: workspaceTool.id, reason: toolKindCheck.reason },
						});
					}
					return budgetExceededResult(
						workspaceTool.id,
						toolKindCheck.reason ?? "Blocked by autonomy budget.",
					);
				}
				if (
					shouldDeferToolForApproval(
						{ kind: "tool", sensitive: workspaceTool.sensitive, toolKind },
						ctx.chatToolPolicy,
					) ||
					exceedsRiskThreshold(toolCategory, budgetTracker.budget.requiresApprovalAboveRisk)
				) {
					const approval = await db.createApprovalRequest({
						workspaceId: agent.workspaceId,
						agentId: agent.id,
						chatId: ctx.chatId,
						automationId: ctx.automationId,
						taskId: ctx.taskId,
						agentRunId: ctx.agentRunId,
						kind: "tool",
						skillId: null,
						toolId: workspaceTool.id,
						toolLabel: workspaceTool.id,
						input: input as Record<string, unknown>,
					});
					await logToolAudit({
						workspaceId: agent.workspaceId,
						agentId: agent.id,
						chatId: ctx.chatId,
						automationId: ctx.automationId,
						actor,
						toolLabel: workspaceTool.id,
						input,
						status: "pending_approval",
						autonomyLevel: agent.autonomyLevel,
						policyMode: normalizeChatToolPolicy(ctx.chatToolPolicy).mode,
						category: toolKind ? permissionForToolKind(toolKind) : permissionForSource("skill"),
					});
					await notifyWorkspaceOwner(agent.workspaceId, {
						title: "Approval needed",
						body: `${agent.name} wants to run "${workspaceTool.id}"`,
						url: `/workspace/${agent.workspaceId}/approvals`,
						tag: `approval-${approval.id}`,
					});
					if (ctx.taskId) {
						await db.createTaskEvent({
							taskId: ctx.taskId,
							workspaceId: agent.workspaceId,
							agentRunId: ctx.agentRunId,
							agentId: agent.id,
							kind: "approval_waiting",
							message: `Waiting for approval: ${workspaceTool.id}`,
							payload: { approvalId: approval.id, toolLabel: workspaceTool.id },
						});
					}
					return pendingApprovalResult(approval.id, workspaceTool.id);
				}

				const toolBudgetCheck = checkAndConsumeRunBudget(budgetTracker, toolKind);
				if (!toolBudgetCheck.allowed) {
					await logToolAudit({
						workspaceId: agent.workspaceId,
						agentId: agent.id,
						chatId: ctx.chatId,
						automationId: ctx.automationId,
						actor,
						toolLabel: workspaceTool.id,
						input,
						status: "rejected",
						autonomyLevel: agent.autonomyLevel,
						policyMode: normalizeChatToolPolicy(ctx.chatToolPolicy).mode,
						category: toolCategory,
					});
					if (ctx.taskId) {
						await db.createTaskEvent({
							taskId: ctx.taskId,
							workspaceId: agent.workspaceId,
							agentRunId: ctx.agentRunId,
							agentId: agent.id,
							kind: "failed",
							message: `Autonomy budget blocked "${workspaceTool.id}": ${toolBudgetCheck.reason}`,
							payload: { toolLabel: workspaceTool.id, reason: toolBudgetCheck.reason },
						});
					}
					return budgetExceededResult(
						workspaceTool.id,
						toolBudgetCheck.reason ?? "Blocked by autonomy budget.",
					);
				}

				try {
					const parsedInput = workspaceTool.inputSchema.parse(input);
					const toolCtx = createSkillContext(workspaceTool.permissions);
					const output = await workspaceTool.run(parsedInput, toolCtx);
					await logToolAudit({
						workspaceId: agent.workspaceId,
						agentId: agent.id,
						chatId: ctx.chatId,
						automationId: ctx.automationId,
						actor,
						toolLabel: workspaceTool.id,
						input,
						output,
						status: "success",
						autonomyLevel: agent.autonomyLevel,
						policyMode: normalizeChatToolPolicy(ctx.chatToolPolicy).mode,
						category: toolKind ? permissionForToolKind(toolKind) : permissionForSource("skill"),
					});
					if (ctx.taskId) {
						await db.createTaskEvent({
							taskId: ctx.taskId,
							workspaceId: agent.workspaceId,
							agentRunId: ctx.agentRunId,
							agentId: agent.id,
							kind: "tool_called",
							message: `Tool succeeded: ${workspaceTool.id}`,
							payload: {
								toolLabel: workspaceTool.id,
							},
						});
					}
					return output;
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					await logToolAudit({
						workspaceId: agent.workspaceId,
						agentId: agent.id,
						chatId: ctx.chatId,
						automationId: ctx.automationId,
						actor,
						toolLabel: workspaceTool.id,
						input,
						output: { error: message },
						status: "error",
						autonomyLevel: agent.autonomyLevel,
						policyMode: normalizeChatToolPolicy(ctx.chatToolPolicy).mode,
						category: toolKind ? permissionForToolKind(toolKind) : permissionForSource("skill"),
					});
					if (ctx.taskId) {
						await db.createTaskEvent({
							taskId: ctx.taskId,
							workspaceId: agent.workspaceId,
							agentRunId: ctx.agentRunId,
							agentId: agent.id,
							kind: "failed",
							message: `Tool failed: ${workspaceTool.id}`,
							payload: { toolLabel: workspaceTool.id, error: message },
						});
					}
					throw err;
				}
			},
		});
	}

	for (const serverId of agent.mcpServerIds) {
		const server = await db.getMcpServer(serverId);
		if (!server?.enabled) continue;

		try {
			await ensureMcpServerConnected(server);
		} catch (err) {
			console.error(
				`Skipping MCP server "${server.name}" — failed to connect:`,
				err,
			);
			continue;
		}

		// A non-null mcpToolFilter narrows the *tools* granted from servers the
		// agent already has in mcpServerIds — it can never add servers or tools
		// beyond that set. Entries are "serverId::toolName"; a null filter (the
		// default) keeps the old behavior of granting every tool on the server.
		const allowedToolNames = agent.mcpToolFilter
			? new Set(
					agent.mcpToolFilter
						.filter((entry) => entry.startsWith(`${server.id}::`))
						.map((entry) => entry.slice(server.id.length + 2)),
				)
			: null;

		const mcpTools = await mcpManager.listTools(server.id);
		for (const mcpTool of mcpTools) {
			if (allowedToolNames && !allowedToolNames.has(mcpTool.name)) continue;
			// Namespaced so identically-named tools from two servers don't collide.
			// Sanitized because this key doubles as the model-facing function name
			// (see sanitizeToolNamePart) — server display names are free text.
			const toolKey = `${sanitizeToolNamePart(server.name)}__${sanitizeToolNamePart(mcpTool.name)}`.slice(
				0,
				128,
			);
			tools[toolKey] = dynamicTool({
				description:
					mcpTool.description ??
					`Tool "${mcpTool.name}" from MCP server "${server.name}".`,
				inputSchema: jsonSchema(
					mcpTool.inputSchema as Parameters<typeof jsonSchema>[0],
				),
				execute: async (input) => {
					// MCP tools have no ToolKind classification (they're external,
					// declared by the server itself), so allowedToolKinds /
					// blockedToolKinds never apply here — only the run-level
					// counters and the risk threshold below do.
					const mcpCategory = permissionForSource("mcp");
					if (
						shouldDeferToolForApproval({ kind: "mcp" }, ctx.chatToolPolicy) ||
						exceedsRiskThreshold(mcpCategory, budgetTracker.budget.requiresApprovalAboveRisk)
					) {
						const approval = await db.createApprovalRequest({
							workspaceId: agent.workspaceId,
							agentId: agent.id,
							chatId: ctx.chatId,
							automationId: ctx.automationId,
							taskId: ctx.taskId,
							agentRunId: ctx.agentRunId,
							kind: "mcp",
							mcpServerId: server.id,
							mcpToolName: mcpTool.name,
							toolLabel: toolKey,
							input: input as Record<string, unknown>,
						});
						await logToolAudit({
							workspaceId: agent.workspaceId,
							agentId: agent.id,
							chatId: ctx.chatId,
							automationId: ctx.automationId,
							actor,
							toolLabel: toolKey,
							input,
							status: "pending_approval",
							autonomyLevel: agent.autonomyLevel,
							policyMode: normalizeChatToolPolicy(ctx.chatToolPolicy).mode,
							category: permissionForSource("mcp"),
						});
						await notifyWorkspaceOwner(agent.workspaceId, {
							title: "Approval needed",
							body: `${agent.name} wants to run "${toolKey}"`,
							url: `/workspace/${agent.workspaceId}/approvals`,
							tag: `approval-${approval.id}`,
						});
						if (ctx.taskId) {
							await db.createTaskEvent({
								taskId: ctx.taskId,
								workspaceId: agent.workspaceId,
								agentRunId: ctx.agentRunId,
								agentId: agent.id,
								kind: "approval_waiting",
								message: `Waiting for approval: ${toolKey}`,
								payload: { approvalId: approval.id, toolLabel: toolKey },
							});
						}
						return pendingApprovalResult(approval.id, toolKey);
					}

					const mcpBudgetCheck = checkAndConsumeRunBudget(budgetTracker, null);
					if (!mcpBudgetCheck.allowed) {
						await logToolAudit({
							workspaceId: agent.workspaceId,
							agentId: agent.id,
							chatId: ctx.chatId,
							automationId: ctx.automationId,
							actor,
							toolLabel: toolKey,
							input,
							status: "rejected",
							autonomyLevel: agent.autonomyLevel,
							policyMode: normalizeChatToolPolicy(ctx.chatToolPolicy).mode,
							category: mcpCategory,
						});
						if (ctx.taskId) {
							await db.createTaskEvent({
								taskId: ctx.taskId,
								workspaceId: agent.workspaceId,
								agentRunId: ctx.agentRunId,
								agentId: agent.id,
								kind: "failed",
								message: `Autonomy budget blocked "${toolKey}": ${mcpBudgetCheck.reason}`,
								payload: { toolLabel: toolKey, reason: mcpBudgetCheck.reason },
							});
						}
						return budgetExceededResult(toolKey, mcpBudgetCheck.reason ?? "Blocked by autonomy budget.");
					}

					try {
						const output = await mcpManager.callTool(
							server.id,
							mcpTool.name,
							input as Record<string, unknown>,
						);
						await logToolAudit({
							workspaceId: agent.workspaceId,
							agentId: agent.id,
							chatId: ctx.chatId,
							automationId: ctx.automationId,
							actor,
							toolLabel: toolKey,
							input,
							output,
							status: "success",
							autonomyLevel: agent.autonomyLevel,
							policyMode: normalizeChatToolPolicy(ctx.chatToolPolicy).mode,
							category: permissionForSource("mcp"),
						});
						if (ctx.taskId) {
							await db.createTaskEvent({
								taskId: ctx.taskId,
								workspaceId: agent.workspaceId,
								agentRunId: ctx.agentRunId,
								agentId: agent.id,
								kind: "tool_called",
								message: `Tool succeeded: ${toolKey}`,
								payload: { toolLabel: toolKey },
							});
						}
						return output;
					} catch (err) {
						const message = err instanceof Error ? err.message : String(err);
						await logToolAudit({
							workspaceId: agent.workspaceId,
							agentId: agent.id,
							chatId: ctx.chatId,
							automationId: ctx.automationId,
							actor,
							toolLabel: toolKey,
							input,
							output: { error: message },
							status: "error",
							autonomyLevel: agent.autonomyLevel,
							policyMode: normalizeChatToolPolicy(ctx.chatToolPolicy).mode,
							category: permissionForSource("mcp"),
						});
						if (ctx.taskId) {
							await db.createTaskEvent({
								taskId: ctx.taskId,
								workspaceId: agent.workspaceId,
								agentRunId: ctx.agentRunId,
								agentId: agent.id,
								kind: "failed",
								message: `Tool failed: ${toolKey}`,
								payload: { toolLabel: toolKey, error: message },
							});
						}
						throw err;
					}
				},
			});
		}
	}

	// Only available on durable task runs — a live chat turn already lets the
	// user answer immediately, so there's nothing to block on. Deliberately
	// narrow: the system prompt tells the agent to reach for this only when
	// truly blocked on an urgent, unassumable gap, and to otherwise pick the
	// most sensible interpretation itself and note the assumption in its
	// final answer instead of stopping to ask.
	if (ctx.taskId) {
		const taskId = ctx.taskId;
		const agentRunId = ctx.agentRunId;
		tools.ask_user_question = tool({
			description:
				"Pause this task and ask the user a single clarifying question. Use this ONLY when you are genuinely blocked by a critical, urgent gap you cannot safely resolve on your own (e.g. a destructive/irreversible choice, a missing credential, directly conflicting instructions). For anything else — including ordinary ambiguity — do not call this tool: make the most reasonable assumption yourself, state it plainly in your final answer, and keep going.",
			inputSchema: z.object({
				question: z.string().describe("The single question to ask the user."),
				reason: z
					.string()
					.describe("Why this is urgent enough that it can't be safely assumed."),
			}),
			execute: async ({ question, reason }) => {
				await db.updateTask(taskId, { status: "blocked" });
				await db.createTaskEvent({
					taskId,
					workspaceId: agent.workspaceId,
					agentRunId,
					agentId: agent.id,
					kind: "question",
					message: question,
					payload: { question, reason },
				});
				return {
					status: "pending_question" as const,
					message: `Task paused: waiting for the user to answer "${question}". Do not proceed further or assume an answer.`,
				};
			},
		});
	}

	if (
		agent.autonomyLevel === "super_agent" &&
		ctx.allowDelegation !== false &&
		agent.delegateAgentIds.length > 0
	) {
		const delegateTool = await buildDelegateToAgentTool(agent, ctx);
		if (delegateTool) tools.delegate_to_agent = delegateTool;
	}

	const runWorkflowTool = await buildRunWorkflowTool(agent, ctx);
	if (runWorkflowTool) tools.run_workflow = runWorkflowTool;

	if (agent.autonomyLevel === "super_agent" || isAutoAssistant(agent)) {
		Object.assign(
			tools,
			await buildWorkspaceManagementTools(agent, { chatId: ctx.chatId }),
		);
	}

	return tools;
}
