"use client";

import { ChevronRight, Search, X } from "lucide-react";
import { useState } from "react";
import type { WorkflowNodeKind } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { NODE_KIND_META, NODE_KIND_ORDER } from "./node-meta";

/**
 * Slide-over node picker triggered by the canvas's floating "+" button —
 * click-to-add rather than drag-and-drop, matching the reference n8n-style
 * "What happens next?" panel: search box up top, each node kind as a
 * icon/title/description row. With only 7 kinds there's no need for the
 * category → sub-list drill-down n8n uses for its much larger catalog; a
 * single filtered list covers it.
 */
export function NodeAddPanel({
  onSelect,
  onClose,
}: {
  onSelect: (kind: WorkflowNodeKind) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const kinds = NODE_KIND_ORDER.filter((kind) => {
    if (!q) return true;
    const meta = NODE_KIND_META[kind];
    return meta.label.toLowerCase().includes(q) || meta.description.toLowerCase().includes(q);
  });

  return (
    <div className="absolute inset-y-0 right-0 z-10 flex w-80 flex-col border-l bg-background shadow-lg">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">What happens next?</h2>
        <button
          type="button"
          onClick={onClose}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="border-b p-3">
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2.5 py-1.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            // biome-ignore lint/a11y/noAutofocus: opened by an explicit user click on "+", not on page load
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search nodes..."
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {kinds.length === 0 && (
          <p className="p-3 text-center text-sm text-muted-foreground">No matching nodes.</p>
        )}
        {kinds.map((kind) => {
          const meta = NODE_KIND_META[kind];
          const Icon = meta.icon;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onSelect(kind)}
              className="flex w-full items-start gap-3 rounded-lg p-2.5 text-left transition-colors hover:bg-muted"
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg",
                  meta.accent,
                )}
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{meta.label}</span>
                <span className="line-clamp-2 block text-xs text-muted-foreground">
                  {meta.description}
                </span>
              </span>
              <ChevronRight className="mt-1.5 size-3.5 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
