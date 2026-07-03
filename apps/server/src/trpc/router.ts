import {
	DEFAULT_CHAT_TOOL_POLICY,
	DEFAULT_CHAT_WORKING_DIRECTORY,
	getDb,
	type ModelInstallationRecord,
} from "@nyxel/db";
import {
	McpAuthorizationRequiredError,
	McpInvalidConfigurationError,
} from "@nyxel/mcp-client";
import {
	fetchLiveModelIdsForProviderKind,
	fetchOpenRouterModels,
	getModelCapabilities,
	listAvailableModels,
	OPENAI_IMAGE_MODELS,
	OPENAI_SPEECH_MODELS,
	OPENAI_TRANSCRIPTION_MODELS,
	OPENAI_VIDEO_MODELS,
	OPENROUTER_BASE_URL,
	probeOpenAiCompatibleEndpoint,
} from "@nyxel/model-providers";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { resolveApprovalDecision } from "../approvals";
import { auth } from "../auth";
import { logAudit } from "../audit";
import { getGitDiff, getGitStatus, getRepoInfo, listDirectory } from "../coding";
import {
	checkCliAuthStatus,
	type CliProviderKind,
	getCliLoginOutput,
	startCliLogin,
} from "../cli-providers";
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
	createLibraryFolder,
	deleteLibraryFile,
	deleteLibraryFolder,
	listLibrary,
	moveLibraryFile,
	moveLibraryFolder,
	renameLibraryFile,
	renameLibraryFolder,
} from "../library";
import { MCP_CONNECTOR_CATALOG } from "../mcp-connectors";
import { EXTENSION_CATALOG, getExtensionCatalogEntry } from "../extensions";
import { getWorkspaceStatsOverview } from "../stats";
import {
	dispatchSeoFix,
	generateSeoBlogPost,
	runSeoAnalysis,
	validateRepoPath,
} from "../seo-analyzer";
import { writeMcpSecretFile } from "../mcp-secrets";
import {
	completeMcpServerAuthorization,
	ensureMcpServerConnected,
	mcpManager,
} from "../mcp-runtime";
import { getInstalledProvidersForWorkspace } from "../models";
import { getVapidPublicKey } from "../push";
import {
	importProviderSourceToWorkspace,
	listProviderImportSources,
} from "../provider-imports";
import { runHealthCheckForWorkspace } from "../health-agent";
import { computeNextRunAt, runAutomation } from "../scheduler";
import {
	cancelAgentRun,
	executeManagedTask,
	startTaskExecutionIfIdle,
} from "../agent-runtime";
import {
	ensureExtensionPlugin,
	getPlugin,
	installPluginFromGithub,
	listPlugins,
	setPluginEnabled,
	uninstallPlugin,
} from "../plugins";
import {
	createFileSkill,
	deleteFileSkill,
	importSkillFromUrl,
	listSkillCatalog,
	searchSkillLibrary,
	updateFileSkill,
} from "../skills-resolve";
import { seedBuiltinToolsForWorkspace } from "../tools-builtin-seed";
import { listToolCatalogForWorkspace } from "../tools-resolve";
import { editVideo } from "../video-edit";
import {
	getVideoGenerationJobById,
	listVideoGenerationJobsForWorkspace,
	queueVideoGeneration,
} from "../video";
import {
	getWorkflowRun,
	listWorkflowRunNodes,
	listWorkflowRunsForWorkflow,
	startWorkflowRun,
} from "../workflow-runner";
import { protectedProcedure, publicProcedure, router, workspaceProcedure } from "./trpc";
import { requireEntityWorkspaceOwner, requireWorkspaceOwner } from "./workspace-guard";

const autonomyLevelSchema = z.enum([
	"chat",
	"assisted",
	"autonomous",
	"super_agent",
]);
const mcpTransportSchema = z.enum(["stdio", "http"]);
const memoryTypeSchema = z.enum([
	"user_preference",
	"workspace_fact",
	"project_decision",
	"agent_observation",
	"task_summary",
	"file_summary",
	"repo_summary",
	"long_term_note",
]);
const memorySourceSchema = z.enum(["user", "agent", "automation", "system"]);
const approvalStatusSchema = z.enum(["pending", "approved", "rejected"]);
const installationModeSchema = z.enum(["pc", "server"]);
const modelProviderKindSchema = z.enum([
	"anthropic",
	"openai",
	"openrouter",
	"openai_compatible",
	"claude_cli",
	"codex_cli",
]);
const cliProviderKindSchema: z.ZodType<CliProviderKind> = z.enum(["claude_cli", "codex_cli"]);
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
	"file_create",
	"file_patch",
	"file_move",
	"directory_create",
	"notebook_edit",
	"file_stat",
	"file_view_image",
	"notebook_summary",
	"notebook_cell_output",
	"terminal_last_command",
	"terminal_output",
	"problems",
	"file_search",
	"text_search",
	"usages",
	"codebase_search",
	"changes",
	"terminal_run",
	"terminal_send_input",
	"terminal_kill",
	"task_run",
	"test_run",
	"browser_navigate",
	"browser_click",
	"browser_drag",
	"browser_hover",
	"browser_type",
	"browser_handle_dialog",
	"browser_screenshot",
	"browser_read_page",
	"browser_run_playwright_code",
	"github_repo_fetch",
	"github_code_search",
	"generate_image",
	"generate_video",
	"edit_video",
]);
/** Kinds that default to `sensitive: false` (pure reads/lookups) when a
 * caller doesn't explicitly pass `sensitive` — mirrors the read-vs-write
 * split already used for file_read vs file_write. Everything else defaults
 * to sensitive: true (the safer default for anything with a side effect). */
const NON_SENSITIVE_DEFAULT_TOOL_KINDS = new Set([
	"http_fetch",
	"file_read",
	"file_list",
	"kb_search",
	"file_stat",
	"file_view_image",
	"notebook_summary",
	"notebook_cell_output",
	"terminal_last_command",
	"terminal_output",
	"problems",
	"file_search",
	"text_search",
	"usages",
	"codebase_search",
	"changes",
	"browser_read_page",
	"browser_screenshot",
	"github_repo_fetch",
	"github_code_search",
	"generate_image",
]);
const workflowNodeKindSchema = z.enum([
	"text_prompt",
	"image_upload",
	"video_upload",
	"generate_image",
	"generate_video",
	"edit_video",
	"agent",
	"http_request",
	"delay",
	"condition",
	"output",
]);
const workflowDefinitionSchema = z.object({
	nodes: z.array(
		z.object({
			id: z.string(),
			type: workflowNodeKindSchema,
			position: z.object({ x: z.number(), y: z.number() }),
			data: z.record(z.string(), z.unknown()),
		}),
	),
	edges: z.array(
		z.object({
			id: z.string(),
			source: z.string(),
			target: z.string(),
			sourceHandle: z.string().nullable().optional(),
		}),
	),
	viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
});
const EMPTY_WORKFLOW_DEFINITION: z.infer<typeof workflowDefinitionSchema> = {
	nodes: [],
	edges: [],
};

const automationTriggerTypeSchema = z.enum(["cron", "file_watch"]);
const automationTargetKindSchema = z.enum(["agent", "workflow"]);
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

function resolveChatToolPolicy(
	input: {
		toolMode?: z.infer<typeof chatToolModeSchema>;
		toolPolicy?: z.infer<typeof chatToolPolicySchema>;
	},
	fallback: z.infer<typeof chatToolPolicySchema> = DEFAULT_CHAT_TOOL_POLICY,
) {
	const mode = input.toolMode ?? input.toolPolicy?.mode ?? fallback.mode;
	return {
		...fallback,
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
		env: z.record(z.string(), z.string()).optional(),
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

// Shared by agents.delete and agents.deleteMany — throws with a message
// naming the blocker instead of letting a FOREIGN KEY failure bubble up raw.
async function deleteAgentGuarded(db: ReturnType<typeof getDb>, id: string) {
	const agent = await db.getAgent(id);
	if (!agent) throw new Error(`Unknown agent: ${id}`);

	const automations = await db.listAutomationsByWorkspace(agent.workspaceId);
	const blockingAutomations = automations.filter((a) => a.agentId === id);
	if (blockingAutomations.length > 0) {
		throw new Error(
			`This agent is used by ${blockingAutomations.length} automation(s) (${blockingAutomations
				.map((a) => a.name)
				.join(", ")}) — delete or reassign those first.`,
		);
	}

	const runs = await db.listAgentRunsByAgent(id);
	const hasActiveRun = runs.some(
		(run) =>
			run.status === "pending" ||
			run.status === "running" ||
			run.status === "waiting_approval",
	);
	if (hasActiveRun) {
		throw new Error("This agent has a run in progress — stop it before deleting the agent.");
	}

	await db.deleteAgent(id);
}

// Strips the raw provider secret before a model installation row leaves the
// server — the client only needs to know whether a key is configured, not
// its value (SECURITY_AUDIT.md SEC-02). `apiKey` is replaced with a
// `hasApiKey` boolean rather than a masked prefix so the UI never receives
// even a partial live credential.
export function toClientSafeInstallation(installation: ModelInstallationRecord) {
	const { apiKey, ...rest } = installation;
	return { ...rest, hasApiKey: apiKey !== null && apiKey.length > 0 };
}

export const appRouter = router({
	health: publicProcedure.query(() => ({ ok: true, name: "nyxel-server" })),

	demoUser: publicProcedure.query(() => getDb().getOrCreateDemoUser()),

	users: router({
		// Looks up a real account by id (e.g. installation.ownerUserId) — unlike
		// demoUser, which is a stubbed-in fallback for local development.
		get: protectedProcedure
			.input(z.object({ userId: z.string() }))
			.query(({ input, ctx }) => {
				if (input.userId !== ctx.user.id) {
					throw new TRPCError({ code: "FORBIDDEN" });
				}
				return getDb().getUser(input.userId);
			}),
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
				await seedBuiltinToolsForWorkspace(workspace.id);

				return db.completeInstallation({
					mode: input.mode,
					ownerUserId: signUpResult.user.id,
					primaryWorkspaceId: workspace.id,
					appUrl: input.appUrl ?? null,
				});
			}),
	}),

	models: router({
		list: protectedProcedure
			.input(z.object({ workspaceId: z.string().optional() }).optional())
			.query(async ({ input, ctx }) => {
				if (input?.workspaceId) {
					await requireWorkspaceOwner(ctx.user.id, input.workspaceId);
				}
				const providers = input?.workspaceId
					? await getInstalledProvidersForWorkspace(input.workspaceId)
					: [];
				return listAvailableModels(providers);
			}),
		// Fixed catalogs (OpenAI only today) for generation model kinds that
		// aren't chat LanguageModels and so don't show up in `list` above —
		// exposed over tRPC the same way video.models does, so the Models
		// settings page can surface gpt-image-1/tts/whisper etc. without
		// duplicating the list as a frontend constant.
		generationCatalog: publicProcedure.query(() => ({
			image: OPENAI_IMAGE_MODELS,
			speech: OPENAI_SPEECH_MODELS,
			transcription: OPENAI_TRANSCRIPTION_MODELS,
		})),
		installations: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(async ({ input }) => {
				const installations = await getDb().listModelInstallationsByWorkspace(
					input.workspaceId,
				);
				return installations.map(toClientSafeInstallation);
			}),
		// Lets the composer show whether an attachment will be sent natively
		// (image/PDF passed through to the model) or via server-side text
		// extraction fallback — see attachment-processing.ts.
		capabilities: workspaceProcedure
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
		installCustom: workspaceProcedure
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
		// OpenRouter's catalog is public, so this works with or without a key —
		// the settings panel calls it as the user types their key to preview
		// what "import all" will bring in.
		listOpenRouterModels: publicProcedure
			.input(z.object({ apiKey: z.string().min(1).optional() }))
			.query(({ input }) => fetchOpenRouterModels(input.apiKey)),
		installOpenRouter: workspaceProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					label: z.string().min(1).default("OpenRouter"),
					apiKey: z.string().min(1),
					modelIds: z.array(z.string().min(1)).min(1).optional(),
				}),
			)
			.mutation(async ({ input }) => {
				const models = await fetchOpenRouterModels(input.apiKey);
				if (models.length === 0) {
					throw new Error(
						"Couldn't fetch the OpenRouter model catalog — check your API key and try again.",
					);
				}

				const catalogIds = new Set(models.map((model) => model.id));
				const modelIds =
					input.modelIds?.length && input.modelIds.every((modelId) => catalogIds.has(modelId))
						? input.modelIds
						: models.map((model) => model.id);

				return getDb().createModelInstallation({
					workspaceId: input.workspaceId,
					label: input.label,
					providerKind: "openrouter",
					baseUrl: OPENROUTER_BASE_URL,
					apiKey: input.apiKey,
					modelIds,
					enabled: true,
				});
			}),
		deleteInstallation: protectedProcedure
			.input(z.object({ id: z.string() }))
			.mutation(async ({ input, ctx }) => {
				const db = getDb();
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => db.getModelInstallation(input.id),
					"Model installation not found",
				);
				return db.deleteModelInstallation(input.id);
			}),
		// Per-(workspace, model) generation overrides — how a specific model
		// should behave by default. `getParameters` returns null when the model
		// has never been configured (UI shows provider defaults/placeholders).
		getParameters: workspaceProcedure
			.input(z.object({ workspaceId: z.string(), modelId: z.string() }))
			.query(({ input }) =>
				getDb().getModelParameter(input.workspaceId, input.modelId),
			),
		saveParameters: workspaceProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					modelId: z.string(),
					customName: z.string().trim().min(1).nullable().optional(),
					customInstructions: z.string().trim().min(1).nullable().optional(),
					maxOutputTokens: z.number().int().positive().nullable().optional(),
					temperature: z.number().min(0).max(2).nullable().optional(),
					topP: z.number().min(0).max(1).nullable().optional(),
					frequencyPenalty: z.number().min(-2).max(2).nullable().optional(),
					presencePenalty: z.number().min(-2).max(2).nullable().optional(),
					stopSequences: z.array(z.string()).optional(),
					reasoningEffort: z.enum(["low", "medium", "high"]).nullable().optional(),
				}),
			)
			.mutation(({ input }) => getDb().upsertModelParameter(input)),
		resetParameters: workspaceProcedure
			.input(z.object({ workspaceId: z.string(), modelId: z.string() }))
			.mutation(({ input }) =>
				getDb().deleteModelParameter(input.workspaceId, input.modelId),
			),
		// Per-model controls within an installation, applicable to every
		// provider kind (LM Studio, Claude CLI, Codex CLI, ...) — lets a user
		// hide/show or permanently drop one model without touching the
		// installation's connection/auth itself.
		setModelEnabled: protectedProcedure
			.input(z.object({ id: z.string(), modelId: z.string(), enabled: z.boolean() }))
			.mutation(async ({ input, ctx }) => {
				const db = getDb();
				const installation = await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => db.getModelInstallation(input.id),
					"Model installation not found",
				);
				const disabledModelIds = input.enabled
					? installation.disabledModelIds.filter((id) => id !== input.modelId)
					: Array.from(new Set([...installation.disabledModelIds, input.modelId]));
				return db.updateModelInstallation({ id: input.id, disabledModelIds });
			}),
		// Catalog for the "add model" autocomplete/autofill on an already
		// installed provider — same live source addModelToInstallation
		// validates against, exposed separately so the UI can suggest ids
		// before the user commits to typing one. Empty array (not an error)
		// when the provider kind has no catalog endpoint (CLI providers,
		// arbitrary openai_compatible runtimes without a key).
		listCatalogForInstallation: protectedProcedure
			.input(z.object({ id: z.string() }))
			.query(async ({ input, ctx }) => {
				const installation = await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getModelInstallation(input.id),
					"Model installation not found",
				);
				const ids = await fetchLiveModelIdsForProviderKind(
					installation.providerKind,
					installation.apiKey,
					installation.baseUrl,
				);
				return ids ?? [];
			}),
		addModelToInstallation: protectedProcedure
			.input(z.object({ id: z.string(), modelId: z.string().min(1) }))
			.mutation(async ({ input, ctx }) => {
				const db = getDb();
				const installation = await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => db.getModelInstallation(input.id),
					"Model installation not found",
				);
				if (installation.modelIds.includes(input.modelId)) return installation;

				// Verify against the provider's real catalog when one is
				// reachable — `null` means unverifiable (no key, CLI provider,
				// network error), which stays permissive rather than blocking.
				const liveIds = await fetchLiveModelIdsForProviderKind(
					installation.providerKind,
					installation.apiKey,
					installation.baseUrl,
				);
				if (liveIds && !liveIds.includes(input.modelId)) {
					throw new Error(
						`"${input.modelId}" doesn't exist for ${installation.label}. Known models: ${liveIds.slice(0, 15).join(", ")}${liveIds.length > 15 ? ", …" : ""}`,
					);
				}

				const modelIds = [...installation.modelIds, input.modelId];
				return db.updateModelInstallation({ id: input.id, modelIds });
			}),
		removeModelFromInstallation: protectedProcedure
			.input(z.object({ id: z.string(), modelId: z.string() }))
			.mutation(async ({ input, ctx }) => {
				const db = getDb();
				const installation = await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => db.getModelInstallation(input.id),
					"Model installation not found",
				);
				const modelIds = installation.modelIds.filter((id) => id !== input.modelId);
				const disabledModelIds = installation.disabledModelIds.filter(
					(id) => id !== input.modelId,
				);
				// An installation with no models left is just clutter — drop it
				// instead of leaving an empty "Claude CLI"/"LM Studio" row behind.
				if (modelIds.length === 0) {
					await db.deleteModelInstallation(input.id);
					return null;
				}
				return db.updateModelInstallation({ id: input.id, modelIds, disabledModelIds });
			}),
		// Local CLI providers (claude_cli/codex_cli) — see
		// apps/server/src/cli-providers.ts. Auth state is host-wide, not
		// per-workspace, so these three take no workspaceId. No natural
		// workspace/entity to check ownership against (host-level CLI auth,
		// not workspace-scoped data) — gated to signed-in users only.
		// TODO(ADR-0017): needs auth review — host-wide CLI login state has no
		// owning workspace/user to check beyond "is signed in"; consider
		// whether this should be admin-only once roles exist.
		cliStatus: protectedProcedure
			.input(z.object({ providerKind: cliProviderKindSchema }))
			.query(({ input }) => checkCliAuthStatus(input.providerKind)),
		cliLoginStart: protectedProcedure
			.input(
				z.object({
					providerKind: cliProviderKindSchema,
					apiKey: z.string().min(1).optional(),
				}),
			)
			.mutation(({ input }) => startCliLogin(input.providerKind, input.apiKey)),
		cliLoginOutput: protectedProcedure
			.input(z.object({ execId: z.string() }))
			.query(({ input }) => getCliLoginOutput(input.execId)),
		installCli: workspaceProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					providerKind: cliProviderKindSchema,
					label: z.string().min(1),
					modelIds: z.array(z.string().min(1)).min(1),
				}),
			)
			.mutation(async ({ input }) => {
				const status = await checkCliAuthStatus(input.providerKind);
				if (!status.binaryPath) {
					throw new Error(
						`${input.providerKind} binary not found on this server host — install it and make sure it's on PATH.`,
					);
				}

				const db = getDb();
				// A workspace should only ever have one installation per CLI kind —
				// re-checking a new model preset (e.g. after we add a newly
				// released model to the default list) merges it into the existing
				// installation instead of creating a second, confusing duplicate
				// "Claude CLI"/"Codex CLI" row.
				const existing = (await db.listModelInstallationsByWorkspace(input.workspaceId)).find(
					(installation) => installation.providerKind === input.providerKind,
				);
				if (existing) {
					const modelIds = Array.from(new Set([...existing.modelIds, ...input.modelIds]));
					return db.updateModelInstallation({ id: existing.id, modelIds });
				}

				return db.createModelInstallation({
					workspaceId: input.workspaceId,
					label: input.label,
					providerKind: input.providerKind,
					baseUrl: status.binaryPath,
					apiKey: null,
					modelIds: input.modelIds,
					enabled: true,
				});
			}),
		// TODO(ADR-0017): needs auth review — scans host-local paths for
		// importable provider configs (e.g. existing CLI credential files);
		// no workspace/entity to check ownership against, but the host-wide
		// filesystem scan is sensitive enough that it likely deserves at
		// least a signed-in session. Left public to match the exemption list's
		// treatment of other host-wide, pre-workspace endpoints.
		scanImportSources: publicProcedure.query(() => listProviderImportSources()),
		importSource: workspaceProcedure
			.input(z.object({ workspaceId: z.string(), sourceId: z.string() }))
			.mutation(({ input }) => importProviderSourceToWorkspace(input)),
	}),

	skills: router({
		// Merges the process-wide hand-written skills (packages/skills-sdk)
		// with this workspace's own real, file-based skills (.md files under
		// NYXEL_SKILLS_DIR/<workspaceId>/ — see skills-resolve.ts).
		list: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => listSkillCatalog(input.workspaceId)),
		create: workspaceProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					name: z.string().min(1),
					description: z.string().min(1),
					body: z.string().min(1),
				}),
			)
			.mutation(({ input }) => createFileSkill(input)),
		update: workspaceProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					slug: z.string(),
					name: z.string().min(1),
					description: z.string().min(1),
					body: z.string().min(1),
				}),
			)
			.mutation(({ input }) => updateFileSkill(input)),
		delete: workspaceProcedure
			.input(z.object({ workspaceId: z.string(), slug: z.string() }))
			.mutation(({ input }) => deleteFileSkill(input)),
		// Public skill-library search — no workspace data touched, just a
		// catalog lookup (mirrors models.listOpenRouterModels).
		searchLibrary: publicProcedure
			.input(z.object({ query: z.string() }))
			.query(({ input }) => searchSkillLibrary(input.query)),
		importFromUrl: workspaceProcedure
			.input(z.object({ workspaceId: z.string(), url: z.string().url() }))
			.mutation(({ input }) => importSkillFromUrl(input)),
	}),

	// Plugins are larger, folder-based bundles pulled whole from a GitHub repo
	// (Claude Code plugin format — .claude-plugin/plugin.json + skills/ +
	// agents/ + arbitrary supporting files) rather than the single-file
	// skills above. See apps/server/src/plugins.ts.
	plugins: router({
		list: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => listPlugins(input.workspaceId)),
		get: protectedProcedure
			.input(z.object({ id: z.string() }))
			.query(async ({ input, ctx }) =>
				requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getPlugin(input.id),
					"Plugin not found",
				),
			),
		install: workspaceProcedure
			.input(z.object({ workspaceId: z.string(), repoUrl: z.string().min(1) }))
			.mutation(async ({ input }) => {
				const result = await installPluginFromGithub(input);
				// No dedicated "plugin" audit actor kind (see AuditActor) — reusing
				// "extension" since both are marketplace-style installable units
				// rather than adding a pg enum migration for one more value.
				await logAudit({
					workspaceId: input.workspaceId,
					actor: "extension",
					toolLabel: "plugins.install",
					input: { repoUrl: input.repoUrl },
					output: { slug: result.plugin.slug, skillCount: result.skills.length },
					status: "success",
				});
				return result;
			}),
		setEnabled: protectedProcedure
			.input(z.object({ id: z.string(), enabled: z.boolean() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getPlugin(input.id),
					"Plugin not found",
				);
				return setPluginEnabled(input.id, input.enabled);
			}),
		uninstall: protectedProcedure
			.input(z.object({ id: z.string() }))
			.mutation(async ({ input, ctx }) => {
				const existing = await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getPlugin(input.id),
					"Plugin not found",
				);
				await uninstallPlugin(input.id);
				await logAudit({
					workspaceId: existing.workspaceId,
					actor: "extension",
					toolLabel: "plugins.uninstall",
					input: { slug: existing.slug },
					status: "success",
				});
				return { ok: true };
			}),
	}),

	// Document & Image Library — folder metadata + file metadata CRUD live
	// here; the actual bytes go over plain Hono routes instead of tRPC (see
	// routes/library.ts's registerLibraryRoutes: POST /api/library/upload,
	// GET /api/library/files/:id/content) since multipart upload and file
	// streaming don't fit tRPC's JSON shape well.
	library: router({
		list: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => listLibrary(input.workspaceId)),
		createFolder: workspaceProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					parentId: z.string().nullable(),
					name: z.string().min(1),
				}),
			)
			.mutation(({ input }) => createLibraryFolder(input)),
		renameFolder: protectedProcedure
			.input(z.object({ id: z.string(), name: z.string().min(1) }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getLibraryFolder(input.id),
					"Folder not found",
				);
				return renameLibraryFolder(input.id, input.name);
			}),
		moveFolder: protectedProcedure
			.input(z.object({ id: z.string(), parentId: z.string().nullable() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getLibraryFolder(input.id),
					"Folder not found",
				);
				return moveLibraryFolder(input.id, input.parentId);
			}),
		deleteFolder: protectedProcedure
			.input(z.object({ id: z.string() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getLibraryFolder(input.id),
					"Folder not found",
				);
				await deleteLibraryFolder(input.id);
				return { ok: true };
			}),
		renameFile: protectedProcedure
			.input(z.object({ id: z.string(), name: z.string().min(1) }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getLibraryFile(input.id),
					"File not found",
				);
				return renameLibraryFile(input.id, input.name);
			}),
		moveFile: protectedProcedure
			.input(z.object({ id: z.string(), folderId: z.string().nullable() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getLibraryFile(input.id),
					"File not found",
				);
				return moveLibraryFile(input.id, input.folderId);
			}),
		deleteFile: protectedProcedure
			.input(z.object({ id: z.string() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getLibraryFile(input.id),
					"File not found",
				);
				await deleteLibraryFile(input.id);
				return { ok: true };
			}),
	}),

	// Video generation/editing — powers both the `generate_video`/`edit_video`
	// chat tools and the standalone Video Studio page. `generate` is
	// fire-and-forget (see queueVideoGeneration in ../video.ts): it returns a
	// job as soon as it's created, and the caller polls `get`/`list` for
	// progress rather than holding this request open for the several minutes
	// generation can take. `edit` is a single ffmpeg pass, fast enough to
	// await directly.
	video: router({
		// Fixed catalog (Sora only today, see video.ts in model-providers) —
		// exposed over tRPC so the Video Studio model picker can stay in sync
		// with the same list the "auto" heuristic picks from, like models.list
		// does for chat, instead of duplicating it as a frontend constant.
		models: publicProcedure.query(() => OPENAI_VIDEO_MODELS),
		generate: workspaceProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					folderId: z.string().nullable().optional(),
					prompt: z.string().min(1),
					model: z.string().optional(),
					size: z.string().optional(),
					seconds: z.number().int().optional(),
				}),
			)
			.mutation(({ input }) => queueVideoGeneration(input)),
		list: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => listVideoGenerationJobsForWorkspace(input.workspaceId)),
		get: protectedProcedure
			.input(z.object({ id: z.string() }))
			.query(({ input, ctx }) =>
				requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getVideoGenerationJobById(input.id),
					"Video generation job not found",
				),
			),
		edit: workspaceProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					folderId: z.string().nullable().optional(),
					operation: z.enum(["trim", "concat", "mute", "volume", "speed", "extractFrame", "toGif"]),
					libraryFileId: z.string().optional(),
					libraryFileIds: z.array(z.string()).optional(),
					startSeconds: z.number().optional(),
					endSeconds: z.number().optional(),
					volume: z.number().optional(),
					speed: z.number().optional(),
					timestampSeconds: z.number().optional(),
					fps: z.number().optional(),
				}),
			)
			.mutation(({ input }) => editVideo(input).then((result) => result.file)),
	}),

	// Workflow Studio — node-based image/video generation pipelines. This
	// router covers graph CRUD (definition = React Flow's nodes/edges, see
	// WorkflowDefinition in @nyxel/db) plus execution, which is delegated to
	// workflow-runner.ts the same way video generation is delegated to
	// ../video.ts.
	workflows: router({
		list: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => getDb().listWorkflowsByWorkspace(input.workspaceId)),
		get: protectedProcedure
			.input(z.object({ id: z.string() }))
			.query(({ input, ctx }) =>
				requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getWorkflow(input.id),
					"Workflow not found",
				),
			),
		create: workspaceProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					name: z.string().min(1),
					description: z.string().optional(),
					definition: workflowDefinitionSchema.optional(),
				}),
			)
			.mutation(({ input }) =>
				getDb().createWorkflow({
					...input,
					definition: input.definition ?? EMPTY_WORKFLOW_DEFINITION,
				}),
			),
		update: protectedProcedure
			.input(
				z.object({
					id: z.string(),
					name: z.string().min(1).optional(),
					description: z.string().nullable().optional(),
					definition: workflowDefinitionSchema.optional(),
				}),
			)
			.mutation(async ({ input: { id, ...patch }, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getWorkflow(id),
					"Workflow not found",
				);
				return getDb().updateWorkflow(id, patch);
			}),
		duplicate: protectedProcedure
			.input(z.object({ id: z.string() }))
			.mutation(async ({ input, ctx }) => {
				const original = await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getWorkflow(input.id),
					"Workflow not found",
				);
				return getDb().createWorkflow({
					workspaceId: original.workspaceId,
					name: `${original.name} (copy)`,
					description: original.description,
					definition: original.definition,
				});
			}),
		delete: protectedProcedure
			.input(z.object({ id: z.string() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getWorkflow(input.id),
					"Workflow not found",
				);
				await getDb().deleteWorkflow(input.id);
				return { ok: true };
			}),

		// Execution — see workflow-runner.ts. `start` is fire-and-forget like
		// video.generate: it returns as soon as the run + per-node rows exist,
		// and the builder page polls `get` (run + all its nodes together, one
		// call) to paint live per-node status on the canvas.
		runs: router({
			start: protectedProcedure
				.input(z.object({ workflowId: z.string() }))
				.mutation(async ({ input, ctx }) => {
					await requireEntityWorkspaceOwner(
						ctx.user.id,
						() => getDb().getWorkflow(input.workflowId),
						"Workflow not found",
					);
					return startWorkflowRun(input.workflowId);
				}),
			get: protectedProcedure
				.input(z.object({ id: z.string() }))
				.query(async ({ input, ctx }) => {
					const run = await getWorkflowRun(input.id);
					if (!run) return null;
					await requireWorkspaceOwner(ctx.user.id, run.workspaceId);
					const nodes = await listWorkflowRunNodes(input.id);
					return { run, nodes };
				}),
			listForWorkflow: protectedProcedure
				.input(z.object({ workflowId: z.string() }))
				.query(async ({ input, ctx }) => {
					await requireEntityWorkspaceOwner(
						ctx.user.id,
						() => getDb().getWorkflow(input.workflowId),
						"Workflow not found",
					);
					return listWorkflowRunsForWorkflow(input.workflowId);
				}),
		}),
	}),

	tools: router({
		// Workspace tools are DB-backed and user-configurable. This is the
		// Old Skills tab concept, renamed because it was not a real skill.
		list: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => listToolCatalogForWorkspace(input.workspaceId)),
		create: workspaceProcedure
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
				// write, execute, or control a browser defaults to sensitive. Callers
				// can still override explicitly via `sensitive`.
				const defaultSensitive = !NON_SENSITIVE_DEFAULT_TOOL_KINDS.has(
					input.kind,
				);
				return getDb().createTool({
					...input,
					sensitive: input.sensitive ?? defaultSensitive,
				});
			}),
		setEnabled: protectedProcedure
			.input(z.object({ id: z.string(), enabled: z.boolean() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getTool(input.id),
					"Tool not found",
				);
				return getDb().setToolEnabled(input.id, input.enabled);
			}),
		delete: protectedProcedure
			.input(z.object({ id: z.string() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getTool(input.id),
					"Tool not found",
				);
				return getDb().deleteTool(input.id);
			}),
	}),

	workspaces: router({
		list: protectedProcedure
			.input(z.object({ userId: z.string() }))
			.query(({ input, ctx }) => {
				if (input.userId !== ctx.user.id) {
					throw new TRPCError({ code: "FORBIDDEN" });
				}
				return getDb().listWorkspacesByUser(input.userId);
			}),
		create: protectedProcedure
			.input(z.object({ userId: z.string(), name: z.string().min(1) }))
			.mutation(async ({ input, ctx }) => {
				if (input.userId !== ctx.user.id) {
					throw new TRPCError({ code: "FORBIDDEN" });
				}
				const workspace = await getDb().createWorkspace(input);
				await seedBuiltinToolsForWorkspace(workspace.id);
				return workspace;
			}),
		get: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => getDb().getWorkspace(input.workspaceId)),
		updateSettings: workspaceProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					name: z.string().min(1).optional(),
					customInstructions: z.string().nullable().optional(),
					icon: z.string().nullable().optional(),
					color: z.string().nullable().optional(),
					defaultModelId: z.string().nullable().optional(),
					defaultAutonomyLevel: autonomyLevelSchema.optional(),
					defaultToolPolicy: chatToolPolicySchema.optional(),
				}),
			)
			.mutation(({ input }) => getDb().updateWorkspaceSettings(input)),
	}),

	chats: router({
		list: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => getDb().listChatsByWorkspace(input.workspaceId)),
		listArchived: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) =>
				getDb().listArchivedChatsByWorkspace(input.workspaceId),
			),
		listByProject: protectedProcedure
			.input(z.object({ projectId: z.string() }))
			.query(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getProject(input.projectId),
					"Project not found",
				);
				return getDb().listChatsByProject(input.projectId);
			}),
		create: workspaceProcedure
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
				const workspace = await db.getWorkspace(input.workspaceId);
				if (!modelId) {
					modelId = workspace?.defaultModelId ?? undefined;
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
				const toolPolicy = resolveChatToolPolicy(
					input,
					workspace?.defaultToolPolicy ?? DEFAULT_CHAT_TOOL_POLICY,
				);
				return db.createChat({
					...input,
					modelId,
					agentId,
					toolMode: toolPolicy.mode,
					toolPolicy,
				});
			}),
		rename: protectedProcedure
			.input(
				z.object({ chatId: z.string(), title: z.string().min(1).max(120) }),
			)
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getChat(input.chatId),
					"Chat not found",
				);
				return getDb().renameChat(input.chatId, input.title.trim());
			}),
		setArchived: protectedProcedure
			.input(z.object({ chatId: z.string(), archived: z.boolean() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getChat(input.chatId),
					"Chat not found",
				);
				return getDb().setChatArchived(input.chatId, input.archived);
			}),
		setPinned: protectedProcedure
			.input(z.object({ chatId: z.string(), pinned: z.boolean() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getChat(input.chatId),
					"Chat not found",
				);
				return getDb().setChatPinned(input.chatId, input.pinned);
			}),
		setProject: protectedProcedure
			.input(z.object({ chatId: z.string(), projectId: z.string().nullable() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getChat(input.chatId),
					"Chat not found",
				);
				return getDb().setChatProject(input.chatId, input.projectId);
			}),
		duplicate: protectedProcedure
			.input(z.object({ chatId: z.string() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getChat(input.chatId),
					"Chat not found",
				);
				return getDb().duplicateChat(input.chatId);
			}),
		// Turns public read-only sharing on/off for a chat. See chats.getShared
		// for the unauthenticated lookup used by the /share/{shareId} page.
		share: protectedProcedure
			.input(z.object({ chatId: z.string() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getChat(input.chatId),
					"Chat not found",
				);
				return getDb().setChatShared(input.chatId, true);
			}),
		unshare: protectedProcedure
			.input(z.object({ chatId: z.string() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getChat(input.chatId),
					"Chat not found",
				);
				return getDb().setChatShared(input.chatId, false);
			}),
		// Deliberately public — this is the unauthenticated /share/{shareId}
		// viewer link lookup, keyed by an unguessable shareId rather than the
		// chat's real id.
		getShared: publicProcedure
			.input(z.object({ shareId: z.string() }))
			.query(async ({ input }) => {
				const db = getDb();
				const chat = await db.getChatByShareId(input.shareId);
				if (!chat) return null;
				const messages = await db.listMessages(chat.id);
				return { chat, messages };
			}),
		delete: protectedProcedure
			.input(z.object({ chatId: z.string() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getChat(input.chatId),
					"Chat not found",
				);
				return getDb().deleteChat(input.chatId);
			}),
		messages: protectedProcedure
			.input(z.object({ chatId: z.string() }))
			.query(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getChat(input.chatId),
					"Chat not found",
				);
				return getDb().listMessages(input.chatId);
			}),
		// Re-points a chat at a different (usually freshly forked) agent — see
		// updateChatAgent's doc comment in packages/db/src/repo/types.ts.
		setAgent: protectedProcedure
			.input(z.object({ chatId: z.string(), agentId: z.string().nullable() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getChat(input.chatId),
					"Chat not found",
				);
				return getDb().updateChatAgent(input.chatId, input.agentId);
			}),
		setToolPolicy: protectedProcedure
			.input(
				z.object({
					chatId: z.string(),
					toolMode: chatToolModeSchema,
					toolPolicy: chatToolPolicySchema,
				}),
			)
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getChat(input.chatId),
					"Chat not found",
				);
				return getDb().updateChatToolPolicy({
					chatId: input.chatId,
					toolMode: input.toolMode,
					toolPolicy: resolveChatToolPolicy(input),
				});
			}),
	}),

	projects: router({
		list: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => getDb().listProjectsByWorkspace(input.workspaceId)),
		get: protectedProcedure
			.input(z.object({ projectId: z.string() }))
			.query(({ input, ctx }) =>
				requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getProject(input.projectId),
					"Project not found",
				),
			),
		create: workspaceProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					name: z.string().min(1).max(120),
					color: z.string().max(40).optional(),
					icon: z.string().max(40).optional(),
				}),
			)
			.mutation(({ input }) =>
				getDb().createProject({ ...input, name: input.name.trim() }),
			),
		rename: protectedProcedure
			.input(
				z.object({ projectId: z.string(), name: z.string().min(1).max(120) }),
			)
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getProject(input.projectId),
					"Project not found",
				);
				return getDb().renameProject(input.projectId, input.name.trim());
			}),
		setAppearance: protectedProcedure
			.input(
				z.object({
					projectId: z.string(),
					color: z.string().max(40),
					icon: z.string().max(40),
				}),
			)
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getProject(input.projectId),
					"Project not found",
				);
				return getDb().setProjectAppearance(input.projectId, {
					color: input.color,
					icon: input.icon,
				});
			}),
		duplicate: protectedProcedure
			.input(z.object({ projectId: z.string() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getProject(input.projectId),
					"Project not found",
				);
				return getDb().duplicateProject(input.projectId);
			}),
		delete: protectedProcedure
			.input(z.object({ projectId: z.string() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getProject(input.projectId),
					"Project not found",
				);
				return getDb().deleteProject(input.projectId);
			}),
	}),

	agents: router({
		list: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => getDb().listAgentsByWorkspace(input.workspaceId)),
		get: protectedProcedure
			.input(z.object({ id: z.string() }))
			.query(({ input, ctx }) =>
				requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getAgent(input.id),
					"Agent not found",
				),
			),
		create: workspaceProcedure
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
		update: protectedProcedure
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
			.mutation(async ({ input: { id, ...input }, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getAgent(id),
					"Agent not found",
				);
				return getDb().updateAgent(id, input);
			}),
		delete: protectedProcedure
			.input(z.object({ id: z.string() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getAgent(input.id),
					"Agent not found",
				);
				await deleteAgentGuarded(getDb(), input.id);
				return { ok: true };
			}),
		// Deletes each id independently — one agent still in use by an
		// automation/active run doesn't block the rest of the selection.
		deleteMany: protectedProcedure
			.input(z.object({ ids: z.array(z.string()).min(1) }))
			.mutation(async ({ input, ctx }) => {
				const db = getDb();
				const errors: { id: string; name: string; message: string }[] = [];
				let deletedCount = 0;
				for (const id of input.ids) {
					try {
						await requireEntityWorkspaceOwner(
							ctx.user.id,
							() => db.getAgent(id),
							"Agent not found",
						);
						await deleteAgentGuarded(db, id);
						deletedCount++;
					} catch (err) {
						const agent = await db.getAgent(id);
						errors.push({
							id,
							name: agent?.name ?? id,
							message: err instanceof Error ? err.message : String(err),
						});
					}
				}
				return { deletedCount, errors };
			}),
		// Read-only version of cleanupUnusedChatAgents' filter — lets the UI show
		// an accurate "N unused" count before the user commits to deleting.
		listUnusedChatAgentIds: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => getDb().listUnusedChatAgentIds(input.workspaceId)),
		// Bulk-cleans the "Chat — custom tools" one-off agents that pile up from
		// repeatedly changing a chat's tool/model selection (see chat/[chatId]
		// page.tsx's forkAgent) — only removes ones no chat currently points at.
		cleanupUnusedChatAgents: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.mutation(({ input }) => getDb().deleteUnusedChatAgents(input.workspaceId)),
	}),

	// Self-healing/health agent v1 (checks + reporting only, no automatic
	// fixes — see apps/server/src/health-agent.ts). Named "healthCheck" rather
	// than "health" since that key is already the plain liveness probe above.
	healthCheck: router({
		run: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.mutation(({ input }) => runHealthCheckForWorkspace(input.workspaceId)),
	}),

	tasks: router({
		list: workspaceProcedure
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
		get: protectedProcedure
			.input(z.object({ taskId: z.string() }))
			.query(async ({ input, ctx }) => {
				const db = getDb();
				const task = await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => db.getTask(input.taskId),
					"Task not found",
				);
				return {
					task,
					children: await db.listTaskTree(input.taskId),
					events: await db.listTaskEvents(input.taskId),
					runs: await db.listAgentRunsByTask(input.taskId),
				};
			}),
		create: workspaceProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					parentTaskId: z.string().nullable().optional(),
					sourceChatId: z.string().nullable().optional(),
					createdByAgentId: z.string().nullable().optional(),
					assignedAgentId: z.string().nullable().optional(),
					title: z.string().min(1),
					instruction: z.string().min(1),
					// Overrides the assigned agent's default model for this task only —
					// lets the same agent run different tasks against different models.
					modelId: z.string().nullable().optional(),
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
					modelId: input.modelId ?? null,
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
		assign: protectedProcedure
			.input(
				z.object({
					taskId: z.string(),
					assignedAgentId: z.string().nullable(),
				}),
			)
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getTask(input.taskId),
					"Task not found",
				);
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
		setModel: protectedProcedure
			.input(
				z.object({
					taskId: z.string(),
					modelId: z.string().nullable(),
				}),
			)
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getTask(input.taskId),
					"Task not found",
				);
				const task = await getDb().updateTask(input.taskId, {
					modelId: input.modelId,
				});
				await getDb().createTaskEvent({
					taskId: task.id,
					workspaceId: task.workspaceId,
					kind: "comment",
					message: input.modelId
						? `Model override set to ${input.modelId}.`
						: "Model override cleared — using the agent's default model.",
					payload: { modelId: input.modelId },
				});
				return task;
			}),
		complete: protectedProcedure
			.input(
				z.object({
					taskId: z.string(),
					resultSummary: z.string().min(1),
				}),
			)
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getTask(input.taskId),
					"Task not found",
				);
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
		cancel: protectedProcedure
			.input(z.object({ taskId: z.string() }))
			.mutation(async ({ input, ctx }) => {
				const db = getDb();
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => db.getTask(input.taskId),
					"Task not found",
				);
				// If an agent run is still live, abort its in-flight model call
				// (cancelAgentRun) instead of just flipping the task's status —
				// otherwise the run keeps streaming in the background and can
				// overwrite the "cancelled" status once it finishes.
				const runs = await db.listAgentRunsByTask(input.taskId);
				const activeRun = runs.find((r) => r.status === "running");
				if (activeRun) {
					await cancelAgentRun(activeRun.id);
					const task = await db.getTask(input.taskId);
					if (!task) throw new Error(`Unknown task: ${input.taskId}`);
					return task;
				}

				const task = await db.updateTask(input.taskId, {
					status: "cancelled",
					completedAt: new Date(),
				});
				await db.createTaskEvent({
					taskId: task.id,
					workspaceId: task.workspaceId,
					kind: "failed",
					message: "Task cancelled.",
				});
				return task;
			}),
		start: protectedProcedure
			.input(z.object({ taskId: z.string() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getTask(input.taskId),
					"Task not found",
				);
				const started = await startTaskExecutionIfIdle({
					taskId: input.taskId,
					trigger: "task",
				});
				if (started) return started.task;
				const task = await getDb().getTask(input.taskId);
				if (!task) throw new Error(`Unknown task: ${input.taskId}`);
				return task;
			}),
		reply: protectedProcedure
			.input(
				z.object({
					taskId: z.string(),
					instruction: z.string().min(1),
				}),
			)
			.mutation(async ({ input, ctx }) => {
				const db = getDb();
				const task = await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => db.getTask(input.taskId),
					"Task not found",
				);
				const agentId = task.assignedAgentId ?? task.createdByAgentId;
				if (!agentId) {
					throw new Error("This task has no agent to continue with.");
				}
				const agent = await db.getAgent(agentId);
				if (!agent) {
					throw new Error(`Unknown agent: ${agentId}`);
				}
				const wasBlockedOnQuestion = task.status === "blocked";
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
					kind: wasBlockedOnQuestion ? "question_answered" : "comment",
					message: wasBlockedOnQuestion
						? "User answered the pending question."
						: "Follow-up instruction added.",
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
				// Repo-scoped tasks (e.g. the SEO fixer) need the same working
				// directory on every follow-up run that the original dispatch used
				// (see dispatchSeoFix in seo-analyzer.ts) — claude_cli models fail
				// outright without one. The task row doesn't persist workingDirectory
				// directly, but SEO-dispatched tasks stash seoProjectId in `input`,
				// so re-resolve the repo path from there.
				const taskInput = task.input as { seoProjectId?: string } | null;
				const seoProject = taskInput?.seoProjectId
					? await db.getSeoProject(taskInput.seoProjectId)
					: null;

				const result = await executeManagedTask({
					taskId: task.id,
					agent,
					trigger: "chat",
					chatId: task.sourceChatId,
					instructionOverride: input.instruction,
					workingDirectory: seoProject?.repoPath,
				});
				return result.task;
			}),
		events: protectedProcedure
			.input(z.object({ taskId: z.string() }))
			.query(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getTask(input.taskId),
					"Task not found",
				);
				return getDb().listTaskEvents(input.taskId);
			}),
	}),

	agentRuns: router({
		/** All runs in a workspace regardless of status — powers the
		 * standalone Runs board (as opposed to `listActive`, which only
		 * surfaces the in-flight subset for the Tasks page's live strip). */
		list: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => getDb().listAgentRunsByWorkspace(input.workspaceId)),
		listByTask: protectedProcedure
			.input(z.object({ taskId: z.string() }))
			.query(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getTask(input.taskId),
					"Task not found",
				);
				return getDb().listAgentRunsByTask(input.taskId);
			}),
		listByAgent: protectedProcedure
			.input(z.object({ agentId: z.string() }))
			.query(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getAgent(input.agentId),
					"Agent not found",
				);
				return getDb().listAgentRunsByAgent(input.agentId);
			}),
		listActive: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => getDb().listActiveAgentRunsByWorkspace(input.workspaceId)),
		cancel: protectedProcedure
			.input(z.object({ runId: z.string() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getAgentRun(input.runId),
					"Agent run not found",
				);
				return cancelAgentRun(input.runId);
			}),
	}),

	mcpServers: router({
		catalog: publicProcedure.query(() => MCP_CONNECTOR_CATALOG),
		list: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) =>
				getDb().listMcpServersByWorkspace(input.workspaceId),
			),
		create: workspaceProcedure.input(mcpServerCreateSchema).mutation(({ input }) =>
			getDb().createMcpServer({
				...input,
				command: input.command?.trim(),
				url: input.url?.trim(),
			}),
		),
		// For catalog entries with configFields — writes any "secret-file" values
		// to a local file and builds the stdio server's env from the result,
		// since those commands only accept a credentials *path*, not the secret
		// itself as an argument.
		connectWithConfig: workspaceProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					key: z.string(),
					values: z.record(z.string(), z.string()),
				}),
			)
			.mutation(({ input }) => {
				const entry = MCP_CONNECTOR_CATALOG.find((e) => e.key === input.key);
				if (!entry) throw new Error(`Unknown connector: ${input.key}`);
				if (entry.transport !== "stdio" || !entry.command) {
					throw new Error(
						`"${entry.name}" doesn't support connecting with a config form.`,
					);
				}
				const env: Record<string, string> = {};
				for (const field of entry.configFields ?? []) {
					const value = input.values[field.key]?.trim();
					if (!value) {
						throw new Error(`"${field.label}" is required to connect ${entry.name}.`);
					}
					env[field.envVar] =
						field.kind === "secret-file"
							? writeMcpSecretFile(input.workspaceId, `${entry.key}-${field.key}`, value)
							: value;
				}
				return getDb().createMcpServer({
					workspaceId: input.workspaceId,
					name: entry.name,
					transport: "stdio",
					command: entry.command,
					args: entry.args,
					env,
				});
			}),
		delete: protectedProcedure
			.input(z.object({ id: z.string() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getMcpServer(input.id),
					"MCP server not found",
				);
				return getDb().deleteMcpServer(input.id);
			}),
		// Connects on demand and lists the server's tools — lets the UI offer a
		// "test connection" action without keeping every configured server
		// connected all the time.
		listTools: protectedProcedure
			.input(z.object({ id: z.string() }))
			.query(async ({ input, ctx }) => {
				const server = await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getMcpServer(input.id),
					"MCP server not found",
				);
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
		finishAuth: protectedProcedure
			.input(z.object({ id: z.string(), code: z.string().min(1) }))
			.mutation(async ({ input, ctx }) => {
				const server = await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getMcpServer(input.id),
					"MCP server not found",
				);
				await completeMcpServerAuthorization(server, input.code);
				return { ok: true };
			}),
	}),

	extensions: router({
		catalog: publicProcedure.query(() => EXTENSION_CATALOG),
		list: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) =>
				getDb().listExtensionsByWorkspace(input.workspaceId),
			),
		install: workspaceProcedure
			.input(z.object({ workspaceId: z.string(), key: z.string() }))
			.mutation(async ({ input }) => {
				const catalogEntry = getExtensionCatalogEntry(input.key);
				if (!catalogEntry) throw new Error(`Unknown extension: ${input.key}`);
				const db = getDb();
				const existing = await db.getExtensionByKey(
					input.workspaceId,
					input.key,
				);
				const record = existing
					? await db.setExtensionEnabled(existing.id, true)
					: await db.installExtension({
							workspaceId: input.workspaceId,
							key: input.key,
						});
				await logAudit({
					workspaceId: input.workspaceId,
					actor: "extension",
					toolLabel: "extensions.install",
					input: { key: input.key },
					status: "success",
				});

				// Best-effort companion plugin install (see
				// ExtensionCatalogEntry.pluginRepoUrl) — never blocks activation.
				let pluginInstall: Awaited<ReturnType<typeof ensureExtensionPlugin>> | null = null;
				if (catalogEntry.pluginRepoUrl) {
					pluginInstall = await ensureExtensionPlugin(
						input.workspaceId,
						catalogEntry.pluginRepoUrl,
					);
					await logAudit({
						workspaceId: input.workspaceId,
						actor: "extension",
						toolLabel: "extensions.install_plugin",
						input: { key: input.key, repoUrl: catalogEntry.pluginRepoUrl },
						output: { status: pluginInstall.status, error: pluginInstall.error },
						status: pluginInstall.status === "failed" ? "error" : "success",
					});
				}

				return { extension: record, pluginInstall };
			}),
		setEnabled: protectedProcedure
			.input(z.object({ id: z.string(), enabled: z.boolean() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getExtension(input.id),
					"Extension not found",
				);
				return getDb().setExtensionEnabled(input.id, input.enabled);
			}),
		updateConfig: protectedProcedure
			.input(
				z.object({ id: z.string(), config: z.record(z.string(), z.unknown()) }),
			)
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getExtension(input.id),
					"Extension not found",
				);
				return getDb().updateExtensionConfig(input.id, input.config);
			}),
		uninstall: protectedProcedure
			.input(z.object({ id: z.string() }))
			.mutation(async ({ input, ctx }) => {
				const db = getDb();
				const existing = await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => db.getExtension(input.id),
					"Extension not found",
				);
				await db.uninstallExtension(input.id);
				await logAudit({
					workspaceId: existing.workspaceId,
					actor: "extension",
					toolLabel: "extensions.uninstall",
					input: { key: existing.key },
					status: "success",
				});
			}),
	}),

	seoAnalyzer: router({
		listProjects: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => getDb().listSeoProjectsByWorkspace(input.workspaceId)),
		createProject: workspaceProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					domain: z.string().min(1),
					repoPath: z.string().min(1),
				}),
			)
			.mutation(async ({ input }) => {
				await validateRepoPath(input.repoPath);
				const db = getDb();
				const ext = await db.getExtensionByKey(input.workspaceId, "seo-analyzer");
				if (!ext) {
					throw new Error(
						"The SEO/GEO/AEO Analyzer extension isn't installed in this workspace.",
					);
				}
				return db.createSeoProject({
					workspaceId: input.workspaceId,
					extensionId: ext.id,
					domain: input.domain.trim(),
					repoPath: input.repoPath.trim(),
				});
			}),
		updateProject: protectedProcedure
			.input(
				z.object({
					id: z.string(),
					domain: z.string().min(1).optional(),
					repoPath: z.string().min(1).optional(),
				}),
			)
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getSeoProject(input.id),
					"SEO project not found",
				);
				if (input.repoPath) await validateRepoPath(input.repoPath);
				return getDb().updateSeoProject(input.id, {
					domain: input.domain,
					repoPath: input.repoPath,
				});
			}),
		deleteProject: protectedProcedure
			.input(z.object({ id: z.string() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getSeoProject(input.id),
					"SEO project not found",
				);
				return getDb().deleteSeoProject(input.id);
			}),
		// Lets the user pick which agent runs fix-dispatch/blog-generation for a
		// project instead of always auto-provisioning a dedicated repo-scoped
		// one (see configureSeoFixerAgent in seo-analyzer.ts, which respects
		// project.fixerAgentId as-is when it's a non-auto-provisioned agent —
		// this is the only place that sets it to a user-chosen agent).
		// Passing null clears the pin, reverting to auto-provisioning.
		setFixerAgent: protectedProcedure
			.input(z.object({ id: z.string(), agentId: z.string().nullable() }))
			.mutation(async ({ input, ctx }) => {
				const db = getDb();
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => db.getSeoProject(input.id),
					"SEO project not found",
				);
				if (input.agentId) {
					const agent = await db.getAgent(input.agentId);
					if (!agent) throw new Error(`Unknown agent: ${input.agentId}`);
					const project = await db.getSeoProject(input.id);
					if (!project) throw new Error(`Unknown SEO project: ${input.id}`);
					if (agent.workspaceId !== project.workspaceId) {
						throw new Error("Agent must belong to the same workspace.");
					}
				}
				return db.updateSeoProject(input.id, { fixerAgentId: input.agentId });
			}),
		setSchedule: protectedProcedure
			.input(z.object({ id: z.string(), cronExpression: z.string().nullable() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getSeoProject(input.id),
					"SEO project not found",
				);
				if (input.cronExpression === null) {
					return getDb().updateSeoProject(input.id, {
						reanalyzeCronExpression: null,
						nextReanalyzeAt: null,
					});
				}
				const nextReanalyzeAt = computeNextRunAt(input.cronExpression, new Date());
				if (!nextReanalyzeAt) {
					throw new Error(`"${input.cronExpression}" is not a valid cron expression.`);
				}
				return getDb().updateSeoProject(input.id, {
					reanalyzeCronExpression: input.cronExpression,
					nextReanalyzeAt,
				});
			}),
		listRuns: protectedProcedure
			.input(z.object({ seoProjectId: z.string() }))
			.query(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getSeoProject(input.seoProjectId),
					"SEO project not found",
				);
				return getDb().listSeoAnalysisRunsByProject(input.seoProjectId);
			}),
		listFindings: protectedProcedure
			.input(z.object({ runId: z.string() }))
			.query(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getSeoAnalysisRun(input.runId),
					"SEO analysis run not found",
				);
				return getDb().listSeoFindingsByRun(input.runId);
			}),
		listOpenFindings: protectedProcedure
			.input(z.object({ seoProjectId: z.string() }))
			.query(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getSeoProject(input.seoProjectId),
					"SEO project not found",
				);
				return getDb().listOpenSeoFindingsByProject(input.seoProjectId);
			}),
		// Every finding ever detected (resolved + open) — powers the stats/KPI
		// breakdowns on the overview tab, as opposed to listOpenFindings which
		// only covers what still needs attention.
		listAllFindings: protectedProcedure
			.input(z.object({ seoProjectId: z.string() }))
			.query(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getSeoProject(input.seoProjectId),
					"SEO project not found",
				);
				return getDb().listSeoFindingsByProject(input.seoProjectId);
			}),
		listBlogPosts: protectedProcedure
			.input(z.object({ seoProjectId: z.string() }))
			.query(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getSeoProject(input.seoProjectId),
					"SEO project not found",
				);
				return getDb().listSeoBlogPostsByProject(input.seoProjectId);
			}),
		runAnalysis: protectedProcedure
			.input(z.object({ seoProjectId: z.string() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getSeoProject(input.seoProjectId),
					"SEO project not found",
				);
				return runSeoAnalysis(input.seoProjectId);
			}),
		dispatchFix: protectedProcedure
			.input(
				z.object({
					seoProjectId: z.string(),
					findingIds: z.array(z.string()).min(1),
				}),
			)
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getSeoProject(input.seoProjectId),
					"SEO project not found",
				);
				return dispatchSeoFix(input.seoProjectId, input.findingIds);
			}),
		generateBlogPost: protectedProcedure
			.input(z.object({ seoProjectId: z.string(), keyword: z.string().min(1) }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getSeoProject(input.seoProjectId),
					"SEO project not found",
				);
				return generateSeoBlogPost(input.seoProjectId, input.keyword);
			}),
	}),

	automations: router({
		list: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) =>
				getDb().listAutomationsByWorkspace(input.workspaceId),
			),
		create: workspaceProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					targetKind: automationTargetKindSchema.default("agent"),
					agentId: z.string().optional(),
					workflowId: z.string().optional(),
					name: z.string().min(1),
					triggerType: automationTriggerTypeSchema.default("cron"),
					cronExpression: z.string().optional(),
					watchPath: z.string().optional(),
					watchGlob: z.string().optional(),
					// Only meaningful for targetKind "agent" — a workflow graph has no
					// single prompt, it just runs.
					prompt: z.string().optional(),
					enabled: z.boolean().optional(),
				}),
			)
			.mutation(async ({ input }) => {
				const db = getDb();
				if (input.targetKind === "workflow") {
					if (!input.workflowId) {
						throw new Error('A workflow automation needs "workflowId".');
					}
					const workflow = await db.getWorkflow(input.workflowId);
					if (!workflow || workflow.workspaceId !== input.workspaceId) {
						throw new Error(`Unknown workflow: ${input.workflowId}`);
					}
				} else {
					if (!input.agentId) {
						throw new Error('An agent automation needs "agentId".');
					}
					const agent = await db.getAgent(input.agentId);
					if (!agent) throw new Error(`Unknown agent: ${input.agentId}`);
					if (!AUTOMATABLE_LEVELS.has(agent.autonomyLevel)) {
						throw new Error(
							`Agent "${agent.name}" has autonomy level "${agent.autonomyLevel}" — only "autonomous" or "super_agent" agents can be scheduled.`,
						);
					}
					if (!input.prompt) {
						throw new Error('An agent automation needs "prompt".');
					}
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
		setEnabled: protectedProcedure
			.input(z.object({ id: z.string(), enabled: z.boolean() }))
			.mutation(async ({ input, ctx }) => {
				const db = getDb();
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => db.getAutomation(input.id),
					"Automation not found",
				);
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
		update: protectedProcedure
			.input(
				z.object({
					id: z.string(),
					name: z.string().min(1).optional(),
					agentId: z.string().optional(),
					workflowId: z.string().optional(),
					cronExpression: z.string().optional(),
					watchPath: z.string().optional(),
					watchGlob: z.string().optional(),
					prompt: z.string().min(1).optional(),
				}),
			)
			.mutation(async ({ input, ctx }) => {
				const db = getDb();
				const { id, ...patch } = input;
				const automation = await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => db.getAutomation(id),
					"Automation not found",
				);

				if (patch.agentId) {
					const agent = await db.getAgent(patch.agentId);
					if (!agent) throw new Error(`Unknown agent: ${patch.agentId}`);
					if (!AUTOMATABLE_LEVELS.has(agent.autonomyLevel)) {
						throw new Error(
							`Agent "${agent.name}" has autonomy level "${agent.autonomyLevel}" — only "autonomous" or "super_agent" agents can be scheduled.`,
						);
					}
				}
				if (patch.workflowId) {
					const workflow = await db.getWorkflow(patch.workflowId);
					if (!workflow || workflow.workspaceId !== automation.workspaceId) {
						throw new Error(`Unknown workflow: ${patch.workflowId}`);
					}
				}

				const recomputedNextRun: { nextRunAt?: Date | null } = {};
				if (automation.triggerType === "cron" && patch.cronExpression) {
					const nextRunAt = computeNextRunAt(patch.cronExpression, new Date());
					if (!nextRunAt)
						throw new Error(
							`"${patch.cronExpression}" is not a valid cron expression.`,
						);
					recomputedNextRun.nextRunAt = nextRunAt;
				}

				return db.updateAutomation(id, { ...patch, ...recomputedNextRun });
			}),
		delete: protectedProcedure
			.input(z.object({ id: z.string() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getAutomation(input.id),
					"Automation not found",
				);
				return getDb().deleteAutomation(input.id);
			}),
		runNow: protectedProcedure
			.input(z.object({ id: z.string() }))
			.mutation(async ({ input, ctx }) => {
				const db = getDb();
				const automation = await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => db.getAutomation(input.id),
					"Automation not found",
				);
				const summary = await runAutomation(automation);
				const updated = await db.getAutomation(input.id);
				return { automation: updated, ...summary };
			}),
	}),

	approvals: router({
		list: workspaceProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					status: approvalStatusSchema.optional(),
				}),
			)
			.query(({ input }) =>
				getDb().listApprovalsByWorkspace(input.workspaceId, input.status),
			),
		approve: protectedProcedure
			.input(z.object({ id: z.string() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getApprovalRequest(input.id),
					"Approval request not found",
				);
				return resolveApprovalDecision(input.id, "approved");
			}),
		reject: protectedProcedure
			.input(z.object({ id: z.string() }))
			.mutation(async ({ input, ctx }) => {
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => getDb().getApprovalRequest(input.id),
					"Approval request not found",
				);
				return resolveApprovalDecision(input.id, "rejected");
			}),
	}),

	auditLog: router({
		list: workspaceProcedure
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

	stats: router({
		/** Powers the "Detailed statistics" section of the Overview dashboard —
		 * see apps/server/src/stats.ts for the aggregation. */
		overview: workspaceProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					days: z.number().min(1).max(90).optional(),
				}),
			)
			.query(({ input }) => getWorkspaceStatsOverview(input.workspaceId, input.days)),
	}),

	knowledgeBase: router({
		overview: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => getKnowledgeBaseOverview(input.workspaceId)),
		updateConfig: workspaceProcedure
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
		documents: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => listKnowledgeBaseDocuments(input.workspaceId)),
		graph: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(async ({ input }) => {
				const documents = await listKnowledgeBaseDocuments(input.workspaceId);
				return buildKnowledgeBaseGraph(documents);
			}),
		runDocsAgent: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.mutation(({ input }) =>
				runDocsAgentForWorkspace(input.workspaceId, "manual"),
			),
	}),

	notifications: router({
		vapidPublicKey: publicProcedure.query(() => getVapidPublicKey()),
		// TODO(ADR-0017): needs auth review — PushSubscriptionRecord is keyed by
		// userId, not workspaceId, so it doesn't fit requireEntityWorkspaceOwner;
		// no getPushSubscription*-by-id getter exists to check the subscription
		// belongs to ctx.user before create/delete. Gated to signed-in users for
		// now; add a per-user ownership check once a suitable getter exists.
		subscribe: protectedProcedure
			.input(
				z.object({
					userId: z.string(),
					endpoint: z.string(),
					keys: z.object({ p256dh: z.string(), auth: z.string() }),
					userAgent: z.string().optional(),
				}),
			)
			.mutation(({ input, ctx }) => {
				if (input.userId !== ctx.user.id) {
					throw new TRPCError({ code: "FORBIDDEN" });
				}
				return getDb().createPushSubscription({
					userId: input.userId,
					endpoint: input.endpoint,
					p256dh: input.keys.p256dh,
					auth: input.keys.auth,
					userAgent: input.userAgent,
				});
			}),
		// TODO(ADR-0017): needs auth review — deletes by endpoint string with no
		// stored link back to ctx.user checked here (see subscribe's note above).
		unsubscribe: protectedProcedure
			.input(z.object({ endpoint: z.string() }))
			.mutation(({ input }) => getDb().deletePushSubscriptionByEndpoint(input.endpoint)),
	}),

	memory: router({
		list: workspaceProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					type: memoryTypeSchema.optional(),
				}),
			)
			.query(({ input }) => getDb().listMemoryEntriesByWorkspace(input.workspaceId, input.type)),
		create: workspaceProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					type: memoryTypeSchema,
					content: z.string().min(1),
					source: memorySourceSchema.default("user"),
					confidence: z.number().min(0).max(1).optional(),
					expiresAt: z.date().nullable().optional(),
				}),
			)
			.mutation(({ input }) => getDb().createMemoryEntry(input)),
		update: protectedProcedure
			.input(
				z.object({
					id: z.string(),
					content: z.string().min(1).optional(),
					confidence: z.number().min(0).max(1).optional(),
					expiresAt: z.date().nullable().optional(),
				}),
			)
			.mutation(async ({ input, ctx }) => {
				const db = getDb();
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => db.getMemoryEntry(input.id),
					"Memory entry not found",
				);
				return db.updateMemoryEntry(input.id, {
					content: input.content,
					confidence: input.confidence,
					expiresAt: input.expiresAt,
				});
			}),
		delete: protectedProcedure
			.input(z.object({ id: z.string() }))
			.mutation(async ({ input, ctx }) => {
				const db = getDb();
				await requireEntityWorkspaceOwner(
					ctx.user.id,
					() => db.getMemoryEntry(input.id),
					"Memory entry not found",
				);
				return db.deleteMemoryEntry(input.id);
			}),
	}),

	artifacts: router({
		list: workspaceProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => getDb().listArtifactsByWorkspace(input.workspaceId)),
		listByTask: protectedProcedure
			.input(z.object({ taskId: z.string() }))
			.query(async ({ input, ctx }) => {
				const db = getDb();
				await requireEntityWorkspaceOwner(ctx.user.id, () => db.getTask(input.taskId), "Task not found");
				return db.listArtifactsByTask(input.taskId);
			}),
		get: protectedProcedure
			.input(z.object({ id: z.string() }))
			.query(async ({ input, ctx }) => {
				const db = getDb();
				return requireEntityWorkspaceOwner(
					ctx.user.id,
					() => db.getArtifact(input.id),
					"Artifact not found",
				);
			}),
	}),

	// Read-only Coding-workspace groundwork (ADR-0017, ARCHITECTURE.md
	// section 11) — file tree, git status, git diff. `rootDir` is a free
	// local path like chat.workingDirectory (see working-directory-picker.tsx),
	// not a stored/validated workspace field; workspaceProcedure's ownership
	// check still applies to `workspaceId` so only the workspace's owner can
	// call these. Actual writes stay on the existing approval-gated file
	// tools — nothing here mutates anything.
	coding: router({
		repoInfo: workspaceProcedure
			.input(z.object({ workspaceId: z.string(), rootDir: z.string().min(1) }))
			.query(({ input }) => getRepoInfo(input.rootDir)),
		status: workspaceProcedure
			.input(z.object({ workspaceId: z.string(), rootDir: z.string().min(1) }))
			.query(({ input }) => getGitStatus(input.rootDir)),
		diff: workspaceProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					rootDir: z.string().min(1),
					filePath: z.string().optional(),
				}),
			)
			.query(({ input }) => getGitDiff(input.rootDir, input.filePath)),
		listDirectory: workspaceProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					rootDir: z.string().min(1),
					relativePath: z.string().default(""),
				}),
			)
			.query(({ input }) => listDirectory(input.rootDir, input.relativePath)),
	}),
});

export type AppRouter = typeof appRouter;
