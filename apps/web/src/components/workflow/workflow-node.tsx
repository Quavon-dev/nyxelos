import { Handle, type NodeProps, Position } from "@xyflow/react";
import { AlertCircle, Loader2 } from "lucide-react";
import type { WorkflowNodeKind, WorkflowRunNodeStatus } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { NODE_KIND_META } from "./node-meta";

const EDIT_OPERATION_LABELS: Record<string, string> = {
  trim: "Trim",
  concat: "Concatenate",
  mute: "Mute",
  volume: "Adjust volume",
  speed: "Change speed",
  extractFrame: "Extract frame",
  toGif: "Render GIF",
};

function summarize(kind: WorkflowNodeKind, data: Record<string, unknown>): string {
  switch (kind) {
    case "text_prompt":
      return (data.prompt as string) || "Empty prompt";
    case "image_upload":
      return data.libraryFileId ? "Image selected" : "No image selected";
    case "video_upload":
      return data.libraryFileId ? "Video selected" : "No video selected";
    case "generate_image":
    case "generate_video":
      return (data.prompt as string) || "Uses connected input";
    case "edit_video":
      return EDIT_OPERATION_LABELS[data.operation as string] ?? "Trim";
    case "agent":
      return (data.instruction as string) || "Uses connected input";
    case "output":
      return (data.label as string) || "Final result";
  }
}

const STATUS_RING: Partial<Record<WorkflowRunNodeStatus, string>> = {
  running: "ring-2 ring-primary",
  completed: "ring-2 ring-emerald-500",
  failed: "ring-2 ring-destructive",
};

export interface WorkflowNodeData {
  [key: string]: unknown;
  runStatus?: WorkflowRunNodeStatus;
}

function makeWorkflowNodeComponent(kind: WorkflowNodeKind) {
  const meta = NODE_KIND_META[kind];
  const Icon = meta.icon;

  return function WorkflowNodeComponent({ data, selected }: NodeProps) {
    const nodeData = data as WorkflowNodeData;
    const runStatus = nodeData.runStatus;
    return (
      <div
        className={cn(
          "w-60 rounded-xl border bg-card shadow-sm transition-shadow",
          selected && "border-primary ring-1 ring-primary",
          runStatus && STATUS_RING[runStatus],
        )}
      >
        {meta.hasInput && (
          <Handle
            type="target"
            position={Position.Top}
            className="!size-2.5 !border-2 !border-background !bg-muted-foreground"
          />
        )}
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-lg",
              meta.accent,
            )}
          >
            <Icon className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium leading-tight">{meta.label}</p>
            <p className="truncate text-[11px] leading-tight text-muted-foreground">
              {summarize(kind, nodeData)}
            </p>
          </div>
          {runStatus === "running" && (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
          )}
          {runStatus === "failed" && <AlertCircle className="size-3.5 shrink-0 text-destructive" />}
          {runStatus === "completed" && (
            <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
          )}
        </div>
        {meta.hasOutput && (
          <Handle
            type="source"
            position={Position.Bottom}
            className="!size-2.5 !border-2 !border-background !bg-muted-foreground"
          />
        )}
      </div>
    );
  };
}

export const workflowNodeTypes = Object.fromEntries(
  Object.keys(NODE_KIND_META).map((kind) => [
    kind,
    makeWorkflowNodeComponent(kind as WorkflowNodeKind),
  ]),
);
