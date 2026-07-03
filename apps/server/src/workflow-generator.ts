import { randomUUID } from "node:crypto";
import { getDb, type WorkflowDefinition, type WorkflowNodeKind } from "@nyxel/db";
import { resolveModel } from "@nyxel/model-providers";
import { generateText } from "ai";
import { getInstalledProvidersForWorkspace } from "./models";

const NODE_KINDS: WorkflowNodeKind[] = [
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
];
const VALID_NODE_KINDS = new Set<WorkflowNodeKind>(NODE_KINDS);

// Fields (beyond agentId/libraryFileId, which get their own workspace-aware
// checks below) a node can't run without. Kept intentionally small — most
// node kinds have every field optional at generation time and only fail at
// run time, same as a human leaving them blank in the builder.
const REQUIRED_FIELDS: Partial<Record<WorkflowNodeKind, string[]>> = {
  text_prompt: ["prompt"],
  http_request: ["url"],
  condition: ["value"],
};

const NODE_CATALOG_DOC = `
- text_prompt: data.prompt (string) — a fixed text value fed downstream.
- generate_image: data.prompt (string, optional if an upstream node supplies text), data.model (optional model id, leave unset to use the workspace default), data.size (optional, e.g. "1024x1024")
- generate_video: data.prompt (string), data.model (optional), data.size (optional), data.seconds (optional number)
- edit_video: data.operation (one of "trim", "volume", "speed", "thumbnail", "fps"), plus the relevant field for that operation (e.g. startSeconds/endSeconds for trim). Needs an upstream video node connected — it has no file field of its own.
- http_request: data.url (string, required), data.method (optional, default GET)
- delay: data.seconds (optional number, default 5)
- condition: data.value (string) — passes its input through only if the input text contains this value (case-insensitive); has two output handles, "true" and "false", set via each edge's sourceHandle
- output: no data fields — marks the end of a branch
- image_upload / video_upload: data.libraryFileId — references a file already in the user's library. Never invent an id. Only use these node types if the description clearly refers to an existing uploaded file; otherwise prefer generate_image/generate_video.
- agent: data.agentId — must be the id of one of the workspace's existing agents listed below. Never invent an id. Omit this node type entirely if no listed agent fits.
`.trim();

export interface WorkflowDraftResult {
  definition: WorkflowDefinition;
  suggestedName: string;
  warnings: string[];
}

function extractJsonBlock(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? (fenced[1] ?? "") : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return candidate.trim();
  return candidate.slice(start, end + 1);
}

// Model output positions are unreliable (overlapping, off-canvas, or just
// absent) — always overwrite with a simple left-to-right layout instead of
// trusting whatever the model produced.
function autoLayout(nodes: { id: string }[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, index) => {
    positions.set(node.id, { x: 120 + index * 260, y: 160 });
  });
  return positions;
}

/**
 * Turns raw (untrusted) model output into a WorkflowDefinition the builder
 * can open. Never throws on malformed content — unknown node types and
 * dangling edges are dropped, missing required fields are left in place and
 * surfaced as warnings instead, so the user always gets an editable draft
 * back rather than a hard failure mid-generation.
 */
function sanitizeDraft(
  parsed: unknown,
  ctx: { agentIds: Set<string>; fallbackName: string },
): WorkflowDraftResult {
  const warnings: string[] = [];
  const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};

  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];

  const usedNodeIds = new Set<string>();
  const nodes: WorkflowDefinition["nodes"] = [];

  for (const rawNode of rawNodes) {
    if (!rawNode || typeof rawNode !== "object") continue;
    const r = rawNode as Record<string, unknown>;
    const type = r.type;
    if (typeof type !== "string" || !VALID_NODE_KINDS.has(type as WorkflowNodeKind)) {
      warnings.push(`Removed a node with an unsupported type ("${String(type)}").`);
      continue;
    }

    let id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : randomUUID();
    if (usedNodeIds.has(id)) id = randomUUID();
    usedNodeIds.add(id);

    const data: Record<string, unknown> =
      r.data && typeof r.data === "object" ? { ...(r.data as Record<string, unknown>) } : {};
    const kind = type as WorkflowNodeKind;

    if (kind === "agent") {
      const agentId = data.agentId;
      if (typeof agentId !== "string" || !ctx.agentIds.has(agentId)) {
        warnings.push(`Node "${id}" (agent) needs a valid agent selected before it can run.`);
        delete data.agentId;
      }
    } else if (kind === "image_upload" || kind === "video_upload") {
      if (typeof data.libraryFileId !== "string" || !data.libraryFileId) {
        warnings.push(`Node "${id}" (${kind}) needs a file selected before it can run.`);
      }
    } else {
      for (const field of REQUIRED_FIELDS[kind] ?? []) {
        const value = data[field];
        if (value === undefined || value === null || value === "") {
          warnings.push(
            `Node "${id}" (${kind}) is missing "${field}" — fill it in before running.`,
          );
        }
      }
    }

    nodes.push({ id, type: kind, position: { x: 0, y: 0 }, data });
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const usedEdgeIds = new Set<string>();
  const edges: WorkflowDefinition["edges"] = [];

  for (const rawEdge of rawEdges) {
    if (!rawEdge || typeof rawEdge !== "object") continue;
    const r = rawEdge as Record<string, unknown>;
    const source = r.source;
    const target = r.target;
    if (typeof source !== "string" || typeof target !== "string") continue;
    if (!nodeIds.has(source) || !nodeIds.has(target)) {
      warnings.push("Removed an edge that pointed at a node the model didn't actually create.");
      continue;
    }

    let id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : randomUUID();
    if (usedEdgeIds.has(id)) id = randomUUID();
    usedEdgeIds.add(id);

    const sourceHandle =
      r.sourceHandle === "true" || r.sourceHandle === "false" ? r.sourceHandle : undefined;
    edges.push({ id, source, target, ...(sourceHandle ? { sourceHandle } : {}) });
  }

  const positions = autoLayout(nodes);
  for (const node of nodes) {
    const position = positions.get(node.id);
    if (position) node.position = position;
  }

  if (nodes.length === 0) {
    warnings.push("The model didn't produce any usable nodes — try rephrasing your description.");
  }

  const rawName = typeof obj.name === "string" ? obj.name.trim() : "";
  const suggestedName = (rawName || ctx.fallbackName.trim()).slice(0, 60) || "Untitled workflow";

  return { definition: { nodes, edges }, suggestedName, warnings };
}

/**
 * Generates a workflow draft from a natural-language description. Returns a
 * plain (unsaved) definition — the caller decides whether/when to persist it
 * via workflows.create, and nothing here ever starts a run. See
 * workflowDefinitionSchema in trpc/router.ts, which re-validates this output
 * the moment a caller tries to save it, so a bug here can't smuggle a
 * malformed definition into storage even if this sanitizer has a gap.
 */
export async function generateWorkflowDraftFromPrompt(input: {
  workspaceId: string;
  prompt: string;
}): Promise<WorkflowDraftResult> {
  const db = getDb();
  const workspace = await db.getWorkspace(input.workspaceId);
  if (!workspace) throw new Error("Workspace not found.");
  if (!workspace.defaultModelId) {
    throw new Error(
      "This workspace has no default model configured — set one in workspace settings before generating a workflow draft.",
    );
  }

  const installedProviders = await getInstalledProvidersForWorkspace(input.workspaceId);
  let model: ReturnType<typeof resolveModel>;
  try {
    model = resolveModel(workspace.defaultModelId, installedProviders);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Can't generate a draft with the workspace's default model: ${message}`);
  }

  const agents = await db.listAgentsByWorkspace(input.workspaceId);
  const agentCatalog = agents.length
    ? agents.map((a) => `- ${a.id}: ${a.name}`).join("\n")
    : "(none configured in this workspace)";

  const systemPrompt = [
    "You design workflow drafts for NyxelOS, a node-based automation canvas.",
    'Given a short natural-language description, respond with ONLY a single JSON object — no prose, no markdown fences — matching this shape: { "name": string, "nodes": [{ "id": string, "type": string, "data": object }], "edges": [{ "id": string, "source": string, "target": string, "sourceHandle"?: "true" | "false" }] }.',
    "Omit node positions — they're assigned automatically.",
    "Only use these node types, each with its data fields:",
    NODE_CATALOG_DOC,
    "Available agents in this workspace (id: name):",
    agentCatalog,
    "Keep the graph small and linear unless the description clearly needs branching (condition node). Every node should be reachable by an edge except the first. Respond with JSON only, nothing else.",
  ].join("\n\n");

  let raw: string;
  try {
    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: input.prompt,
      maxOutputTokens: 4_096,
    });
    raw = result.text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`The model couldn't be reached to generate a draft: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonBlock(raw));
  } catch {
    throw new Error(
      "The model returned something that wasn't valid JSON. Try again or rephrase your description.",
    );
  }

  return sanitizeDraft(parsed, {
    agentIds: new Set(agents.map((a) => a.id)),
    fallbackName: input.prompt,
  });
}
