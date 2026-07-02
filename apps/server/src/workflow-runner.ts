import {
  getDb,
  type WorkflowDefinition,
  type WorkflowRecord,
  type WorkflowRunNodeRecord,
  type WorkflowRunRecord,
  type WorkflowRunStatus,
} from "@nyxel/db";
import { resolveImageModel } from "@nyxel/model-providers";
import { generateImage, NoImageGeneratedError } from "ai";
import { executeManagedTask } from "./agent-runtime";
import { libraryFileDiskPath, saveLibraryUpload } from "./library";
import { getInstalledProvidersForWorkspace } from "./models";
import { generateVideo } from "./video";
import { editVideo, type VideoEditOperation } from "./video-edit";

type WorkflowNode = WorkflowDefinition["nodes"][number];
type NodeOutput = { kind: "text"; text: string } | { kind: "file"; libraryFileId: string };

function textInputs(inputs: NodeOutput[]): string | undefined {
  return inputs.find((i): i is Extract<NodeOutput, { kind: "text" }> => i.kind === "text")?.text;
}

function fileInputs(inputs: NodeOutput[]): string | undefined {
  return inputs.find((i): i is Extract<NodeOutput, { kind: "file" }> => i.kind === "file")
    ?.libraryFileId;
}

function slug(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return cleaned || "workflow-output";
}

async function runTextPromptNode(data: Record<string, unknown>): Promise<NodeOutput> {
  return { kind: "text", text: (data.prompt as string) ?? "" };
}

async function runFileRefNode(data: Record<string, unknown>): Promise<NodeOutput> {
  const libraryFileId = data.libraryFileId as string | null | undefined;
  if (!libraryFileId) throw new Error("No file selected for this node.");
  return { kind: "file", libraryFileId };
}

async function runGenerateImageNode(
  data: Record<string, unknown>,
  inputs: NodeOutput[],
  workspaceId: string,
): Promise<NodeOutput> {
  const prompt = (data.prompt as string) || textInputs(inputs);
  if (!prompt) {
    throw new Error("No prompt available — set one directly or connect a Text Prompt node.");
  }

  const installedProviders = await getInstalledProvidersForWorkspace(workspaceId);
  const resolved = resolveImageModel(installedProviders, data.model as string | undefined);

  let result: Awaited<ReturnType<typeof generateImage>>;
  try {
    result = await generateImage({
      model: resolved.model,
      prompt,
      // generateImage()'s `size` is typed as a `${number}x${number}` template
      // literal, but this comes from free-form node config validated at the
      // provider (an invalid value is rejected there, same as the
      // generate_image chat tool's untyped equivalent in tools-builtin/image.ts).
      size: ((data.size as string) || "1024x1024") as `${number}x${number}`,
    });
  } catch (err) {
    if (NoImageGeneratedError.isInstance(err)) {
      const cause =
        err.cause instanceof Error ? err.cause.message : String(err.cause ?? "unknown error");
      throw new Error(`Image generation failed: ${cause}`);
    }
    throw err;
  }

  const mimeType = result.image.mediaType || "image/png";
  const ext = mimeType.split("/")[1] ?? "png";
  const bytes = Uint8Array.from(atob(result.image.base64), (c) => c.charCodeAt(0));
  const file = await saveLibraryUpload({
    workspaceId,
    folderId: null,
    fileName: `${slug(prompt)}.${ext}`,
    mimeType,
    bytes,
  });
  return { kind: "file", libraryFileId: file.id };
}

/** If an upstream node produced an *image* file, reads it off disk so it can
 * be passed as Sora's `input_reference` — video's own sourceImage plumbing
 * (see apps/server/src/video.ts) already expects base64 in this shape. A
 * video file upstream (e.g. chained off another generate_video) is left
 * alone; there's nothing meaningful to pass as a reference image. */
async function resolveSourceImage(
  fileLibraryFileId: string | undefined,
): Promise<{ base64: string; mimeType: string } | null> {
  if (!fileLibraryFileId) return null;
  const file = await getDb().getLibraryFile(fileLibraryFileId);
  if (file?.kind !== "image") return null;
  const diskPath = libraryFileDiskPath(file.workspaceId, file.storageKey);
  const bytes = new Uint8Array(await Bun.file(diskPath).arrayBuffer());
  return { base64: Buffer.from(bytes).toString("base64"), mimeType: file.mimeType };
}

async function runGenerateVideoNode(
  data: Record<string, unknown>,
  inputs: NodeOutput[],
  workspaceId: string,
): Promise<NodeOutput> {
  const prompt = (data.prompt as string) || textInputs(inputs) || "";
  const sourceImage = await resolveSourceImage(fileInputs(inputs));
  if (!prompt && !sourceImage) {
    throw new Error(
      "No prompt or reference image available — set a prompt or connect an input node.",
    );
  }

  const result = await generateVideo({
    workspaceId,
    prompt,
    model: data.model as string | undefined,
    size: data.size as string | undefined,
    seconds: data.seconds as number | undefined,
    sourceImage,
  });
  return { kind: "file", libraryFileId: result.file.id };
}

async function runEditVideoNode(
  data: Record<string, unknown>,
  inputs: NodeOutput[],
  workspaceId: string,
): Promise<NodeOutput> {
  const libraryFileId = fileInputs(inputs);
  if (!libraryFileId) throw new Error("Edit Video needs a connected video input.");

  const result = await editVideo({
    workspaceId,
    operation: (data.operation as VideoEditOperation) ?? "trim",
    libraryFileId,
    startSeconds: data.startSeconds as number | undefined,
    endSeconds: data.endSeconds as number | undefined,
    volume: data.volume as number | undefined,
    speed: data.speed as number | undefined,
    timestampSeconds: data.timestampSeconds as number | undefined,
    fps: data.fps as number | undefined,
  });
  return { kind: "file", libraryFileId: result.file.id };
}

/** Runs one of the workspace's agents as a workflow step — the connection
 * point that lets a media-generation pipeline hand off to an LLM agent
 * mid-graph (e.g. caption an image, review a generated video's transcript)
 * instead of the two systems staying siloed. Runs the agent through the same
 * managed-task path a delegated sub-agent uses, so it gets a real task/run
 * row, respects the agent's own autonomy-level tool policy, and shows up in
 * that agent's history — just triggered by a workflow instead of a chat or
 * automation. */
async function runAgentNode(
  data: Record<string, unknown>,
  inputs: NodeOutput[],
  workspaceId: string,
): Promise<NodeOutput> {
  const agentId = data.agentId as string | undefined;
  if (!agentId) throw new Error("No agent selected for this node.");

  const db = getDb();
  const agent = await db.getAgent(agentId);
  if (!agent || agent.workspaceId !== workspaceId) {
    throw new Error("Selected agent is not available in this workspace.");
  }

  const instruction = ((data.instruction as string) || textInputs(inputs) || "").trim();
  if (!instruction) {
    throw new Error("No instruction available — set one directly or connect a Text Prompt node.");
  }

  const task = await db.createTask({
    workspaceId,
    createdByAgentId: agent.id,
    assignedAgentId: agent.id,
    title: `Workflow step · ${agent.name}`,
    instruction,
    status: "ready",
    input: { workflowStep: true },
  });
  const result = await executeManagedTask({ taskId: task.id, agent, trigger: "task" });
  return { kind: "text", text: result.output };
}

async function runOutputNode(inputs: NodeOutput[]): Promise<NodeOutput> {
  const output = inputs[0];
  if (!output) throw new Error("Nothing is connected into this Output node.");
  return output;
}

async function runHttpRequestNode(
  data: Record<string, unknown>,
  inputs: NodeOutput[],
): Promise<NodeOutput> {
  const url = (data.url as string) || "";
  if (!url) throw new Error("No URL set for this node.");
  const method = ((data.method as string) || "GET").toUpperCase();
  const body = method === "GET" ? undefined : textInputs(inputs);

  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "text/plain" } : undefined,
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Request to ${url} failed: ${res.status} ${res.statusText}`);
  }
  return { kind: "text", text };
}

async function runDelayNode(
  data: Record<string, unknown>,
  inputs: NodeOutput[],
): Promise<NodeOutput> {
  const seconds = Math.max(0, (data.seconds as number) ?? 5);
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  return inputs[0] ?? { kind: "text", text: "" };
}

type ConditionBranch = "true" | "false";

/** Evaluates a case-insensitive "does the connected text contain this
 * value" check and passes its first input straight through — the branch
 * (not the passthrough value) is what determines which of the node's two
 * output handles actually fires, resolved separately in executeWorkflowRun
 * since a single NodeOutput has no room to carry "which handle". */
async function runConditionNode(
  data: Record<string, unknown>,
  inputs: NodeOutput[],
): Promise<{ output: NodeOutput; branch: ConditionBranch }> {
  const text = textInputs(inputs) ?? "";
  const needle = ((data.value as string) ?? "").trim().toLowerCase();
  const matches = needle.length > 0 && text.toLowerCase().includes(needle);
  const output = inputs[0] ?? { kind: "text" as const, text };
  return { output, branch: matches ? "true" : "false" };
}

async function executeNode(
  node: WorkflowNode,
  inputs: NodeOutput[],
  workspaceId: string,
): Promise<{ output: NodeOutput; branch?: ConditionBranch }> {
  switch (node.type) {
    case "text_prompt":
      return { output: await runTextPromptNode(node.data) };
    case "image_upload":
    case "video_upload":
      return { output: await runFileRefNode(node.data) };
    case "generate_image":
      return { output: await runGenerateImageNode(node.data, inputs, workspaceId) };
    case "generate_video":
      return { output: await runGenerateVideoNode(node.data, inputs, workspaceId) };
    case "edit_video":
      return { output: await runEditVideoNode(node.data, inputs, workspaceId) };
    case "agent":
      return { output: await runAgentNode(node.data, inputs, workspaceId) };
    case "http_request":
      return { output: await runHttpRequestNode(node.data, inputs) };
    case "delay":
      return { output: await runDelayNode(node.data, inputs) };
    case "condition":
      return runConditionNode(node.data, inputs);
    case "output":
      return { output: await runOutputNode(inputs) };
  }
}

/**
 * Executes a workflow's graph breadth-first by dependency layer: every node
 * whose upstream nodes have all finished runs in parallel with its
 * layer-mates (Promise.all), then the next layer becomes ready. A node whose
 * upstream failed is marked "skipped" rather than attempted — one broken
 * branch doesn't block sibling branches that don't depend on it, but nothing
 * downstream of a failure silently runs on missing input. Any node never
 * reached (a cycle, which the builder's UI doesn't prevent client-side) is
 * swept up as "skipped" too so the run always terminates.
 */
async function executeWorkflowRun(run: WorkflowRunRecord, workflow: WorkflowRecord): Promise<void> {
  const db = getDb();
  await db.updateWorkflowRun(run.id, { status: "running", startedAt: new Date() });

  const { nodes, edges } = workflow.definition;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  const inboundEdges = new Map<string, WorkflowDefinition["edges"]>();
  for (const node of nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
    inboundEdges.set(node.id, []);
  }
  for (const edge of edges) {
    incoming.get(edge.target)?.push(edge.source);
    outgoing.get(edge.source)?.push(edge.target);
    inboundEdges.get(edge.target)?.push(edge);
  }

  const runNodes = await db.listWorkflowRunNodesByRun(run.id);
  const runNodeIdByNodeId = new Map(runNodes.map((rn) => [rn.nodeId, rn.id]));

  const resolved = new Map<string, NodeOutput>();
  const branchByNodeId = new Map<string, ConditionBranch>();
  const failedOrSkipped = new Set<string>();
  const processed = new Set<string>();
  const remainingIncoming = new Map<string, number>();
  for (const [id, srcs] of incoming) remainingIncoming.set(id, srcs.length);

  let frontier = nodes.filter((n) => (incoming.get(n.id)?.length ?? 0) === 0).map((n) => n.id);

  // An inbound edge only "counts" if its source completed successfully and,
  // for a condition source specifically, the edge leaves from the handle
  // that condition actually took — this is what makes the untaken branch's
  // whole downstream subtree get skipped instead of running on stale input.
  function edgeSatisfied(edge: WorkflowDefinition["edges"][number]): boolean {
    if (failedOrSkipped.has(edge.source)) return false;
    const branch = branchByNodeId.get(edge.source);
    if (branch && edge.sourceHandle && edge.sourceHandle !== branch) return false;
    return true;
  }

  while (frontier.length > 0) {
    const wave = frontier;
    frontier = [];

    await Promise.all(
      wave.map(async (nodeId) => {
        processed.add(nodeId);
        const node = nodeById.get(nodeId);
        const runNodeId = runNodeIdByNodeId.get(nodeId);
        if (!node) return;

        const inbound = inboundEdges.get(nodeId) ?? [];
        const satisfiedEdges = inbound.filter(edgeSatisfied);
        if (inbound.length > 0 && satisfiedEdges.length === 0) {
          failedOrSkipped.add(nodeId);
          if (runNodeId) await db.updateWorkflowRunNode(runNodeId, { status: "skipped" });
          return;
        }

        const inputs = satisfiedEdges
          .map((edge) => resolved.get(edge.source))
          .filter((v): v is NodeOutput => Boolean(v));

        if (runNodeId) {
          await db.updateWorkflowRunNode(runNodeId, { status: "running", startedAt: new Date() });
        }
        try {
          const { output, branch } = await executeNode(node, inputs, workflow.workspaceId);
          resolved.set(nodeId, output);
          if (branch) branchByNodeId.set(nodeId, branch);
          if (runNodeId) {
            await db.updateWorkflowRunNode(runNodeId, {
              status: "completed",
              progress: 100,
              completedAt: new Date(),
              libraryFileId: output.kind === "file" ? output.libraryFileId : null,
            });
          }
        } catch (err) {
          failedOrSkipped.add(nodeId);
          const message = err instanceof Error ? err.message : String(err);
          if (runNodeId) {
            await db.updateWorkflowRunNode(runNodeId, {
              status: "failed",
              errorMessage: message,
              completedAt: new Date(),
            });
          }
        }
      }),
    );

    for (const nodeId of wave) {
      for (const next of outgoing.get(nodeId) ?? []) {
        const remaining = (remainingIncoming.get(next) ?? 1) - 1;
        remainingIncoming.set(next, remaining);
        if (remaining <= 0 && !processed.has(next)) frontier.push(next);
      }
    }
    frontier = [...new Set(frontier)];
  }

  for (const node of nodes) {
    if (processed.has(node.id)) continue;
    const runNodeId = runNodeIdByNodeId.get(node.id);
    if (runNodeId) await db.updateWorkflowRunNode(runNodeId, { status: "skipped" });
  }

  const finalNodes = await db.listWorkflowRunNodesByRun(run.id);
  const failedCount = finalNodes.filter((n) => n.status === "failed").length;
  const completedCount = finalNodes.filter((n) => n.status === "completed").length;
  const status: WorkflowRunStatus =
    failedCount === 0 ? "completed" : completedCount > 0 ? "partial" : "failed";

  await db.updateWorkflowRun(run.id, {
    status,
    completedAt: new Date(),
    errorMessage: failedCount > 0 ? `${failedCount} node(s) failed.` : null,
  });
}

async function createWorkflowRunRow(workflow: WorkflowRecord): Promise<WorkflowRunRecord> {
  const db = getDb();
  const run = await db.createWorkflowRun({
    workflowId: workflow.id,
    workspaceId: workflow.workspaceId,
  });
  for (const node of workflow.definition.nodes) {
    await db.createWorkflowRunNode({ runId: run.id, nodeId: node.id });
  }
  return run;
}

/**
 * Starts a workflow run without waiting for it to finish — mirrors
 * queueVideoGeneration's fire-and-forget shape (apps/server/src/video.ts):
 * inserts the run + one row per node, kicks off execution in the
 * background, and returns immediately so the builder page's Run button
 * gets a run id back to poll instead of holding the request open for
 * however long the whole graph takes.
 */
export async function startWorkflowRun(workflowId: string): Promise<WorkflowRunRecord> {
  const db = getDb();
  const workflow = await db.getWorkflow(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

  const run = await createWorkflowRunRow(workflow);
  void executeWorkflowRun(run, workflow).catch((err) => {
    console.error(`Workflow run ${run.id} failed:`, err);
  });

  return run;
}

/**
 * Runs a workflow to completion and returns its final result — the
 * synchronous counterpart to startWorkflowRun, for callers that need the
 * outcome inline instead of polling (the run_workflow agent tool, and
 * cron/file-watch automations that target a workflow). Scoped to
 * `workspaceId` so an agent/automation from one workspace can't run another
 * workspace's workflow by guessing its id.
 */
export async function runWorkflowAndWait(
  workflowId: string,
  workspaceId: string,
): Promise<{ run: WorkflowRunRecord; nodes: WorkflowRunNodeRecord[] }> {
  const db = getDb();
  const workflow = await db.getWorkflow(workflowId);
  if (!workflow || workflow.workspaceId !== workspaceId) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  const run = await createWorkflowRunRow(workflow);
  await executeWorkflowRun(run, workflow);

  const [finalRun, nodes] = await Promise.all([
    db.getWorkflowRun(run.id),
    db.listWorkflowRunNodesByRun(run.id),
  ]);
  return { run: finalRun ?? run, nodes };
}

export async function getWorkflowRun(runId: string): Promise<WorkflowRunRecord | null> {
  return getDb().getWorkflowRun(runId);
}

export async function listWorkflowRunNodes(runId: string): Promise<WorkflowRunNodeRecord[]> {
  return getDb().listWorkflowRunNodesByRun(runId);
}

export async function listWorkflowRunsForWorkflow(
  workflowId: string,
): Promise<WorkflowRunRecord[]> {
  return getDb().listWorkflowRunsByWorkflow(workflowId);
}
