"use client";

import {
  addEdge,
  Background,
  type Connection,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  type OnConnect,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Maximize, Play, Plus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExecutionPanel } from "@/components/workflow/execution-panel";
import { ExecutionsTab } from "@/components/workflow/executions-tab";
import { NodeAddPanel } from "@/components/workflow/node-add-panel";
import { NodeInspector } from "@/components/workflow/node-inspector";
import { defaultNodeData } from "@/components/workflow/node-meta";
import { workflowNodeTypes } from "@/components/workflow/workflow-node";
import { trpcClient, type WorkflowNodeKind } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const AUTOSAVE_DELAY_MS = 800;
const ACTIVE_RUN_STATUSES = new Set(["queued", "running"]);

function WorkflowEditor({ workspaceId, workflowId }: { workspaceId: string; workflowId: string }) {
  const queryClient = useQueryClient();
  const { screenToFlowPosition, fitView } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);

  const workflowQuery = useQuery({
    queryKey: ["workflows", "get", workflowId],
    queryFn: () => trpcClient.workflows.get.query({ id: workflowId }),
  });

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);

  // The graph loads once per workflowId and then lives entirely in local
  // React Flow state — re-syncing from a refetch would clobber in-progress
  // edits, so this ref just gates the one-time hydration.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!workflowQuery.data || hydratedFor.current === workflowId) return;
    hydratedFor.current = workflowId;
    setNodes(workflowQuery.data.definition.nodes as Node[]);
    setEdges(workflowQuery.data.definition.edges as Edge[]);
  }, [workflowQuery.data, workflowId, setNodes, setEdges]);

  // Debounced autosave of the graph — every node-drag/edge-connect/
  // inspector-field-change persists without a manual Save button.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (hydratedFor.current !== workflowId) return;
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      trpcClient.workflows.update
        .mutate({
          id: workflowId,
          definition: {
            nodes: nodes.map((n) => ({
              id: n.id,
              type: n.type as WorkflowNodeKind,
              position: n.position,
              data: n.data as Record<string, unknown>,
            })),
            edges: edges.map((e) => ({
              id: e.id,
              source: e.source,
              target: e.target,
              sourceHandle: e.sourceHandle,
            })),
          },
        })
        .then(() => {
          setSaveState("saved");
          queryClient.invalidateQueries({ queryKey: ["workflows", "list", workspaceId] });
        })
        .catch(() => setSaveState("error"));
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [nodes, edges, workflowId, workspaceId, queryClient]);

  const onConnect = useCallback<OnConnect>(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  const addNode = useCallback(
    (kind: WorkflowNodeKind) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const center = rect
        ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
        : { x: 0, y: 0 };
      const id = crypto.randomUUID();
      setNodes((nds) => [
        ...nds,
        { id, type: kind, position: center, data: defaultNodeData(kind) },
      ]);
      setAddPanelOpen(false);
    },
    [screenToFlowPosition, setNodes],
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  function updateSelectedNodeData(data: Record<string, unknown>) {
    if (!selectedNodeId) return;
    setNodes((nds) => nds.map((n) => (n.id === selectedNodeId ? { ...n, data } : n)));
  }

  function deleteSelectedNode() {
    if (!selectedNodeId) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
    setEdges((eds) =>
      eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId),
    );
    setSelectedNodeId(null);
  }

  // Execution — see workflow-runner.ts. Polls only while the run is still
  // queued/running; the canvas nodes and the bottom Logs panel both read off
  // the same runQuery result so they never drift from each other.
  const runQuery = useQuery({
    queryKey: ["workflows", "runs", "get", runId],
    queryFn: () => trpcClient.workflows.runs.get.query({ id: runId as string }),
    enabled: Boolean(runId),
    refetchInterval: (query) =>
      ACTIVE_RUN_STATUSES.has(query.state.data?.run.status ?? "") ? 1_500 : false,
  });
  const activeRun = runQuery.data;
  const isRunActive = ACTIVE_RUN_STATUSES.has(activeRun?.run.status ?? "");

  const wasRunActive = useRef(false);
  useEffect(() => {
    if (wasRunActive.current && !isRunActive) {
      queryClient.invalidateQueries({
        queryKey: ["workflows", "runs", "listForWorkflow", workflowId],
      });
    }
    wasRunActive.current = isRunActive;
  }, [isRunActive, queryClient, workflowId]);

  const startRun = useMutation({
    mutationFn: () => trpcClient.workflows.runs.start.mutate({ workflowId }),
    onSuccess: (run) => setRunId(run.id),
  });

  // Overlays live run status onto each node's `data` for rendering only —
  // kept out of the `nodes` state the autosave effect above watches, so a
  // run's ephemeral progress never gets written into the saved definition.
  const displayNodes = useMemo(() => {
    if (!activeRun) return nodes;
    const statusByNodeId = new Map(activeRun.nodes.map((n) => [n.nodeId, n]));
    return nodes.map((n) => {
      const runNode = statusByNodeId.get(n.id);
      if (!runNode) return n;
      return { ...n, data: { ...n.data, runStatus: runNode.status } };
    });
  }, [nodes, activeRun]);

  if (workflowQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!workflowQuery.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-medium">Workflow not found</p>
        <Link
          href={`/workspace/${workspaceId}/workflows`}
          className="text-sm text-primary hover:underline"
        >
          Back to workflows
        </Link>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1">
      <div ref={canvasRef} className="min-w-0 flex-1">
        <ReactFlow
          nodes={displayNodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={workflowNodeTypes}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onPaneClick={() => setSelectedNodeId(null)}
          defaultEdgeOptions={{ type: "smoothstep", style: { strokeWidth: 1.5 } }}
          fitView
        >
          <Background gap={16} />
          <Controls showInteractive={false} className="!rounded-xl !border !shadow-md" />
          <MiniMap pannable zoomable className="!rounded-xl !border !bg-background !shadow-md" />

          <Panel position="top-right" className="flex flex-col gap-2">
            <Button
              size="icon"
              onClick={() => setAddPanelOpen((v) => !v)}
              className="size-9 rounded-full shadow-md"
            >
              <Plus className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              onClick={() => fitView({ duration: 300 })}
              className="size-9 rounded-full bg-background shadow-md"
            >
              <Maximize className="size-3.5" />
            </Button>
          </Panel>

          <Panel position="bottom-center">
            <Button
              size="lg"
              onClick={() => startRun.mutate()}
              disabled={startRun.isPending || isRunActive || nodes.length === 0}
              className="gap-2 rounded-full px-6 shadow-lg"
            >
              {isRunActive ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              {isRunActive ? "Running…" : "Execute workflow"}
            </Button>
          </Panel>
        </ReactFlow>
      </div>

      {addPanelOpen && <NodeAddPanel onSelect={addNode} onClose={() => setAddPanelOpen(false)} />}

      {selectedNode && !addPanelOpen && (
        <NodeInspector
          workspaceId={workspaceId}
          node={selectedNode}
          onChange={updateSelectedNodeData}
          onClose={() => setSelectedNodeId(null)}
        />
      )}

      {selectedNode && (
        <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2">
          <button
            type="button"
            onClick={deleteSelectedNode}
            className="rounded-full border bg-background px-3 py-1 text-xs text-destructive shadow-md hover:bg-destructive/10"
          >
            Delete selected node
          </button>
        </div>
      )}

      <div className="absolute top-2 right-16 z-10 text-xs text-muted-foreground">
        {saveState === "saving" && "Saving…"}
        {saveState === "saved" && "Saved"}
        {saveState === "error" && "Failed to save"}
      </div>

      {activeRun && (
        <div className="absolute inset-x-0 bottom-0 z-10">
          <ExecutionPanel
            run={activeRun.run}
            nodes={activeRun.nodes}
            definition={workflowQuery.data.definition}
          />
        </div>
      )}
    </div>
  );
}

// 3.5rem matches the app header's fixed height (h-14), same as chat's
// layout.tsx — React Flow needs an explicit pixel height on its container
// (it renders at 100% of its parent), and the shell above us is a min-height
// flex layout that otherwise collapses to content height instead of the
// viewport.
export default function WorkflowBuilderPage() {
  const params = useParams<{ workspaceId: string; workflowId: string }>();
  const { workspaceId, workflowId } = params;
  const [tab, setTab] = useState<"editor" | "executions">("editor");
  const [name, setName] = useState("");

  const workflowQuery = useQuery({
    queryKey: ["workflows", "get", workflowId],
    queryFn: () => trpcClient.workflows.get.query({ id: workflowId }),
  });
  useEffect(() => {
    if (workflowQuery.data) setName(workflowQuery.data.name);
  }, [workflowQuery.data]);

  const queryClient = useQueryClient();
  function saveName(nextName: string) {
    if (!nextName.trim() || nextName === workflowQuery.data?.name) return;
    trpcClient.workflows.update.mutate({ id: workflowId, name: nextName.trim() }).then(() => {
      queryClient.invalidateQueries({ queryKey: ["workflows", "get", workflowId] });
      queryClient.invalidateQueries({ queryKey: ["workflows", "list", workspaceId] });
    });
  }

  return (
    <div className="flex h-[calc(100svh-3.5rem)] min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b px-3 py-2">
        <Link
          href={`/workspace/${workspaceId}/workflows`}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => saveName(name)}
          className="h-8 max-w-xs border-transparent bg-transparent px-1.5 text-sm font-medium shadow-none hover:border-input focus-visible:border-input"
        />
        <nav className="ml-2 flex items-center gap-1">
          {(["editor", "executions"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-2.5 py-1 text-sm capitalize transition-colors",
                tab === t
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>

      {tab === "editor" ? (
        <ReactFlowProvider>
          <WorkflowEditor workspaceId={workspaceId} workflowId={workflowId} />
        </ReactFlowProvider>
      ) : (
        <ExecutionsTab workflowId={workflowId} />
      )}
    </div>
  );
}
