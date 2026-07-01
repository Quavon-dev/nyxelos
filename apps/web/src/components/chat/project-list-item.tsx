"use client";

import { Copy, Ellipsis, Folder, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProjectSummary } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export function ProjectListItem({
  project,
  isActive,
  onRename,
  onDuplicate,
  onDelete,
}: {
  project: ProjectSummary;
  isActive: boolean;
  onRename: (project: ProjectSummary) => void;
  onDuplicate: (project: ProjectSummary) => void;
  onDelete: (project: ProjectSummary) => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group flex items-center gap-1 rounded-md transition-colors",
            isActive ? "bg-muted" : "hover:bg-muted/60",
          )}
        >
          <Link
            href={`/chat/project/${project.id}`}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 truncate px-2 py-1.5 text-sm",
              isActive
                ? "font-medium text-foreground"
                : "text-foreground/80 group-hover:text-foreground",
            )}
          >
            <Folder className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{project.name}</span>
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "mr-1 flex size-7 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition hover:bg-background/80 hover:text-foreground group-hover:opacity-100",
                  isActive && "opacity-100",
                )}
                aria-label={`Open actions for ${project.name}`}
              >
                <Ellipsis className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40 min-w-40">
              <DropdownMenuItem onClick={() => onRename(project)}>
                <Pencil className="size-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDuplicate(project)}>
                <Copy className="size-4" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(project)}>
                <Trash2 className="size-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onRename(project)}>
          <Pencil className="size-4" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onDuplicate(project)}>
          <Copy className="size-4" />
          Duplicate
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => onDelete(project)}>
          <Trash2 className="size-4" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
