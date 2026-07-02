"use client";

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  MinusCircle,
} from "lucide-react";
import { useState } from "react";
import type { WorkflowDefinition, WorkflowRunNodeSummary, WorkflowRunSummary } from "@/lib/trpc";
import { NODE_KIND_META } from "./node-meta";

const STATUS_ICON: Record<WorkflowRunNodeSummary["status"], typeof CheckCircle2> = {
  queued: MinusCircle,
  running: Loader2,
  completed: CheckCircle2,
  failed: AlertCircle,
  skipped: MinusCircle,
};

const STATUS_COLOR: Record<WorkflowRunNodeSummary["status"], string> = {
  queued: "text-muted-foreground",
  running: "text-primary",
  completed: "text-emerald-500",
  failed: "text-destructive",
  skipped: "text-muted-foreground",
};

/** Bottom drawer showing the live (or most recent) run's per-node status —
 * the canvas nodes paint the same statuses inline, this is the scannable
 * list version plus each node's error message, matching the reference
 * editor's collapsible bottom "Logs" panel. */
export function ExecutionPanel({
  run,
  nodes,
  definition,
}: {
  run: WorkflowRunSummary;
  nodes: WorkflowRunNodeSummary[];
  definition: WorkflowDefinition;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const labelForNode = (nodeId: string) => {
    const node = definition.nodes.find((n) => n.id === nodeId);
    return node ? NODE_KIND_META[node.type].label : nodeId;
  };

  return (
    <div className="flex shrink-0 flex-col border-t bg-background">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center justify-between px-4 py-2 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          Logs
          <span className="text-xs font-normal text-muted-foreground capitalize">{run.status}</span>
        </span>
        {collapsed ? (
          <ChevronUp className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        )}
      </button>
      {!collapsed && (
        <div className="max-h-40 overflow-y-auto border-t px-4 py-2">
          {nodes.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nothing to display yet. Execute the workflow to see execution logs.
            </p>
          ) : (
            <ul className="space-y-1.5 py-1">
              {nodes.map((node) => {
                const Icon = STATUS_ICON[node.status];
                return (
                  <li key={node.id} className="flex items-start gap-2 text-xs">
                    <Icon
                      className={`mt-0.5 size-3.5 shrink-0 ${STATUS_COLOR[node.status]} ${
                        node.status === "running" ? "animate-spin" : ""
                      }`}
                    />
                    <span className="font-medium">{labelForNode(node.nodeId)}</span>
                    <span className="text-muted-foreground capitalize">{node.status}</span>
                    {node.errorMessage && (
                      <span className="text-destructive">— {node.errorMessage}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
