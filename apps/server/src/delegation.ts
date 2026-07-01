import { getDb } from "@nyxel/db";
import { type Tool, tool } from "ai";
import { z } from "zod";
import { executeManagedTask } from "./agent-runtime";
import { logAudit } from "./audit";
import type { AgentRunContext } from "./tools";

/**
 * Builds the delegate_to_agent tool for a super-agent (ADR-0011). Restricted
 * to the whitelist the user configured on the agent
 * (`agent.delegateAgentIds`) — there is no open-ended "call any agent",
 * consistent with the "nothing should silently gain more permissions than
 * the user allowed" principle (ARCHITECTURE.md section 1).
 *
 * Delegation runs the sub-agent headlessly (one full completion, no
 * streaming back to the parent's stream) and hands its own tools back with
 * `allowDelegation: false` — a super-agent's delegate can't itself delegate,
 * which is what keeps this a tree instead of a graph that could cycle back
 * to the original caller.
 */
export async function buildDelegateToAgentTool(
  parent: { id: string; workspaceId: string; delegateAgentIds: string[] },
  ctx: AgentRunContext,
): Promise<Tool | null> {
  const db = getDb();
  const candidates = (
    await Promise.all(parent.delegateAgentIds.map((id) => db.getAgent(id)))
  ).filter(
    (a): a is NonNullable<typeof a> =>
      a !== null && a.workspaceId === parent.workspaceId && a.id !== parent.id,
  );

  if (candidates.length === 0) return null;

  const idEnum = candidates.map((a) => a.id) as [string, ...string[]];
  const labelById = new Map(candidates.map((a) => [a.id, a.name]));

  return tool({
    description: `Delegates a subtask to one of this workspace's other configured agents: ${candidates
      .map((a) => `"${a.name}" (id: ${a.id})`)
      .join(
        ", ",
      )}. Use this to break a complex request into subtasks handled by specialized agents. Independent delegations run concurrently, not one after another.`,
    inputSchema: z.object({
      agentId: z.enum(idEnum).describe("Which agent to delegate to."),
      task: z.string().describe("The subtask instruction for that agent."),
      modelId: z
        .string()
        .optional()
        .describe(
          "Optional — run this subtask on a specific model instead of the delegate agent's default (e.g. a cheaper/faster model for a simple subtask, or a stronger one for a hard one).",
        ),
    }),
    execute: async ({ agentId, task, modelId }) => {
      const subAgent = candidates.find((a) => a.id === agentId);
      if (!subAgent) throw new Error(`"${agentId}" is not in this agent's delegate whitelist.`);

      try {
        const childTask = await db.createTask({
          workspaceId: parent.workspaceId,
          parentTaskId: ctx.taskId ?? null,
          createdByAgentId: parent.id,
          assignedAgentId: subAgent.id,
          title: `Delegated task · ${subAgent.name}`,
          instruction: task,
          modelId: modelId ?? null,
          status: "ready",
          input: { delegatedBy: parent.id },
        });
        const result = await executeManagedTask({
          taskId: childTask.id,
          agent: subAgent,
          trigger: "delegate",
        });
        const text = result.output;

        await logAudit({
          workspaceId: parent.workspaceId,
          agentId: parent.id,
          chatId: ctx.chatId,
          automationId: ctx.automationId,
          actor: "delegate",
          toolLabel: `delegate__${subAgent.name}`,
          input: { agentId, task },
          output: text,
          status: "success",
        });

        return {
          agentId,
          agentName: subAgent.name,
          taskId: childTask.id,
          result: text,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await logAudit({
          workspaceId: parent.workspaceId,
          agentId: parent.id,
          chatId: ctx.chatId,
          automationId: ctx.automationId,
          actor: "delegate",
          toolLabel: `delegate__${labelById.get(agentId) ?? agentId}`,
          input: { agentId, task },
          output: { error: message },
          status: "error",
        });
        throw err;
      }
    },
  });
}
