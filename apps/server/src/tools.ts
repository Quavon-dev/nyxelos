import type { AgentRecord, ChatToolPolicy, SkillKind } from "@nyxel/db";
import { DEFAULT_CHAT_TOOL_POLICY, getDb } from "@nyxel/db";
import { createSkillContext } from "@nyxel/skills-sdk";
import { dynamicTool, jsonSchema, type ToolSet, tool } from "ai";
import { logAudit } from "./audit";
import { buildDelegateToAgentTool } from "./delegation";
import { ensureMcpServerConnected, mcpManager } from "./mcp-runtime";
import { resolveSkillDefinition } from "./skills-resolve";

export interface AgentRunContext {
  /** Set when this run is a live chat turn. */
  chatId?: string;
  /** Per-chat tool execution policy, loaded from the chat row. */
  chatToolPolicy?: ChatToolPolicy;
  /** Set when this run is an unattended scheduled run. See ADR-0010. */
  automationId?: string;
  /**
   * Whether this agent is allowed to expose delegate_to_agent. Defaults to
   * true; set to false when building tools for a *delegated* sub-agent
   * invocation, so a chain of super-agents can't delegate to each other in
   * a cycle. See ADR-0011.
   */
  allowDelegation?: boolean;
}

function actorFor(ctx: AgentRunContext): "chat" | "automation" {
  return ctx.automationId ? "automation" : "chat";
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

function classifyBuiltinSkillKind(skillId: string): SkillKind | null {
  switch (skillId) {
    case "workspace_file_read":
      return "file_read";
    case "workspace_file_list":
      return "file_list";
    case "workspace_file_write":
    case "write_note":
      return "file_write";
    case "workspace_file_delete":
      return "file_delete";
    default:
      return null;
  }
}

function normalizeChatToolPolicy(policy: ChatToolPolicy | undefined): ChatToolPolicy {
  return policy ?? DEFAULT_CHAT_TOOL_POLICY;
}

export function shouldDeferToolForApproval(
  target:
    | { kind: "mcp" }
    | { kind: "skill"; sensitive: boolean; skillKind: SkillKind | null },
  policy: ChatToolPolicy | undefined,
): boolean {
  const effectivePolicy = normalizeChatToolPolicy(policy);
  if (target.kind === "mcp") {
    return effectivePolicy.mode === "default" ? true : effectivePolicy.approveMcpTools;
  }

  if (!target.sensitive) return false;
  if (effectivePolicy.mode === "default") return true;

  switch (target.skillKind) {
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
 * assigned skills (packages/skills-sdk), tools from its assigned, connected
 * MCP servers (packages/mcp-client), and — for super-agents — a
 * delegate_to_agent tool. Sensitive actions (skill.sensitive === true; every
 * MCP tool, since their side effects aren't declared) are deferred for
 * approval instead of executed immediately (ADR-0009). Unknown/removed
 * skills and unreachable MCP servers are skipped rather than failing the
 * whole run — a partially-degraded tool set is better than no response at
 * all. See ARCHITECTURE.md sections 6 and 8.
 */
export async function buildToolsForAgent(
  agent: AgentRecord,
  ctx: AgentRunContext = {},
): Promise<ToolSet> {
  const tools: ToolSet = {};
  const db = getDb();
  const actor = actorFor(ctx);

  for (const skillId of agent.skillIds) {
    // Checks the process-wide hand-written registry first, then this
    // workspace's DB-backed dynamic skills (Skills tab) — see
    // apps/server/src/skills-resolve.ts and ADR-0013.
    const skill = await resolveSkillDefinition(agent.workspaceId, skillId);
    if (!skill) continue;
    tools[skill.id] = tool({
      description: skill.description,
      inputSchema: skill.inputSchema,
      execute: async (input) => {
        const skillRecord = await db.getSkill(skill.id);
        const skillKind = skillRecord?.kind ?? classifyBuiltinSkillKind(skill.id);
        if (
          shouldDeferToolForApproval(
            { kind: "skill", sensitive: skill.sensitive, skillKind },
            ctx.chatToolPolicy,
          )
        ) {
          const approval = await db.createApprovalRequest({
            workspaceId: agent.workspaceId,
            agentId: agent.id,
            chatId: ctx.chatId,
            automationId: ctx.automationId,
            kind: "skill",
            skillId: skill.id,
            toolLabel: skill.id,
            input: input as Record<string, unknown>,
          });
          await logAudit({
            workspaceId: agent.workspaceId,
            agentId: agent.id,
            chatId: ctx.chatId,
            automationId: ctx.automationId,
            actor,
            toolLabel: skill.id,
            input,
            status: "pending_approval",
          });
          return pendingApprovalResult(approval.id, skill.id);
        }

        try {
          const parsedInput = skill.inputSchema.parse(input);
          const skillCtx = createSkillContext(skill.permissions);
          const output = await skill.run(parsedInput, skillCtx);
          await logAudit({
            workspaceId: agent.workspaceId,
            agentId: agent.id,
            chatId: ctx.chatId,
            automationId: ctx.automationId,
            actor,
            toolLabel: skill.id,
            input,
            output,
            status: "success",
          });
          return output;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await logAudit({
            workspaceId: agent.workspaceId,
            agentId: agent.id,
            chatId: ctx.chatId,
            automationId: ctx.automationId,
            actor,
            toolLabel: skill.id,
            input,
            output: { error: message },
            status: "error",
          });
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
      console.error(`Skipping MCP server "${server.name}" — failed to connect:`, err);
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
      const toolKey = `${server.name}__${mcpTool.name}`;
      tools[toolKey] = dynamicTool({
        description:
          mcpTool.description ?? `Tool "${mcpTool.name}" from MCP server "${server.name}".`,
        inputSchema: jsonSchema(mcpTool.inputSchema as Parameters<typeof jsonSchema>[0]),
        execute: async (input) => {
          if (shouldDeferToolForApproval({ kind: "mcp" }, ctx.chatToolPolicy)) {
            const approval = await db.createApprovalRequest({
              workspaceId: agent.workspaceId,
              agentId: agent.id,
              chatId: ctx.chatId,
              automationId: ctx.automationId,
              kind: "mcp",
              mcpServerId: server.id,
              mcpToolName: mcpTool.name,
              toolLabel: toolKey,
              input: input as Record<string, unknown>,
            });
            await logAudit({
              workspaceId: agent.workspaceId,
              agentId: agent.id,
              chatId: ctx.chatId,
              automationId: ctx.automationId,
              actor,
              toolLabel: toolKey,
              input,
              status: "pending_approval",
            });
            return pendingApprovalResult(approval.id, toolKey);
          }

          try {
            const output = await mcpManager.callTool(
              server.id,
              mcpTool.name,
              input as Record<string, unknown>,
            );
            await logAudit({
              workspaceId: agent.workspaceId,
              agentId: agent.id,
              chatId: ctx.chatId,
              automationId: ctx.automationId,
              actor,
              toolLabel: toolKey,
              input,
              output,
              status: "success",
            });
            return output;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await logAudit({
              workspaceId: agent.workspaceId,
              agentId: agent.id,
              chatId: ctx.chatId,
              automationId: ctx.automationId,
              actor,
              toolLabel: toolKey,
              input,
              output: { error: message },
              status: "error",
            });
            throw err;
          }
        },
      });
    }
  }

  if (
    agent.autonomyLevel === "super_agent" &&
    ctx.allowDelegation !== false &&
    agent.delegateAgentIds.length > 0
  ) {
    const delegateTool = await buildDelegateToAgentTool(agent, ctx);
    if (delegateTool) tools.delegate_to_agent = delegateTool;
  }

  return tools;
}
