import type { DragEvent } from "react";
import type { WorkflowNodeKind } from "@/lib/trpc";
import { NODE_KIND_META, NODE_KIND_ORDER } from "./node-meta";

// React Flow's documented drag-and-drop pattern: the palette item sets its
// kind on the DataTransfer, the canvas reads it back in onDrop — see
// page.tsx's onDrop/onDragOver handlers.
export const WORKFLOW_NODE_DRAG_TYPE = "application/nyxel-workflow-node";

export function NodePalette() {
  function onDragStart(event: DragEvent<HTMLButtonElement>, kind: WorkflowNodeKind) {
    event.dataTransfer.setData(WORKFLOW_NODE_DRAG_TYPE, kind);
    event.dataTransfer.effectAllowed = "move";
  }

  return (
    <div className="flex h-full w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r bg-muted/20 p-2">
      <p className="px-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Nodes
      </p>
      {NODE_KIND_ORDER.map((kind) => {
        const meta = NODE_KIND_META[kind];
        const Icon = meta.icon;
        return (
          <button
            key={kind}
            type="button"
            draggable
            onDragStart={(e) => onDragStart(e, kind)}
            title={meta.description}
            className="flex cursor-grab items-start gap-2 rounded-md border border-transparent p-2 text-left transition-colors hover:border-border hover:bg-background active:cursor-grabbing"
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium">{meta.label}</span>
              <span className="line-clamp-2 block text-[11px] text-muted-foreground">
                {meta.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
