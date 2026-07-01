import {
	DEFAULT_CHAT_TOOL_POLICY,
	DEFAULT_CHAT_WORKING_DIRECTORY,
	getDb,
} from "@nyxel/db";
import {
	McpAuthorizationRequiredError,
	McpInvalidConfigurationError,
} from "@nyxel/mcp-client";
import {
	getModelCapabilities,
	listAvailableModels,
	probeOpenAiCompatibleEndpoint,
} from "@nyxel/model-providers";
import { z } from "zod";
import { resolveApprovalDecision } from "../approvals";
import { auth } from "../auth";
import {
	ensureAutoAssistantForWorkspaceModel,
	getWorkspaceDefaultToolIds,
} from "../auto-agent";
import {
	buildKnowledgeBaseGraph,
	getKnowledgeBaseOverview,
	listKnowledgeBaseDocuments,
	runDocsAgentForWorkspace,
} from "../knowledge-base";
import {
	completeMcpServerAuthorization,
	ensureMcpServerConnected,
	mcpManager,
} from "../mcp-runtime";
import { getInstalledProvidersForWorkspace } from "../models";
import {
	importProviderSourceToWorkspace,
	listProviderImportSources,
} from "../provider-imports";
import { computeNextRunAt, runAutomation } from "../scheduler";
import { executeManagedTask, startTaskExecutionIfIdle } from "../agent-runtime";
import { listSkillCatalog } from "../skills-resolve";
import { listToolCatalogForWorkspace } from "../tools-resolve";
import { publicProcedure, router } from "./trpc";

const autonomyLevelSchema = z.enum([
	"chat",
	"assisted",
	"autonomous",
	"super_agent",
]);
const mcpTransportSchema = z.enum(["stdio", "http"]);
const approvalStatusSchema = z.enum(["pending", "approved", "rejected"]);
const installationModeSchema = z.enum(["pc", "server"]);
const modelProviderKindSchema = z.enum([
	"anthropic",
	"openai",
	"openai_compatible",
]);
const chatToolModeSchema = z.enum(["default", "automatic", "auto"]);
const chatToolPolicySchema = z.object({
	mode: chatToolModeSchema,
	approveFileWrites: z.boolean(),
	approveFileDeletes: z.boolean(),
	approveCustomCode: z.boolean(),
	approveMcpTools: z.boolean(),
});
const toolKindSchema = z.enum([
	"http_fetch",
	"file_read",
	"file_write",
	"file_list",
	"file_delete",
	"kb_search",
	"custom_code",
]);
const automationTriggerTypeSchema = z.enum(["cron", "file_watch"]);
const taskStatusSchema = z.enum([
	"pending",
	"planning",
	"ready",
	"running",
	"blocked",
	"waiting_approval",
	"completed",
	"failed",
	"cancelled",
]);
const taskPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
const AUTOMATABLE_LEVELS = new Set(["autonomous", "super_agent"]);

function resolveChatToolPolicy(input: {
	toolMode?: z.infer<typeof chatToolModeSchema>;
	toolPolicy?: z.infer<typeof chatToolPolicySchema>;
}) {
	const mode =
		input.toolMode ?? input.toolPolicy?.mode ?? DEFAULT_CHAT_TOOL_POLICY.mode;
	return {
		...DEFAULT_CHAT_TOOL_POLICY,
		...input.toolPolicy,
		mode,
	};
}

function normalizeMcpHttpEndpoint(input: string): string {
	const trimmed = input.trim();
	if (!trimmed) return trimmed;

	if (trimmed.startsWith("/")) {
		if (trimmed.startsWith("/guides/")) {
			throw new Error(
				"That looks like a documentation link, not an MCP endpoint. Use the actual server URL instead, such as https://mcp.notion.com/mcp.",
			);
		}
		throw new Error(
			"HTTP MCP endpoints must be absolute URLs, for example https://mcp.notion.com/mcp.",
		);
	}

	try {
		const parsed = new URL(trimmed);
		if (!["http:", "https:"].includes(parsed.protocol)) {
			throw new Error("invalid-protocol");
		}
		return parsed.toString();
	} catch {
		try {
			return new URL(`https://${trimmed}`).toString();
		} catch {
			throw new Error(
				"HTTP MCP endpoints must be absolute URLs, for example https://mcp.notion.com/mcp.",
			);
		}
	}
}

const mcpServerCreateSchema = z
	.object({
		workspaceId: z.string(),
		name: z.string().min(1),
		transport: mcpTransportSchema,
		command: z.string().optional(),
		args: z.array(z.string()).optional(),
		url: z.string().optional(),
	})
	.superRefine((input, ctx) => {
		if (input.transport === "stdio" && !input.command?.trim()) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "A stdio MCP server needs a command.",
				path: ["command"],
			});
		}
		if (input.transport === "http") {
			if (!input.url?.trim()) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message:
						"An HTTP MCP server needs a full endpoint URL such as https://example.com/mcp.",
					path: ["url"],
				});
				return;
			}
			try {
				normalizeMcpHttpEndpoint(input.url);
			} catch {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message:
						"Use the MCP endpoint itself, not a docs path. Example: https://example.com/mcp",
					path: ["url"],
				});
			}
		}
	});

function toMcpToolsResponse(err: McpAuthorizationRequiredError) {
	return {
		status: "auth_required" as const,
		authorizationUrl: err.authorizationUrl,
		callbackUrl: err.callbackUrl,
		message: err.message,
	};
}

function toMcpConfigResponse(err: McpInvalidConfigurationError) {
	return {
		status: "invalid_config" as const,
		message: err.message,
	};
}

export const appRouter = router({
	health: publicProcedure.query(() => ({ ok: true, name: "nyxel-server" })),

	demoUser: publicProcedure.query(() => getDb().getOrCreateDemoUser()),

	users: router({
		// Looks up a real account by id (e.g. installation.ownerUserId) — unlike
		// demoUser, which is a stubbed-in fallback for local development.
		get: publicProcedure
			.input(z.object({ userId: z.string() }))
			.query(({ input }) => getDb().getUser(input.userId)),
	}),

	installation: router({
		status: publicProcedure.query(async () => {
			const db = getDb();
			const installation = await db.getInstallation();
			const recommendedMode = db.driver === "pg" ? "server" : "pc";
			const defaultAppUrl =
				process.env.PUBLIC_APP_URL ??
				(recommendedMode === "server"
					? `https://${process.env.NYXEL_DOMAIN ?? "nyxel.example.com"}`
					: "http://localhost:3000");

			return {
				isInstalled: installation !== null,
				driver: db.driver,
				recommendedMode,
				defaultAppUrl,
				defaultWorkingDirectory:
					process.env.NYXEL_WORKSPACE_ROOT ?? DEFAULT_CHAT_WORKING_DIRECTORY,
				record: installation,
			};
		}),
		complete: publicProcedure
			.input(
				z.object({
					mode: installationModeSchema,
					ownerName: z.string().min(2),
					ownerEmail: z.string().email(),
					ownerPassword: z.string().min(8),
					workspaceName: z.string().min(1),
					appUrl: z.string().url().optional(),
				}),
			)
			.mutation(async ({ input }) => {
				const db = getDb();
				const existing = await db.getInstallation();
				if (existing) return existing;

				const signUpResult = await auth.api.signUpEmail({
					body: {
						name: input.ownerName,
						email: input.ownerEmail,
						password: input.ownerPassword,
					},
				});

				const workspace = await db.createWorkspace({
					userId: signUpResult.user.id,
					name: input.workspaceName,
				});

				return db.completeInstallation({
					mode: input.mode,
					ownerUserId: signUpResult.user.id,
					primaryWorkspaceId: workspace.id,
					appUrl: input.appUrl ?? null,
				});
			}),
	}),

	models: router({
		list: publicProcedure
			.input(z.object({ workspaceId: z.string().optional() }).optional())
			.query(async ({ input }) => {
				const providers = input?.workspaceId
					? await getInstalledProvidersForWorkspace(input.workspaceId)
					: [];
				return listAvailableModels(providers);
			}),
		installations: publicProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) =>
				getDb().listModelInstallationsByWorkspace(input.workspaceId),
			),
		// Lets the composer show whether an attachment will be sent natively
		// (image/PDF passed through to the model) or via server-side text
		// extraction fallback — see attachment-processing.ts.
		capabilities: publicProcedure
			.input(z.object({ workspaceId: z.string(), modelId: z.string() }))
			.query(async ({ input }) => {
				const providers = await getInstalledProvidersForWorkspace(
					input.workspaceId,
				);
				return getModelCapabilities(input.modelId, providers);
			}),
		probe: publicProcedure
			.input(
				z.object({
					label: z.string().min(1).optional(),
					baseUrl: z.string().url(),
					apiKey: z.string().min(1).optional(),
				}),
			)
			.query(async ({ input }) => {
				const detected = await probeOpenAiCompatibleEndpoint({
					baseUrl: input.baseUrl,
					apiKey: input.apiKey,
					providerLabel: input.label,
				});
				if (!detected) {
					throw new Error(
						`No OpenAI-compatible models found at ${input.baseUrl}.`,
					);
				}
				return detected;
			}),
		installCustom: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					label: z.string().min(1),
					providerKind: modelProviderKindSchema.default("openai_compatible"),
					baseUrl: z.string().url(),
					apiKey: z.string().min(1).optional(),
					modelIds: z.array(z.string().min(1)).min(1).optional(),
				}),
			)
			.mutation(async ({ input }) => {
				const detected = await probeOpenAiCompatibleEndpoint({
					baseUrl: input.baseUrl,
					apiKey: input.apiKey,
					providerLabel: input.label,
				});
				if (!detected) {
					throw new Error(
						`No OpenAI-compatible models found at ${input.baseUrl}.`,
					);
				}

				const modelIds =
					input.modelIds?.length &&
					input.modelIds.every((modelId) => detected.modelIds.includes(modelId))
						? input.modelIds
						: detected.modelIds;

				return getDb().createModelInstallation({
					workspaceId: input.workspaceId,
					label: input.label,
					providerKind: input.providerKind,
					baseUrl: detected.baseUrl,
					apiKey: input.apiKey ?? null,
					modelIds,
					enabled: true,
				});
			}),
		deleteInstallation: publicProcedure
			.input(z.object({ id: z.string() }))
			.mutation(({ input }) => getDb().deleteModelInstallation(input.id)),
		scanImportSources: publicProcedure.query(() => listProviderImportSources()),
		importSource: publicProcedure
			.input(z.object({ workspaceId: z.string(), sourceId: z.string() }))
			.mutation(({ input }) => importProviderSourceToWorkspace(input)),
	}),

	skills: router({
		// Read-only runtime skill catalog. Skills are process-wide and
		// hand-written in packages/skills-sdk.
		list: publicProcedure
			.query(() => listSkillCatalog()),
	}),

	tools: router({
		// Workspace tools are DB-backed and user-configurable. This is the
		// Old Skills tab concept, renamed because it was not a real skill.
		list: publicProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => listToolCatalogForWorkspace(input.workspaceId)),
		create: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					name: z.string().min(1),
					description: z.string().min(1),
					kind: toolKindSchema,
					// Shape depends on `kind` — see apps/server/src/tools-dynamic.ts's
					// doc comment for the expected fields per kind.
					config: z.record(z.string(), z.unknown()).default({}),
					sensitive: z.boolean().optional(),
					enabled: z.boolean().optional(),
				}),
			)
			.mutation(({ input }) => {
				// Read-only kinds default to not needing approval; anything that can
				// write or run arbitrary code defaults to sensitive. Callers can still
				// override explicitly via `sensitive`.
				const defaultSensitive =
					input.kind === "file_write" ||
					input.kind === "file_delete" ||
					input.kind === "custom_code";
				return getDb().createTool({
					...input,
					sensitive: input.sensitive ?? defaultSensitive,
				});
			}),
		setEnabled: publicProcedure
			.input(z.object({ id: z.string(), enabled: z.boolean() }))
			.mutation(({ input }) =>
				getDb().setToolEnabled(input.id, input.enabled),
			),
		delete: publicProcedure
			.input(z.object({ id: z.string() }))
			.mutation(({ input }) => getDb().deleteTool(input.id)),
	}),

	workspaces: router({
		list: publicProcedure
			.input(z.object({ userId: z.string() }))
			.query(({ input }) => getDb().listWorkspacesByUser(input.userId)),
		create: publicProcedure
			.input(z.object({ userId: z.string(), name: z.string().min(1) }))
			.mutation(({ input }) => getDb().createWorkspace(input)),
		get: publicProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => getDb().getWorkspace(input.workspaceId)),
		updateInstructions: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					customInstructions: z.string().nullable(),
				}),
			)
			.mutation(({ input }) => getDb().updateWorkspaceInstructions(input)),
	}),

	chats: router({
		list: publicProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => getDb().listChatsByWorkspace(input.workspaceId)),
		listArchived: publicProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) =>
				getDb().listArchivedChatsByWorkspace(input.workspaceId),
			),
		listByProject: publicProcedure
			.input(z.object({ projectId: z.string() }))
			.query(({ input }) => getDb().listChatsByProject(input.projectId)),
		create: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					workingDirectory: z.string().min(1),
					title: z.string().default("New chat"),
					modelId: z.string().optional(),
					agentId: z.string().optional(),
					projectId: z.string().nullable().optional(),
					toolMode: chatToolModeSchema.optional(),
					toolPolicy: chatToolPolicySchema.optional(),
				}),
			)
			.mutation(async ({ input }) => {
				const db = getDb();
				let modelId = input.modelId;
				let agentId = input.agentId;
				if (!modelId && input.agentId) {
					const agent = await db.getAgent(input.agentId);
					if (!agent) throw new Error(`Unknown agent: ${input.agentId}`);
					modelId = agent.modelId;
				}
				if (!modelId)
					throw new Error("chats.create needs either modelId or agentId.");
				if (!agentId) {
					const autoAgent = await ensureAutoAssistantForWorkspaceModel(
						input.workspaceId,
						modelId,
					);
					agentId = autoAgent.id;
				}
				const toolPolicy = resolveChatToolPolicy(input);
				return db.createChat({
					...input,
					modelId,
					agentId,
					toolMode: toolPolicy.mode,
					toolPolicy,
				});
			}),
		rename: publicProcedure
			.input(
				z.object({ chatId: z.string(), title: z.string().min(1).max(120) }),
			)
			.mutation(({ input }) =>
				getDb().renameChat(input.chatId, input.title.trim()),
			),
		setArchived: publicProcedure
			.input(z.object({ chatId: z.string(), archived: z.boolean() }))
			.mutation(({ input }) =>
				getDb().setChatArchived(input.chatId, input.archived),
			),
		setPinned: publicProcedure
			.input(z.object({ chatId: z.string(), pinned: z.boolean() }))
			.mutation(({ input }) =>
				getDb().setChatPinned(input.chatId, input.pinned),
			),
		setProject: publicProcedure
			.input(z.object({ chatId: z.string(), projectId: z.string().nullable() }))
			.mutation(({ input }) =>
				getDb().setChatProject(input.chatId, input.projectId),
			),
		duplicate: publicProcedure
			.input(z.object({ chatId: z.string() }))
			.mutation(({ input }) => getDb().duplicateChat(input.chatId)),
		// Turns public read-only sharing on/off for a chat. See chats.getShared
		// for the unauthenticated lookup used by the /share/{shareId} page.
		share: publicProcedure
			.input(z.object({ chatId: z.string() }))
			.mutation(({ input }) => getDb().setChatShared(input.chatId, true)),
		unshare: publicProcedure
			.input(z.object({ chatId: z.string() }))
			.mutation(({ input }) => getDb().setChatShared(input.chatId, false)),
		getShared: publicProcedure
			.input(z.object({ shareId: z.string() }))
			.query(async ({ input }) => {
				const db = getDb();
				const chat = await db.getChatByShareId(input.shareId);
				if (!chat) return null;
				const messages = await db.listMessages(chat.id);
				return { chat, messages };
			}),
		delete: publicProcedure
			.input(z.object({ chatId: z.string() }))
			.mutation(({ input }) => getDb().deleteChat(input.chatId)),
		messages: publicProcedure
			.input(z.object({ chatId: z.string() }))
			.query(({ input }) => getDb().listMessages(input.chatId)),
		// Re-points a chat at a different (usually freshly forked) agent — see
		// updateChatAgent's doc comment in packages/db/src/repo/types.ts.
		setAgent: publicProcedure
			.input(z.object({ chatId: z.string(), agentId: z.string().nullable() }))
			.mutation(({ input }) =>
				getDb().updateChatAgent(input.chatId, input.agentId),
			),
		setToolPolicy: publicProcedure
			.input(
				z.object({
					chatId: z.string(),
					toolMode: chatToolModeSchema,
					toolPolicy: chatToolPolicySchema,
				}),
			)
			.mutation(({ input }) =>
				getDb().updateChatToolPolicy({
					chatId: input.chatId,
					toolMode: input.toolMode,
					toolPolicy: resolveChatToolPolicy(input),
				}),
			),
	}),

	projects: router({
		list: publicProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => getDb().listProjectsByWorkspace(input.workspaceId)),
		get: publicProcedure
			.input(z.object({ projectId: z.string() }))
			.query(({ input }) => getDb().getProject(input.projectId)),
		create: publicProcedure
			.input(
				z.object({ workspaceId: z.string(), name: z.string().min(1).max(120) }),
			)
			.mutation(({ input }) =>
				getDb().createProject({ ...input, name: input.name.trim() }),
			),
		rename: publicProcedure
			.input(
				z.object({ projectId: z.string(), name: z.string().min(1).max(120) }),
			)
			.mutation(({ input }) =>
				getDb().renameProject(input.projectId, input.name.trim()),
			),
		duplicate: publicProcedure
			.input(z.object({ projectId: z.string() }))
			.mutation(({ input }) => getDb().duplicateProject(input.projectId)),
		delete: publicProcedure
			.input(z.object({ projectId: z.string() }))
			.mutation(({ input }) => getDb().deleteProject(input.projectId)),
	}),

	agents: router({
		list: publicProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => getDb().listAgentsByWorkspace(input.workspaceId)),
		get: publicProcedure
			.input(z.object({ id: z.string() }))
			.query(({ input }) => getDb().getAgent(input.id)),
		create: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					name: z.string().min(1),
					role: z.string().optional(),
					goalTemplate: z.string().optional(),
					systemPrompt: z.string().optional(),
					modelId: z.string(),
					autonomyLevel: autonomyLevelSchema.optional(),
					toolIds: z.array(z.string()).optional(),
					skillIds: z.array(z.string()).optional(),
					mcpServerIds: z.array(z.string()).optional(),
					// Entries shaped "serverId::toolName" — narrows which tools from
					// mcpServerIds are actually granted. Omitted/null = every tool.
					mcpToolFilter: z.array(z.string()).nullable().optional(),
					autoAttachWorkspaceTools: z.boolean().optional(),
					// Only meaningful for autonomyLevel "super_agent" — see ADR-0011.
					delegateAgentIds: z.array(z.string()).optional(),
				}),
			)
			.mutation(async ({ input }) => {
				const toolIds =
					input.autoAttachWorkspaceTools === false
						? {
								toolIds: input.toolIds,
								skillIds: input.skillIds,
								mcpServerIds: input.mcpServerIds,
							}
						: await getWorkspaceDefaultToolIds(input.workspaceId);

				return getDb().createAgent({
					...input,
					toolIds: toolIds.toolIds,
					skillIds: toolIds.skillIds,
					mcpServerIds: toolIds.mcpServerIds,
					mcpToolFilter: input.mcpToolFilter ?? null,
				});
			}),
		update: publicProcedure
			.input(
				z.object({
					id: z.string(),
					name: z.string().min(1).optional(),
					role: z.string().nullable().optional(),
					goalTemplate: z.string().nullable().optional(),
					systemPrompt: z.string().nullable().optional(),
					modelId: z.string().optional(),
					autonomyLevel: autonomyLevelSchema.optional(),
					toolIds: z.array(z.string()).optional(),
					skillIds: z.array(z.string()).optional(),
					mcpServerIds: z.array(z.string()).optional(),
					mcpToolFilter: z.array(z.string()).nullable().optional(),
					delegateAgentIds: z.array(z.string()).optional(),
				}),
			)
			.mutation(({ input: { id, ...input } }) => getDb().updateAgent(id, input)),
	}),

	tasks: router({
		list: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					status: taskStatusSchema.optional(),
					assignedAgentId: z.string().nullable().optional(),
				}),
			)
			.query(({ input }) =>
				getDb().listTasksByWorkspace(input.workspaceId, {
					status: input.status,
					assignedAgentId: input.assignedAgentId,
				}),
			),
		get: publicProcedure
			.input(z.object({ taskId: z.string() }))
			.query(async ({ input }) => {
				const db = getDb();
				return {
					task: await db.getTask(input.taskId),
					children: await db.listTaskTree(input.taskId),
					events: await db.listTaskEvents(input.taskId),
					runs: await db.listAgentRunsByTask(input.taskId),
				};
			}),
		create: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					parentTaskId: z.string().nullable().optional(),
					sourceChatId: z.string().nullable().optional(),
					createdByAgentId: z.string().nullable().optional(),
					assignedAgentId: z.string().nullable().optional(),
					title: z.string().min(1),
					instruction: z.string().min(1),
					priority: taskPrioritySchema.optional(),
					input: z.record(z.string(), z.unknown()).optional(),
				}),
			)
			.mutation(async ({ input }) => {
				const task = await getDb().createTask({
					...input,
					parentTaskId: input.parentTaskId ?? null,
					sourceChatId: input.sourceChatId ?? null,
					createdByAgentId: input.createdByAgentId ?? null,
					assignedAgentId: input.assignedAgentId ?? null,
					priority: input.priority ?? "normal",
					status: input.assignedAgentId ? "ready" : "pending",
					input: input.input ?? {},
				});
				await getDb().createTaskEvent({
					taskId: task.id,
					workspaceId: task.workspaceId,
					kind: "created",
					message: `Task created: ${task.title}`,
					payload: { title: task.title, priority: task.priority },
				});
				if (task.assignedAgentId) {
					await getDb().createTaskEvent({
						taskId: task.id,
						workspaceId: task.workspaceId,
						agentId: task.assignedAgentId,
						kind: "assigned",
						message: `Task assigned to agent ${task.assignedAgentId}`,
						payload: { assignedAgentId: task.assignedAgentId },
					});
					void startTaskExecutionIfIdle({
						taskId: task.id,
						trigger: input.sourceChatId ? "chat" : "task",
						chatId: input.sourceChatId ?? null,
					});
				}
				return task;
			}),
		assign: publicProcedure
			.input(
				z.object({
					taskId: z.string(),
					assignedAgentId: z.string().nullable(),
				}),
			)
			.mutation(async ({ input }) => {
				const task = await getDb().updateTask(input.taskId, {
					assignedAgentId: input.assignedAgentId,
					status: input.assignedAgentId ? "ready" : "pending",
				});
				await getDb().createTaskEvent({
					taskId: task.id,
					workspaceId: task.workspaceId,
					agentId: input.assignedAgentId,
					kind: "assigned",
					message: input.assignedAgentId
						? `Task assigned to agent ${input.assignedAgentId}`
						: "Task unassigned.",
					payload: { assignedAgentId: input.assignedAgentId },
				});
				if (input.assignedAgentId) {
					void startTaskExecutionIfIdle({
						taskId: task.id,
						trigger: "task",
					});
				}
				return task;
			}),
		complete: publicProcedure
			.input(
				z.object({
					taskId: z.string(),
					resultSummary: z.string().min(1),
				}),
			)
			.mutation(async ({ input }) => {
				const task = await getDb().updateTask(input.taskId, {
					status: "completed",
					resultSummary: input.resultSummary,
					completedAt: new Date(),
				});
				await getDb().createTaskEvent({
					taskId: task.id,
					workspaceId: task.workspaceId,
					kind: "completed",
					message: "Task marked complete.",
					payload: { resultSummary: input.resultSummary },
				});
				return task;
			}),
		cancel: publicProcedure
			.input(z.object({ taskId: z.string() }))
			.mutation(async ({ input }) => {
				const task = await getDb().updateTask(input.taskId, {
					status: "cancelled",
					completedAt: new Date(),
				});
				await getDb().createTaskEvent({
					taskId: task.id,
					workspaceId: task.workspaceId,
					kind: "failed",
					message: "Task cancelled.",
				});
				return task;
			}),
		start: publicProcedure
			.input(z.object({ taskId: z.string() }))
			.mutation(async ({ input }) => {
				const started = await startTaskExecutionIfIdle({
					taskId: input.taskId,
					trigger: "task",
				});
				if (started) return started.task;
				const task = await getDb().getTask(input.taskId);
				if (!task) throw new Error(`Unknown task: ${input.taskId}`);
				return task;
			}),
		reply: publicProcedure
			.input(
				z.object({
					taskId: z.string(),
					instruction: z.string().min(1),
				}),
			)
			.mutation(async ({ input }) => {
				const db = getDb();
				const task = await db.getTask(input.taskId);
				if (!task) throw new Error(`Unknown task: ${input.taskId}`);
				const agentId = task.assignedAgentId ?? task.createdByAgentId;
				if (!agentId) {
					throw new Error("This task has no agent to continue with.");
				}
				const agent = await db.getAgent(agentId);
				if (!agent) {
					throw new Error(`Unknown agent: ${agentId}`);
				}
				await db.updateTask(task.id, {
					status: "ready",
					startedAt: new Date(),
					completedAt: null,
					errorMessage: null,
				});
				await db.createTaskEvent({
					taskId: task.id,
					workspaceId: task.workspaceId,
					agentId,
					kind: "comment",
					message: "Follow-up instruction added.",
					payload: { instruction: input.instruction },
				});
				await db.createTaskEvent({
					taskId: task.id,
					workspaceId: task.workspaceId,
					agentId,
					kind: "status_changed",
					message: "Task reopened for follow-up execution.",
					payload: { status: "ready" },
				});
				const result = await executeManagedTask({
					taskId: task.id,
					agent,
					trigger: "chat",
					chatId: task.sourceChatId,
					instructionOverride: input.instruction,
				});
				return result.task;
			}),
		events: publicProcedure
			.input(z.object({ taskId: z.string() }))
			.query(({ input }) => getDb().listTaskEvents(input.taskId)),
	}),

	agentRuns: router({
		listByTask: publicProcedure
			.input(z.object({ taskId: z.string() }))
			.query(({ input }) => getDb().listAgentRunsByTask(input.taskId)),
	}),

	mcpServers: router({
		list: publicProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) =>
				getDb().listMcpServersByWorkspace(input.workspaceId),
			),
		create: publicProcedure.input(mcpServerCreateSchema).mutation(({ input }) =>
			getDb().createMcpServer({
				...input,
				command: input.command?.trim(),
				url: input.url?.trim(),
			}),
		),
		delete: publicProcedure
			.input(z.object({ id: z.string() }))
			.mutation(({ input }) => getDb().deleteMcpServer(input.id)),
		// Connects on demand and lists the server's tools — lets the UI offer a
		// "test connection" action without keeping every configured server
		// connected all the time.
		listTools: publicProcedure
			.input(z.object({ id: z.string() }))
			.query(async ({ input }) => {
				const server = await getDb().getMcpServer(input.id);
				if (!server) throw new Error(`Unknown MCP server: ${input.id}`);
				try {
					await ensureMcpServerConnected(server);
					return {
						status: "ready" as const,
						tools: await mcpManager.listTools(server.id),
					};
				} catch (err) {
					if (err instanceof McpAuthorizationRequiredError) {
						return toMcpToolsResponse(err);
					}
					if (err instanceof McpInvalidConfigurationError) {
						return toMcpConfigResponse(err);
					}
					throw err;
				}
			}),
		finishAuth: publicProcedure
			.input(z.object({ id: z.string(), code: z.string().min(1) }))
			.mutation(async ({ input }) => {
				const server = await getDb().getMcpServer(input.id);
				if (!server) throw new Error(`Unknown MCP server: ${input.id}`);
				await completeMcpServerAuthorization(server, input.code);
				return { ok: true };
			}),
	}),

	automations: router({
		list: publicProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) =>
				getDb().listAutomationsByWorkspace(input.workspaceId),
			),
		create: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					agentId: z.string(),
					name: z.string().min(1),
					triggerType: automationTriggerTypeSchema.default("cron"),
					cronExpression: z.string().optional(),
					watchPath: z.string().optional(),
					watchGlob: z.string().optional(),
					prompt: z.string().min(1),
					enabled: z.boolean().optional(),
				}),
			)
			.mutation(async ({ input }) => {
				const db = getDb();
				const agent = await db.getAgent(input.agentId);
				if (!agent) throw new Error(`Unknown agent: ${input.agentId}`);
				if (!AUTOMATABLE_LEVELS.has(agent.autonomyLevel)) {
					throw new Error(
						`Agent "${agent.name}" has autonomy level "${agent.autonomyLevel}" — only "autonomous" or "super_agent" agents can be scheduled.`,
					);
				}

				if (input.triggerType === "file_watch") {
					if (!input.watchPath) {
						throw new Error('A file-watch automation needs "watchPath".');
					}
					return db.createAutomation({
						...input,
						cronExpression: "",
						nextRunAt: null,
					});
				}

				if (!input.cronExpression) {
					throw new Error('A cron automation needs "cronExpression".');
				}
				const nextRunAt = computeNextRunAt(input.cronExpression, new Date());
				if (!nextRunAt)
					throw new Error(
						`"${input.cronExpression}" is not a valid cron expression.`,
					);
				return db.createAutomation({ ...input, nextRunAt });
			}),
		setEnabled: publicProcedure
			.input(z.object({ id: z.string(), enabled: z.boolean() }))
			.mutation(async ({ input }) => {
				const db = getDb();
				if (input.enabled) {
					// Re-enabling: recompute nextRunAt from "now" rather than resuming
					// whatever stale schedule was in place before it was disabled.
					// File-watch automations have no cron schedule to recompute — the
					// scheduler's file-poll loop re-triggers them by lastWatchCheckAt.
					const automation = await db.getAutomation(input.id);
					if (!automation) throw new Error(`Unknown automation: ${input.id}`);
					if (automation.triggerType === "cron") {
						const nextRunAt = computeNextRunAt(
							automation.cronExpression,
							new Date(),
						);
						await db.setAutomationNextRun(input.id, nextRunAt);
					}
				}
				return db.setAutomationEnabled(input.id, input.enabled);
			}),
		delete: publicProcedure
			.input(z.object({ id: z.string() }))
			.mutation(({ input }) => getDb().deleteAutomation(input.id)),
		runNow: publicProcedure
			.input(z.object({ id: z.string() }))
			.mutation(async ({ input }) => {
				const db = getDb();
				const automation = await db.getAutomation(input.id);
				if (!automation) throw new Error(`Unknown automation: ${input.id}`);
				const summary = await runAutomation(automation);
				const updated = await db.getAutomation(input.id);
				return { automation: updated, ...summary };
			}),
	}),

	approvals: router({
		list: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					status: approvalStatusSchema.optional(),
				}),
			)
			.query(({ input }) =>
				getDb().listApprovalsByWorkspace(input.workspaceId, input.status),
			),
		approve: publicProcedure
			.input(z.object({ id: z.string() }))
			.mutation(({ input }) => resolveApprovalDecision(input.id, "approved")),
		reject: publicProcedure
			.input(z.object({ id: z.string() }))
			.mutation(({ input }) => resolveApprovalDecision(input.id, "rejected")),
	}),

	auditLog: router({
		list: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					limit: z.number().min(1).max(500).optional(),
				}),
			)
			.query(({ input }) =>
				getDb().listAuditLogByWorkspace(input.workspaceId, input.limit),
			),
	}),

	knowledgeBase: router({
		overview: publicProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => getKnowledgeBaseOverview(input.workspaceId)),
		updateConfig: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					vaultPath: z.string().min(1),
					obsidianRestUrl: z.string().url().nullable().optional(),
					obsidianApiKey: z.string().nullable().optional(),
					docsAgentEnabled: z.boolean().optional(),
					injectIntoPrompts: z.boolean().optional(),
				}),
			)
			.mutation(({ input }) =>
				getDb().upsertKnowledgeBaseConfig({
					workspaceId: input.workspaceId,
					vaultPath: input.vaultPath,
					obsidianRestUrl: input.obsidianRestUrl ?? null,
					obsidianApiKey: input.obsidianApiKey ?? null,
					docsAgentEnabled: input.docsAgentEnabled,
					injectIntoPrompts: input.injectIntoPrompts,
				}),
			),
		documents: publicProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => listKnowledgeBaseDocuments(input.workspaceId)),
		graph: publicProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(async ({ input }) => {
				const documents = await listKnowledgeBaseDocuments(input.workspaceId);
				return buildKnowledgeBaseGraph(documents);
			}),
		runDocsAgent: publicProcedure
			.input(z.object({ workspaceId: z.string() }))
			.mutation(({ input }) =>
				runDocsAgentForWorkspace(input.workspaceId, "manual"),
			),
	}),
});

export type AppRouter = typeof appRouter;
