import { getDb } from "@nyxel/db";
import { type Tool, tool } from "ai";
import { z } from "zod";
import { logAudit } from "./audit";
import type { AgentRunContext } from "./tools";
import { runWorkflowAndWait } from "./workflow-runner";

/**
 * Builds the run_workflow tool — the agent-side counterpart to the
 * workflow builder's "agent" node (workflow-runner.ts's runAgentNode).
 * Together they let the two systems call into each other instead of
 * staying siloed: a workflow step can hand off to an agent, and an agent
 * can kick off one of the workspace's media-generation pipelines and use
 * its result. Scoped to the calling agent's workspace — no cross-workspace
 * workflow ids, same boundary buildDelegateToAgentTool enforces for agents.
 * Runs synchronously (waits for the whole graph) since the model needs the
 * result to keep reasoning, unlike the builder's fire-and-forget Run button.
 */
export async function buildRunWorkflowTool(
  agent: { id: string; workspaceId: string },
  ctx: AgentRunContext,
): Promise<Tool | null> {
  const db = getDb();
  const workflows = await db.listWorkflowsByWorkspace(agent.workspaceId);
  if (workflows.length === 0) return null;

  const idEnum = workflows.map((w) => w.id) as [string, ...string[]];
  const labelById = new Map(workflows.map((w) => [w.id, w.name]));

  return tool({
    description: `Runs one of this workspace's saved workflows to completion and returns its result: ${workflows
      .map((w) => `"${w.name}" (id: ${w.id})`)
      .join(
        ", ",
      )}. Use this to trigger an existing media-generation or multi-step pipeline instead of trying to replicate its steps yourself.`,
    inputSchema: z.object({
      workflowId: z.enum(idEnum).describe("Which workflow to run."),
    }),
    execute: async ({ workflowId }) => {
      const workflowName = labelById.get(workflowId) ?? workflowId;
      try {
        const { run, nodes } = await runWorkflowAndWait(workflowId, agent.workspaceId);
        const summary = {
          runId: run.id,
          status: run.status,
          errorMessage: run.errorMessage,
          nodes: nodes.map((n) => ({
            nodeId: n.nodeId,
            status: n.status,
            libraryFileId: n.libraryFileId,
            errorMessage: n.errorMessage,
          })),
        };
        await logAudit({
          workspaceId: agent.workspaceId,
          agentId: agent.id,
          chatId: ctx.chatId,
          automationId: ctx.automationId,
          actor: ctx.automationId ? "automation" : "chat",
          toolLabel: `run_workflow__${workflowName}`,
          input: { workflowId },
          output: summary,
          status: run.status === "failed" ? "error" : "success",
        });
        return summary;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await logAudit({
          workspaceId: agent.workspaceId,
          agentId: agent.id,
          chatId: ctx.chatId,
          automationId: ctx.automationId,
          actor: ctx.automationId ? "automation" : "chat",
          toolLabel: `run_workflow__${workflowName}`,
          input: { workflowId },
          output: { error: message },
          status: "error",
        });
        throw err;
      }
    },
  });
}
