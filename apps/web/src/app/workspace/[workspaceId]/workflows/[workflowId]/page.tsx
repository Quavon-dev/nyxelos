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
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { NodeInspector } from "@/components/workflow/node-inspector";
import { defaultNodeData } from "@/components/workflow/node-meta";
import { NodePalette, WORKFLOW_NODE_DRAG_TYPE } from "@/components/workflow/node-palette";
import { workflowNodeTypes } from "@/components/workflow/workflow-node";
import { trpcClient, type WorkflowNodeKind } from "@/lib/trpc";

const AUTOSAVE_DELAY_MS = 800;

function WorkflowBuilder() {
  const params = useParams<{ workspaceId: string; workflowId: string }>();
  const { workspaceId, workflowId } = params;
  const queryClient = useQueryClient();
  const { screenToFlowPosition } = useReactFlow();

  const workflowQuery = useQuery({
    queryKey: ["workflows", "get", workflowId],
    queryFn: () => trpcClient.workflows.get.query({ id: workflowId }),
  });

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // The graph loads once per workflowId and then lives entirely in local
  // React Flow state — re-syncing from a refetch would clobber in-progress
  // edits, so this ref just gates the one-time hydration.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!workflowQuery.data || hydratedFor.current === workflowId) return;
    hydratedFor.current = workflowId;
    setName(workflowQuery.data.name);
    setNodes(workflowQuery.data.definition.nodes as Node[]);
    setEdges(workflowQuery.data.definition.edges as Edge[]);
  }, [workflowQuery.data, workflowId, setNodes, setEdges]);

  // Debounced autosave of the graph — mirrors the "save 800ms after the user
  // stops editing" pattern rather than a manual Save button, since every
  // node-drag/edge-connect/inspector-field-change should persist without the
  // user thinking about it.
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
            edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
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

  function saveName(nextName: string) {
    if (!nextName.trim() || nextName === workflowQuery.data?.name) return;
    trpcClient.workflows.update.mutate({ id: workflowId, name: nextName.trim() }).then(() => {
      queryClient.invalidateQueries({ queryKey: ["workflows", "list", workspaceId] });
    });
  }

  const onConnect = useCallback<OnConnect>(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData(WORKFLOW_NODE_DRAG_TYPE) as WorkflowNodeKind;
      if (!kind) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const id = crypto.randomUUID();
      setNodes((nds) => [...nds, { id, type: kind, position, data: defaultNodeData(kind) }]);
    },
    [screenToFlowPosition, setNodes],
  );

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

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
    <div className="flex h-full min-h-0 flex-col">
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
        <span className="ml-auto text-xs text-muted-foreground">
          {saveState === "saving" && "Saving…"}
          {saveState === "saved" && "Saved"}
          {saveState === "error" && "Failed to save"}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <NodePalette />
        {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target for the palette's HTML5 drag-and-drop, not a keyboard-operable control */}
        <div className="min-w-0 flex-1" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={workflowNodeTypes}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable className="!bg-background" />
          </ReactFlow>
        </div>
        {selectedNode && (
          <NodeInspector
            workspaceId={workspaceId}
            node={selectedNode}
            onChange={updateSelectedNodeData}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
      {selectedNode && (
        <div className="flex shrink-0 justify-end border-t px-3 py-1.5">
          <button
            type="button"
            onClick={deleteSelectedNode}
            className="text-xs text-destructive hover:underline"
          >
            Delete selected node
          </button>
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
  return (
    <div className="h-[calc(100svh-3.5rem)] min-h-0">
      <ReactFlowProvider>
        <WorkflowBuilder />
      </ReactFlowProvider>
    </div>
  );
}
