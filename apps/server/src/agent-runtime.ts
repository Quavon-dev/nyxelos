import { randomUUID } from "node:crypto";
import {
  canDelegateDeeper,
  createRunOutcomeSignal,
  filterCyclicCandidates,
  isTerminalAgentRunStatus,
  type RunOutcomeSignal,
  resolveRunOutcome,
} from "@nyxel/core-agent-engine";
import type { AgentRecord, AgentRunRecord, TaskRecord } from "@nyxel/db";
import { getDb } from "@nyxel/db";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  getModelCapabilities,
  streamChat,
} from "@nyxel/model-providers";
import { sanitizeForAudit } from "./audit";
import {
  type AutonomyBudgetTracker,
  checkModelCallCostBudget,
  createAutonomyBudgetTracker,
  recordModelCallCost,
  resolveAutonomyBudget,
} from "./autonomy-budget";
import { emitNyxelEvent } from "./event-bus";
import { NyxelEvent } from "./events";
import { getKnowledgeBaseContextForPrompt } from "./knowledge-base";
import { getInstalledProvidersForWorkspace } from "./models";
import { notifyWorkspaceOwner } from "./push";
import { buildToolsForAgent, toolPolicyForAutonomyLevel } from "./tools";
import { composeSystemPrompt } from "./workspace-prompt";

/** Transient-shaped failures (network blips, provider rate limits, momentary
 * 5xx) are worth an automatic retry with backoff; everything else (a bad
 * prompt, an unknown model, a genuine logic error) is retried at the user's
 * own discretion instead, since retrying it again would just fail the same
 * way. Matched against the error's own message — deliberately broad, since
 * provider SDKs don't share one error taxonomy. */
const TRANSIENT_ERROR_PATTERN =
  /econnreset|etimedout|econnrefused|eai_again|fetch failed|network error|socket hang up|timed? ?out|rate.?limit|too many requests|\b429\b|\b500\b|\b502\b|\b503\b|\b504\b|service unavailable|overloaded/i;

function isTransientRunError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return TRANSIENT_ERROR_PATTERN.test(message);
}

/** Exponential backoff capped at 10s — small enough that a durable task
 * doesn't stall for minutes, large enough to ride out a brief provider
 * hiccup or rate-limit window. */
function retryBackoffMs(attempt: number): number {
  return Math.min(10_000, 500 * 2 ** attempt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ceiling on in-process transient-failure retries for one run — see
 * agentRun.maxRetries (packages/db). A run created before this feature
 * existed (or whose maxRetries wasn't explicitly set) falls back to this
 * default rather than retrying forever. */
const DEFAULT_MAX_TRANSIENT_RETRIES = 3;

export interface DelegationTask {
  agentId: string;
  instruction: string;
}

export interface ExecutionPlan {
  goal: string;
  successCriteria: string[];
  steps: string[];
  neededCapabilities: string[];
  delegationCandidates: string[];
  /** A distinct sub-instruction per delegate candidate, rather than every
   * delegated child getting the parent task's instruction verbatim — see
   * toExecutionPlan's fallback for what happens when the model omits this
   * (or a candidate isn't covered) for a given delegate. */
  delegationTasks: DelegationTask[];
  completionCheck: string;
}

/** In-memory registry of the abort controller backing each live run —
 * process-local, so a run started before a server restart can no longer be
 * aborted in-flight (cancelAgentRun still marks it cancelled in the DB). */
const activeRunControllers = new Map<string, AbortController>();

/** Every real model call this module makes (planning, direct execution,
 * delegation synthesis, the verifier step) goes through this single
 * swappable reference instead of calling the imported `streamChat` directly
 * — the only way tests can exercise the plan → execute → complete state
 * machine, tool-call persistence, retries, etc. without hitting a real
 * local/cloud model. Production code never calls the setters below; the
 * default is the real `streamChat` from `@nyxel/model-providers`. */
let streamChatImpl: typeof streamChat = streamChat;

/** Test-only seam — see `streamChatImpl` above. Not exported from the
 * package's public surface (this module has none), only imported directly
 * by agent-runtime.test.ts. */
export function __setStreamChatImplForTests(impl: typeof streamChat): void {
  streamChatImpl = impl;
}
export function __resetStreamChatImplForTests(): void {
  streamChatImpl = streamChat;
}

/** Identifies this process as the owner of whatever runs it currently holds
 * a lease on — written to agentRun.workerId, purely informational (nothing
 * currently reads it back to route work), but gives a stale/orphaned run a
 * breadcrumb of which process it was left running in. */
const WORKER_ID = randomUUID();

/** How long a run's lease is valid without a renewed heartbeat before the
 * stale-run sweep (see scheduler.ts's checkStaleAgentRuns) considers the
 * owning process dead and recovers it. Must be comfortably longer than
 * HEARTBEAT_INTERVAL_MS so a single missed tick doesn't cause a false
 * positive. */
const LEASE_DURATION_MS = 90_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Aborts the in-flight model call for a run (best-effort — a no-op on the
 * abort itself if the run isn't live in this process) and always marks the
 * run/task cancelled in the DB so the UI reflects it immediately, even if
 * the run's owning process isn't this one (see AgentRunRecord.cancelRequestedAt). */
export async function cancelAgentRun(runId: string): Promise<AgentRunRecord> {
  activeRunControllers.get(runId)?.abort();

  const db = getDb();
  const run = await db.getAgentRun(runId);
  if (!run) throw new Error(`Unknown agent run: ${runId}`);

  const updated = await db.updateAgentRun(runId, {
    status: "cancelled",
    completedAt: new Date(),
    cancelRequestedAt: new Date(),
  });
  if (run.taskId) {
    const task = await db.getTask(run.taskId);
    if (task && task.status !== "completed" && task.status !== "cancelled") {
      await db.updateTask(run.taskId, {
        status: "cancelled",
        completedAt: new Date(),
      });
      await db.createTaskEvent({
        taskId: run.taskId,
        workspaceId: run.workspaceId,
        agentRunId: run.id,
        agentId: run.agentId,
        kind: "status_changed",
        message: "Run cancelled by user.",
        payload: { status: "cancelled" },
      });
    }
  }
  return updated;
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
      return JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function parseDelegationTasks(value: unknown): DelegationTask[] {
  if (!Array.isArray(value)) return [];
  const tasks: DelegationTask[] = [];
  for (const entry of value) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).agentId === "string" &&
      typeof (entry as Record<string, unknown>).instruction === "string"
    ) {
      tasks.push({
        agentId: (entry as { agentId: string }).agentId,
        instruction: (entry as { instruction: string }).instruction,
      });
    }
  }
  return tasks;
}

function toExecutionPlan(task: TaskRecord, raw: string): ExecutionPlan {
  const parsed = extractJsonObject(raw);
  const stringArray = (value: unknown, fallback: string[]) =>
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : fallback;
  return {
    goal: typeof parsed?.goal === "string" ? parsed.goal : `${task.title}: ${task.instruction}`,
    successCriteria: stringArray(parsed?.successCriteria, [
      "Return a concrete result for the requested task.",
    ]),
    steps: stringArray(parsed?.steps, [task.instruction]),
    neededCapabilities: stringArray(parsed?.neededCapabilities, []),
    delegationCandidates: stringArray(parsed?.delegationCandidates, []),
    delegationTasks: parseDelegationTasks(parsed?.delegationTasks),
    completionCheck:
      typeof parsed?.completionCheck === "string"
        ? parsed.completionCheck
        : "Verify the final result addresses the task instruction directly.",
  };
}

const TASK_QUESTION_POLICY_PROMPT =
  "You are running as a durable, mostly-unattended task. Only call ask_user_question when you are genuinely blocked by a critical, urgent gap — something destructive/irreversible, a missing credential, or directly conflicting instructions. For any ordinary ambiguity, decide yourself: pick the most reasonable interpretation, state the assumption plainly in your final answer, and keep working instead of stopping to ask. Never end your turn by announcing a plan and saying you're waiting for approval — there is no human watching this turn. If a step requires approval, the sensitive tool call itself defers automatically and tells you so; you don't need to, and must not, pause in prose to ask permission first. Once you've formed a plan, execute it immediately in the same turn using your tools and keep going until the task's success criteria are met or you hit a real blocker.";

async function buildSystemPrompt(agent: AgentRecord, forTask = false, modelId?: string) {
  const db = getDb();
  const [workspace, knowledgeBaseContext, modelParams] = await Promise.all([
    db.getWorkspace(agent.workspaceId),
    getKnowledgeBaseContextForPrompt(agent.workspaceId),
    modelId ? db.getModelParameter(agent.workspaceId, modelId) : Promise.resolve(null),
  ]);
  return composeSystemPrompt(
    workspace,
    agent.systemPrompt,
    knowledgeBaseContext,
    forTask ? TASK_QUESTION_POLICY_PROMPT : undefined,
    modelParams?.customInstructions,
  );
}

/** The model actually used for a task run — a task-level override takes
 * precedence over the assigned agent's default, so the same agent can run
 * different tasks against different models. */
function effectiveModelId(agent: AgentRecord, task: TaskRecord): string {
  return task.modelId ?? agent.modelId;
}

async function planTask(
  agent: AgentRecord,
  task: TaskRecord,
  budgetTracker: AutonomyBudgetTracker,
  instructionOverride?: string,
  abortSignal?: AbortSignal,
  workingDirectory?: string | null,
): Promise<ExecutionPlan> {
  const modelId = effectiveModelId(agent, task);
  // Autonomy Budgets v1 (see ./autonomy-budget.ts) — planning is a real
  // model call like any other; skip it (falling back to the same
  // best-effort plan toExecutionPlan already builds when parsing fails)
  // rather than spending against a budget that's already exhausted or
  // can't cover it.
  if (!checkModelCallCostBudget(budgetTracker, modelId, DEFAULT_MAX_OUTPUT_TOKENS).allowed) {
    return toExecutionPlan(task, "");
  }

  const installedProviders = await getInstalledProvidersForWorkspace(agent.workspaceId);
  const systemPrompt = await buildSystemPrompt(agent, true, modelId);
  const planningPrompt = [
    "Create a compact JSON execution plan for this task.",
    "Return JSON only with keys: goal, successCriteria, steps, neededCapabilities, delegationCandidates, delegationTasks, completionCheck.",
    "delegationTasks must be an array of {agentId, instruction} — one distinct, specific sub-instruction per delegate candidate you pick, decomposing the task instead of repeating it verbatim for every delegate.",
    `Task title: ${task.title}`,
    `Task instruction: ${buildTaskPrompt(task, instructionOverride)}`,
    agent.delegateAgentIds.length > 0
      ? `Delegate candidates available: ${agent.delegateAgentIds.join(", ")}`
      : "Delegate candidates available: none",
  ].join("\n");
  const result = streamChatImpl({
    modelId,
    systemPrompt,
    installedProviders,
    messages: [{ role: "user", content: planningPrompt }],
    abortSignal,
    cwd: workingDirectory ?? undefined,
    onFinish: ({ usage }) => recordModelCallCost(budgetTracker, modelId, usage),
  });
  const raw = await result.text;
  return toExecutionPlan(task, raw);
}

function buildTaskPrompt(task: TaskRecord, instructionOverride?: string): string {
  const base = task.instruction.trim();
  const override = instructionOverride?.trim();
  if (!override) return base;
  return ["Original task:", base, "", "Follow-up instruction:", override].join("\n");
}

/** Tool inputs/outputs can be arbitrarily large (whole file contents) — the
 * task-event timeline only needs enough to identify the call, not replay it. */
function truncateForEventPayload(value: unknown, limit = 2_000): string {
  let serialized: string;
  try {
    serialized = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    serialized = String(value);
  }
  return serialized.length > limit ? `${serialized.slice(0, limit)}…` : serialized;
}

/** Streams a chat completion while progressively persisting the growing
 * output onto the given agent run — so a task's "Agent runs" panel (which
 * just polls the row) shows the answer taking shape live instead of only
 * appearing once the whole run finishes. Throttled to avoid hammering the
 * DB on every token. Consumes `fullStream` rather than `textStream` so a
 * background run's tool calls land on the task-event timeline as
 * `tool_called` entries instead of vanishing (only chat streaming used to
 * surface them). Cancellation is the caller's concern: pass `abortSignal`
 * on `input` and it's forwarded to the model call as-is — this function
 * doesn't own a controller, so it stays consistent with the single
 * per-run controller `executeManagedTask` registers in
 * `activeRunControllers`. */
async function streamWithLiveUpdates(
  input: Parameters<typeof streamChat>[0],
  runId: string,
  eventContext?: { taskId: string; workspaceId: string; agentId: string },
): Promise<{ text: string; toolStepCount: number }> {
  const db = getDb();
  const result = streamChatImpl(input);
  let acc = "";
  let toolStepCount = 0;
  let lastFlush = 0;
  const FLUSH_INTERVAL_MS = 400;

  async function recordToolEvent(
    kind: "tool_called" | "failed",
    message: string,
    payload: Record<string, unknown>,
  ) {
    if (!eventContext) return;
    await db
      .createTaskEvent({
        taskId: eventContext.taskId,
        workspaceId: eventContext.workspaceId,
        agentRunId: runId,
        agentId: eventContext.agentId,
        kind,
        message,
        payload,
      })
      .catch(() => {});
  }

  for await (const part of result.fullStream) {
    switch (part.type) {
      case "text-delta": {
        acc += part.text;
        const now = Date.now();
        if (now - lastFlush >= FLUSH_INTERVAL_MS) {
          lastFlush = now;
          await db.updateAgentRun(runId, { finalOutput: acc }).catch(() => {});
        }
        break;
      }
      case "tool-call":
        toolStepCount++;
        await recordToolEvent("tool_called", `Tool ${part.toolName} aufgerufen.`, {
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          // Redacted before truncation (not after) — a secret-shaped key
          // near the end of a long input would otherwise still leak in the
          // truncated preview. Task events are visible in the task timeline
          // UI, same leak surface as the audit log (see audit.ts).
          input: truncateForEventPayload(sanitizeForAudit(part.input)),
        });
        break;
      case "tool-error":
        await recordToolEvent("failed", `Tool ${part.toolName} fehlgeschlagen.`, {
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          error: truncateForEventPayload(
            sanitizeForAudit(part.error instanceof Error ? part.error.message : part.error),
          ),
        });
        break;
      case "error":
        // A mid-stream provider failure (rate limit, insufficient credits,
        // etc.) arrives as this part rather than a thrown exception —
        // without rethrowing, the loop would finish "normally" with
        // whatever partial text it had (often none), and the task would be
        // marked completed instead of failed with the real reason. Callers
        // of executeManagedTask already catch thrown errors and record them
        // as task.errorMessage.
        throw part.error;
      default:
        break;
    }
  }
  return { text: acc, toolStepCount };
}

async function runDirectExecution(
  agent: AgentRecord,
  task: TaskRecord,
  run: AgentRunRecord,
  budgetTracker: AutonomyBudgetTracker,
  instructionOverride?: string,
  abortSignal?: AbortSignal,
  workingDirectory?: string | null,
  outcomeSignal?: RunOutcomeSignal,
  delegationDepth = 0,
  delegationChain: string[] = [],
): Promise<{ text: string; toolStepCount: number; budgetBlockedReason: string | null }> {
  const modelId = effectiveModelId(agent, task);
  const modelParams = await getDb().getModelParameter(agent.workspaceId, modelId);
  const maxOutputTokens = modelParams?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  // Autonomy Budgets v1 (see ./autonomy-budget.ts) — checked before this
  // call is made (not just after, via checkAndConsumeRunBudget's tool-call
  // boundary check), so a run whose cost budget can't cover even the
  // planned model call never spends against it in the first place.
  if (!checkModelCallCostBudget(budgetTracker, modelId, maxOutputTokens).allowed) {
    return { text: "", toolStepCount: 0, budgetBlockedReason: budgetTracker.blockedReason };
  }

  const installedProviders = await getInstalledProvidersForWorkspace(agent.workspaceId);
  const systemPrompt = await buildSystemPrompt(agent, true, modelId);
  // Models with no tool-use-capable endpoint (e.g. OpenRouter image
  // generation models) 404 outright if a tools array is sent at all.
  const modelCapabilities = await getModelCapabilities(modelId, installedProviders);
  const tools = modelCapabilities.toolCalling
    ? await buildToolsForAgent(agent, {
        taskId: task.id,
        agentRunId: run.id,
        chatToolPolicy: toolPolicyForAutonomyLevel(agent.autonomyLevel),
        budgetTracker,
        outcomeSignal,
        delegationDepth,
        delegationChain,
      })
    : undefined;
  const result = await streamWithLiveUpdates(
    {
      modelId,
      systemPrompt,
      installedProviders,
      tools,
      abortSignal,
      cwd: workingDirectory ?? undefined,
      // Unattended runs have no human to catch a shallow answer — let the
      // model think before acting where the provider supports it.
      reasoningEffort: modelParams?.reasoningEffort ?? "medium",
      maxOutputTokens: modelParams?.maxOutputTokens ?? undefined,
      temperature: modelParams?.temperature ?? undefined,
      topP: modelParams?.topP ?? undefined,
      frequencyPenalty: modelParams?.frequencyPenalty ?? undefined,
      presencePenalty: modelParams?.presencePenalty ?? undefined,
      stopSequences: modelParams?.stopSequences,
      // claude_cli/codex_cli-backed agents map this straight to the spawned
      // CLI's own --permission-mode flag (see model-providers/cli.ts):
      // anything but "auto" spawns Claude Code in "plan" mode, which can
      // only propose edits and stops waiting for a human to approve the
      // plan — a human who never arrives on an unattended task run. Without
      // this, a "super_agent"/"autonomous" agent would still get silently
      // stuck presenting a plan instead of applying it.
      toolMode: toolPolicyForAutonomyLevel(agent.autonomyLevel).mode,
      messages: [{ role: "user", content: buildTaskPrompt(task, instructionOverride) }],
      onFinish: ({ usage }) => recordModelCallCost(budgetTracker, modelId, usage),
    },
    run.id,
    { taskId: task.id, workspaceId: task.workspaceId, agentId: agent.id },
  );
  return { ...result, budgetBlockedReason: budgetTracker.blockedReason };
}

export async function executeManagedTask(input: {
  taskId: string;
  agent: AgentRecord;
  trigger: "task" | "automation" | "delegate" | "chat" | "extension";
  chatId?: string | null;
  automationId?: string | null;
  instructionOverride?: string;
  workingDirectory?: string | null;
  /** Super-agent delegation depth/ancestor-chain (see core-agent-engine's
   * delegation-policy.ts) — 0/empty for a top-level run. Both delegation
   * paths (delegation.ts's delegate_to_agent tool, and this file's own
   * planner-driven auto-delegation branch) pass depth + 1 / chain +
   * [parent.id] when recursing into a delegate's own run. */
  delegationDepth?: number;
  delegationChain?: string[];
}): Promise<{ task: TaskRecord; run: AgentRunRecord; output: string }> {
  const db = getDb();
  const task = await db.getTask(input.taskId);
  if (!task) throw new Error(`Unknown task: ${input.taskId}`);

  const startedAt = new Date();
  const run = await db.createAgentRun({
    workspaceId: task.workspaceId,
    taskId: task.id,
    agentId: input.agent.id,
    chatId: input.chatId ?? null,
    automationId: input.automationId ?? null,
    trigger: input.trigger,
    modelId: effectiveModelId(input.agent, task),
    status: "running",
    startedAt,
    workerId: WORKER_ID,
    heartbeatAt: startedAt,
    leaseUntil: new Date(startedAt.getTime() + LEASE_DURATION_MS),
  });
  await emitNyxelEvent({
    workspaceId: task.workspaceId,
    type: NyxelEvent.AgentRunStarted,
    entityType: "agent_run",
    entityId: run.id,
    payload: { taskId: task.id, agentId: input.agent.id, trigger: input.trigger },
  });

  const controller = new AbortController();
  activeRunControllers.set(run.id, controller);

  // Renews the run's lease periodically so the stale-run sweep
  // (scheduler.ts's checkStaleAgentRuns) doesn't mistake a genuinely
  // in-progress run for one whose owning process died. Also the DB-visible
  // fallback for cross-process cancellation: if this run were ever picked
  // up by another process's cancelAgentRun call (cancelRequestedAt set
  // without this process's activeRunControllers entry being reachable),
  // the next heartbeat tick notices and aborts locally too.
  const heartbeatTimer = setInterval(() => {
    void (async () => {
      const current = await db.getAgentRun(run.id).catch(() => null);
      if (current?.cancelRequestedAt && !controller.signal.aborted) {
        controller.abort();
        return;
      }
      await db
        .updateAgentRun(run.id, {
          heartbeatAt: new Date(),
          leaseUntil: new Date(Date.now() + LEASE_DURATION_MS),
        })
        .catch(() => {});
    })();
  }, HEARTBEAT_INTERVAL_MS);
  if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();

  // Autonomy Budgets v1 (see ./autonomy-budget.ts) — the tool-call-boundary
  // runtime check inside buildToolsForAgent only fires between tool calls,
  // so a run that never calls a tool (or sits inside one very long model
  // call) would otherwise ignore maxRuntimeMinutes entirely. This hard
  // timeout owns the same AbortController "Stop agent" already uses, so a
  // budget timeout is indistinguishable from a clean stop from the model's
  // perspective — no crash, just an aborted stream. The DB is updated
  // *before* aborting so the catch block below (which re-reads task/run
  // once aborted) picks up the budget-specific status/message rather than a
  // generic cancellation.
  let budgetTimeout: ReturnType<typeof setTimeout> | undefined;
  const budget = resolveAutonomyBudget(input.agent);
  if (budget.maxRuntimeMinutes != null && budget.maxRuntimeMinutes > 0) {
    budgetTimeout = setTimeout(() => {
      void (async () => {
        const reason = `Autonomy budget exceeded: max runtime of ${budget.maxRuntimeMinutes} minute(s) per run.`;
        await db
          .updateAgentRun(run.id, {
            status: "failed",
            errorMessage: reason,
            completedAt: new Date(),
          })
          .catch(() => {});
        await db.updateTask(task.id, { status: "blocked", errorMessage: reason }).catch(() => {});
        await db
          .createTaskEvent({
            taskId: task.id,
            workspaceId: task.workspaceId,
            agentRunId: run.id,
            agentId: input.agent.id,
            kind: "failed",
            message: reason,
          })
          .catch(() => {});
        controller.abort();
      })();
    }, budget.maxRuntimeMinutes * 60_000);
  }

  try {
    // Durable execution: a thrown error from runManagedTask (a real provider
    // failure, not a budget pause or a user-visible tool error, both of
    // which are handled inside runManagedTask itself) retries in place —
    // same task/run rows, same AbortController — up to maxRetries times
    // when the failure looks transient, with backoff between attempts.
    // Retries exhausted (or a non-transient error) land the run in a
    // terminal state here unconditionally, rather than leaving that to
    // whichever caller happens to catch the rethrown error (previously only
    // scheduler.ts's automation path did this, so a chat- or delegate-
    // triggered failure could leave the run stuck at "running" until the
    // stale-run sweep eventually noticed the expired lease).
    for (let attempt = 0; ; attempt++) {
      try {
        return await runManagedTask(input, task, run, controller.signal);
      } catch (err) {
        if (controller.signal.aborted) {
          const cancelledTask = (await db.getTask(task.id)) ?? task;
          const cancelledRun = (await db.getAgentRun(run.id)) ?? run;
          return {
            task: cancelledTask,
            run: cancelledRun,
            output: cancelledRun.finalOutput ?? "",
          };
        }

        const message = err instanceof Error ? err.message : String(err);
        const transient = isTransientRunError(err);
        const maxRetries = run.maxRetries ?? DEFAULT_MAX_TRANSIENT_RETRIES;
        if (transient && attempt < maxRetries) {
          const delay = retryBackoffMs(attempt);
          const nextRetryAt = new Date(Date.now() + delay);
          await db
            .updateAgentRun(run.id, {
              retryCount: attempt + 1,
              nextRetryAt,
              errorMessage: `Transient failure (attempt ${attempt + 1}/${maxRetries}): ${message}`,
            })
            .catch(() => {});
          await db
            .createTaskEvent({
              taskId: task.id,
              workspaceId: task.workspaceId,
              agentRunId: run.id,
              agentId: input.agent.id,
              kind: "status_changed",
              message: `Transient failure — retrying (attempt ${attempt + 1}/${maxRetries}): ${message}`,
              payload: { retryCount: attempt + 1, maxRetries, nextRetryAt },
            })
            .catch(() => {});
          await sleep(delay);
          continue;
        }

        const terminalStatus = transient ? ("dead_letter" as const) : ("failed" as const);
        await db
          .updateAgentRun(run.id, {
            status: terminalStatus,
            errorMessage: message,
            completedAt: new Date(),
          })
          .catch(() => {});
        await db
          .updateTask(task.id, {
            status: "failed",
            errorMessage: message,
            completedAt: new Date(),
          })
          .catch(() => {});
        await db
          .createTaskEvent({
            taskId: task.id,
            workspaceId: task.workspaceId,
            agentRunId: run.id,
            agentId: input.agent.id,
            kind: "failed",
            message:
              transient && attempt > 0
                ? `Run moved to dead-letter after ${attempt} retr${attempt === 1 ? "y" : "ies"}: ${message}`
                : `Run failed: ${message}`,
          })
          .catch(() => {});
        await emitNyxelEvent({
          workspaceId: task.workspaceId,
          type: NyxelEvent.AgentRunFailed,
          entityType: "agent_run",
          entityId: run.id,
          payload: { taskId: task.id, agentId: input.agent.id, error: message },
        });
        throw err;
      }
    }
  } finally {
    if (budgetTimeout) clearTimeout(budgetTimeout);
    clearInterval(heartbeatTimer);
    activeRunControllers.delete(run.id);
  }
}

async function runManagedTask(
  input: {
    taskId: string;
    agent: AgentRecord;
    trigger: "task" | "automation" | "delegate" | "chat" | "extension";
    chatId?: string | null;
    automationId?: string | null;
    instructionOverride?: string;
    workingDirectory?: string | null;
    delegationDepth?: number;
    delegationChain?: string[];
  },
  task: TaskRecord,
  run: AgentRunRecord,
  abortSignal: AbortSignal,
): Promise<{ task: TaskRecord; run: AgentRunRecord; output: string }> {
  const db = getDb();
  const delegationDepth = input.delegationDepth ?? 0;
  const delegationChain = input.delegationChain ?? [];

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
  // Autonomy Budgets v1 (see ./autonomy-budget.ts) — one tracker for the
  // whole run, shared across planning, direct execution/tool calls, and a
  // super-agent's synthesis call, so a cost budget is judged against total
  // spend across every model call the run makes, not reset per call.
  const budgetTracker = createAutonomyBudgetTracker(resolveAutonomyBudget(input.agent));
  const plan = await planTask(
    input.agent,
    activeTask,
    budgetTracker,
    input.instructionOverride,
    abortSignal,
    input.workingDirectory,
  );
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
  let toolStepCount = 0;
  // Autonomy Budgets v1 — set from the shared `budgetTracker` after either
  // branch below: direct execution's own tool calls, or (for a super-agent)
  // the synthesis call's cost preflight. Each delegated child task tracks
  // its own budget independently via its own executeManagedTask call, so a
  // delegate exceeding its own budget doesn't directly set this one.
  let budgetBlockedReason: string | null = null;
  // Populated only by the direct-execution branch below (synthesis never
  // exposes ask_user_question/sensitive tools to the model, so it cannot
  // itself produce a question/approval pause) — read back via
  // resolveRunOutcome once execution finishes, in place of the previous
  // `output.includes("pending_question" | "pending_approval")` text-marker
  // checks.
  let directExecutionOutcomeSignal: RunOutcomeSignal | null = null;

  const canAutoDelegate =
    input.agent.autonomyLevel === "super_agent" &&
    input.agent.delegateAgentIds.length > 0 &&
    plan.delegationCandidates.length > 0 &&
    canDelegateDeeper(delegationDepth);

  // Structured, per-child delegation summary — persisted onto the parent
  // task's own `plan` field below so its full delegation outcome (which
  // children ran, whether each succeeded) survives in one place without
  // needing to join out to every child task row.
  const delegationResults: {
    agentId: string;
    taskId: string;
    status: "success" | "failed";
    resultSummary?: string;
    error?: string;
  }[] = [];

  if (canAutoDelegate) {
    // Every delegate candidate the planner picked gets its own child task
    // and runs concurrently instead of one after another — they're
    // independent sub-agents working on independent sub-tasks, so there's
    // no reason to serialize them. A failure in one delegate doesn't stop
    // the others; it just shows up as a shorter/failed contribution to the
    // synthesis step below. Candidates already in this run's own delegation
    // chain are dropped (cycle protection) even if still on the whitelist.
    const candidateAgentIds = filterCyclicCandidates(
      plan.delegationCandidates.filter((id) => input.agent.delegateAgentIds.includes(id)),
      delegationChain,
    );
    const settled = await Promise.allSettled(
      candidateAgentIds.map(async (delegateAgentId) => {
        const delegateAgent = await db.getAgent(delegateAgentId);
        if (!delegateAgent) return null;
        // A distinct sub-instruction per delegate when the planner provided
        // one (see ExecutionPlan.delegationTasks); falls back to the parent
        // task's own instruction verbatim only when the plan didn't cover
        // this candidate, matching pre-existing behavior.
        const childInstruction =
          plan.delegationTasks.find((d) => d.agentId === delegateAgentId)?.instruction ??
          task.instruction;
        const childTask = await db.createTask({
          workspaceId: task.workspaceId,
          parentTaskId: task.id,
          createdByAgentId: input.agent.id,
          assignedAgentId: delegateAgent.id,
          title: `${task.title} · ${delegateAgent.name}`,
          instruction: childInstruction,
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
          delegationDepth: delegationDepth + 1,
          delegationChain: [...delegationChain, input.agent.id],
        });
        return {
          agentId: delegateAgent.id,
          taskId: childTask.id,
          resultSummary: childResult.output,
        };
      }),
    );
    const children: { agentId: string; resultSummary: string }[] = [];
    for (const [index, outcome] of settled.entries()) {
      if (outcome.status === "fulfilled") {
        if (outcome.value) {
          children.push(outcome.value);
          delegationResults.push({
            agentId: outcome.value.agentId,
            taskId: outcome.value.taskId,
            status: "success",
            resultSummary: outcome.value.resultSummary.slice(0, 4000),
          });
        }
        continue;
      }
      const failedAgentId = candidateAgentIds[index];
      const message =
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      await db.createTaskEvent({
        taskId: task.id,
        workspaceId: task.workspaceId,
        agentRunId: run.id,
        agentId: input.agent.id,
        kind: "failed",
        message: `Delegated task failed: ${message}`,
        payload: { delegateAgentId: failedAgentId, error: message },
      });
      if (failedAgentId) {
        delegationResults.push({
          agentId: failedAgentId,
          taskId: "",
          status: "failed",
          error: message,
        });
      }
    }

    const synthesisModelId = effectiveModelId(input.agent, task);
    const synthesisCostCheck = checkModelCallCostBudget(
      budgetTracker,
      synthesisModelId,
      DEFAULT_MAX_OUTPUT_TOKENS,
    );
    if (!synthesisCostCheck.allowed) {
      output = "";
      budgetBlockedReason = budgetTracker.blockedReason;
    } else {
      const synthesisPrompt = [
        "Merge the delegated task results into one final response.",
        `Original task: ${buildTaskPrompt(task, input.instructionOverride)}`,
        "Delegated outputs:",
        ...children.map((child) => `- ${child.agentId}: ${child.resultSummary.slice(0, 4000)}`),
      ].join("\n");
      const installedProviders = await getInstalledProvidersForWorkspace(input.agent.workspaceId);
      const systemPrompt = await buildSystemPrompt(input.agent, true);
      const synthesis = await streamWithLiveUpdates(
        {
          modelId: synthesisModelId,
          systemPrompt,
          installedProviders,
          reasoningEffort: "medium",
          messages: [{ role: "user", content: synthesisPrompt }],
          abortSignal,
          onFinish: ({ usage }) => recordModelCallCost(budgetTracker, synthesisModelId, usage),
        },
        run.id,
      );
      output = synthesis.text;
      budgetBlockedReason = budgetTracker.blockedReason;

      // Verifier step (best-effort, never blocks completion): one short
      // extra model call checking whether the synthesized answer actually
      // satisfies the plan's own completion check. A "not verified" result
      // is surfaced on the task timeline for a human to notice, not treated
      // as a failure — an automated verifier is itself fallible, and a
      // durable/unattended run has no one to escalate a false negative to.
      if (output && checkModelCallCostBudget(budgetTracker, synthesisModelId, 200).allowed) {
        try {
          const verifyPrompt = [
            `Completion check: ${plan.completionCheck}`,
            `Final answer: ${output.slice(0, 4000)}`,
            "Does the final answer satisfy the completion check? Reply with exactly one line: VERIFIED or NOT_VERIFIED, followed by a one-sentence reason.",
          ].join("\n");
          const verification = await streamChatImpl({
            modelId: synthesisModelId,
            installedProviders: await getInstalledProvidersForWorkspace(input.agent.workspaceId),
            messages: [{ role: "user", content: verifyPrompt }],
            abortSignal,
            maxOutputTokens: 200,
            onFinish: ({ usage }) => recordModelCallCost(budgetTracker, synthesisModelId, usage),
          }).text;
          await db.createTaskEvent({
            taskId: task.id,
            workspaceId: task.workspaceId,
            agentRunId: run.id,
            agentId: input.agent.id,
            kind: "status_changed",
            message: `Verifier: ${verification.trim().slice(0, 500)}`,
            payload: { verified: /^VERIFIED/i.test(verification.trim()) },
          });
        } catch {
          // Best-effort — a verifier failure must never fail the run itself.
        }
      }
    }
  } else {
    const outcomeSignal = createRunOutcomeSignal();
    const execution = await runDirectExecution(
      input.agent,
      task,
      run,
      budgetTracker,
      input.instructionOverride,
      abortSignal,
      input.workingDirectory,
      outcomeSignal,
      delegationDepth,
      delegationChain,
    );
    output = execution.text;
    toolStepCount = execution.toolStepCount;
    budgetBlockedReason = execution.budgetBlockedReason;
    directExecutionOutcomeSignal = outcomeSignal;
  }

  // Typed pause detection (replaces `output.includes("pending_question" |
  // "pending_approval")` text-marker checks) — the outcome signal records a
  // pause directly at the moment a tool defers, and the budget reason is
  // already structured (AutonomyBudgetTracker.blockedReason), so neither
  // depends on the model's own final text ever echoing a literal string
  // back.
  const runOutcome = resolveRunOutcome(
    directExecutionOutcomeSignal ?? createRunOutcomeSignal(),
    budgetBlockedReason,
  );
  const pausedOnQuestion = runOutcome.pauseReason?.kind === "question";
  const pausedOnApproval = runOutcome.pauseReason?.kind === "approval";
  const pausedOnBudget = runOutcome.pauseReason?.kind === "budget";
  const isPaused = runOutcome.paused;
  // AgentRunStatus has no "blocked" state (a question-pause is still an
  // agent run that's technically waiting on the human) — only TaskStatus
  // distinguishes "blocked" (question or budget) from "waiting_approval"
  // (tool approval).
  const taskStatus =
    pausedOnQuestion || pausedOnBudget
      ? ("blocked" as const)
      : pausedOnApproval
        ? ("waiting_approval" as const)
        : ("completed" as const);

  // A concurrent cancelAgentRun (or the budget-runtime timeout) may have
  // already landed this run in a terminal status while the stream above was
  // still finishing up — don't let this completion write stomp that back to
  // "waiting_approval"/"completed" (see core-agent-engine's run-transitions.ts).
  const preWriteRun = await db.getAgentRun(run.id);
  if (preWriteRun && isTerminalAgentRunStatus(preWriteRun.status)) {
    const currentTask = (await db.getTask(task.id)) ?? task;
    return { task: currentTask, run: preWriteRun, output: preWriteRun.finalOutput ?? output };
  }

  run = await db.updateAgentRun(run.id, {
    status: isPaused ? "waiting_approval" : "completed",
    finalOutput: output,
    completedAt: isPaused ? null : new Date(),
    // Real tool calls when the run made any; the plan length otherwise.
    stepCount: Math.max(1, toolStepCount || plan.steps.length),
  });
  const finalTask = await db.updateTask(task.id, {
    status: taskStatus,
    resultSummary: output,
    completedAt: isPaused ? null : new Date(),
    ...(pausedOnBudget ? { errorMessage: `Autonomy budget exceeded: ${budgetBlockedReason}` } : {}),
    ...(delegationResults.length > 0
      ? { plan: { ...(plan as unknown as Record<string, unknown>), delegationResults } }
      : {}),
  });
  await db.createTaskEvent({
    taskId: task.id,
    workspaceId: task.workspaceId,
    agentRunId: run.id,
    agentId: input.agent.id,
    kind:
      pausedOnQuestion || pausedOnBudget
        ? "status_changed"
        : pausedOnApproval
          ? "approval_waiting"
          : "completed",
    message: pausedOnQuestion
      ? "Run paused pending the user's answer."
      : pausedOnApproval
        ? "Run paused pending approval."
        : pausedOnBudget
          ? `Run paused: autonomy budget exceeded (${budgetBlockedReason}).`
          : "Run completed.",
  });
  if (!isPaused) {
    await emitNyxelEvent({
      workspaceId: task.workspaceId,
      type: NyxelEvent.AgentRunCompleted,
      entityType: "agent_run",
      entityId: run.id,
      payload: { taskId: task.id, agentId: input.agent.id, stepCount: run.stepCount },
    });
  }

  // pausedOnApproval already notified when the approval was created
  // (tools.ts) — only question-pauses, budget-pauses, and real completions
  // need one here.
  if (pausedOnQuestion) {
    await notifyWorkspaceOwner(task.workspaceId, {
      title: "Agent has a question",
      body: `${input.agent.name} needs input on "${task.title}"`,
      url: `/workspace/${task.workspaceId}/tasks/${task.id}`,
      tag: `task-${task.id}`,
    });
  } else if (pausedOnBudget) {
    await notifyWorkspaceOwner(task.workspaceId, {
      title: "Agent hit its autonomy budget",
      body: `${input.agent.name} paused on "${task.title}": ${budgetBlockedReason}`,
      url: `/workspace/${task.workspaceId}/tasks/${task.id}`,
      tag: `task-${task.id}`,
    });
  } else if (taskStatus === "completed") {
    await notifyWorkspaceOwner(task.workspaceId, {
      title: "Task completed",
      body: task.title,
      url: `/workspace/${task.workspaceId}/tasks/${task.id}`,
      tag: `task-${task.id}`,
    });
  }

  return { task: finalTask, run, output };
}

export async function startTaskExecutionIfIdle(input: {
  taskId: string;
  trigger: "task" | "automation" | "delegate" | "chat" | "extension";
  chatId?: string | null;
  automationId?: string | null;
  instructionOverride?: string;
  workingDirectory?: string | null;
}): Promise<{ task: TaskRecord; run: AgentRunRecord; output: string } | null> {
  const db = getDb();
  const task = await db.getTask(input.taskId);
  if (!task?.assignedAgentId) return null;
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
    workingDirectory: input.workingDirectory,
  });
}
