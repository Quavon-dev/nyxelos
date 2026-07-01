"use client";

import {
  Archive,
  Check,
  Copy,
  Ellipsis,
  FolderInput,
  Pencil,
  Pin,
  PinOff,
  Share2,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatSummary, ProjectSummary } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export type ChatRowActions = {
  onRename: (chat: ChatSummary) => void;
  onDuplicate: (chat: ChatSummary) => void;
  onShare: (chat: ChatSummary) => void;
  onTogglePin: (chat: ChatSummary) => void;
  onArchive: (chat: ChatSummary) => void;
  onDelete: (chat: ChatSummary) => void;
  onMoveToProject: (chat: ChatSummary, projectId: string | null) => void;
};

/** The "Move to project" submenu body — same markup, reused between the
 * dropdown and the right-click context menu (Radix ships separate
 * primitives for each, so the two trees can't share components directly). */
function MoveToProjectOptions({
  chat,
  projects,
  onMoveToProject,
  ItemLine,
}: {
  chat: ChatSummary;
  projects: ProjectSummary[];
  onMoveToProject: (chat: ChatSummary, projectId: string | null) => void;
  ItemLine: (props: { checked: boolean; label: string; onClick: () => void }) => ReactNode;
}) {
  return (
    <>
      {ItemLine({
        checked: !chat.projectId,
        label: "No project",
        onClick: () => onMoveToProject(chat, null),
      })}
      {projects.map((project) => (
        <span key={project.id}>
          {ItemLine({
            checked: chat.projectId === project.id,
            label: project.name,
            onClick: () => onMoveToProject(chat, project.id),
          })}
        </span>
      ))}
    </>
  );
}

export function ChatListItem({
  chat,
  isActive,
  projects,
  actions,
}: {
  chat: ChatSummary;
  isActive: boolean;
  projects: ProjectSummary[];
  actions: ChatRowActions;
}) {
  const isPinned = Boolean(chat.pinnedAt);

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
            href={`/chat/${chat.id}`}
            className={cn(
              "min-w-0 flex-1 truncate px-2 py-1.5 text-sm",
              isActive
                ? "font-medium text-foreground"
                : "text-foreground/80 group-hover:text-foreground",
            )}
          >
            {isPinned && <Pin className="mr-1 inline size-3 text-muted-foreground" />}
            {chat.title || "Untitled chat"}
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "mr-1 flex size-7 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition hover:bg-background/80 hover:text-foreground group-hover:opacity-100",
                  isActive && "opacity-100",
                )}
                aria-label={`Open actions for ${chat.title || "chat"}`}
              >
                <Ellipsis className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 min-w-44">
              <DropdownMenuItem onClick={() => actions.onShare(chat)}>
                <Share2 className="size-4" />
                Share
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions.onTogglePin(chat)}>
                {isPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                {isPinned ? "Unpin" : "Pin"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions.onRename(chat)}>
                <Pencil className="size-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions.onDuplicate(chat)}>
                <Copy className="size-4" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FolderInput className="size-4" />
                  Move to project
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-48">
                  <MoveToProjectOptions
                    chat={chat}
                    projects={projects}
                    onMoveToProject={actions.onMoveToProject}
                    ItemLine={({ checked, label, onClick }) => (
                      <DropdownMenuItem onClick={onClick}>
                        <span className="flex w-4 justify-center">
                          {checked && <Check className="size-4" />}
                        </span>
                        <span className="truncate">{label}</span>
                      </DropdownMenuItem>
                    )}
                  />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onClick={() => actions.onArchive(chat)}>
                <Archive className="size-4" />
                Archive
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => actions.onDelete(chat)}>
                <Trash2 className="size-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onClick={() => actions.onShare(chat)}>
          <Share2 className="size-4" />
          Share
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions.onTogglePin(chat)}>
          {isPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          {isPinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions.onRename(chat)}>
          <Pencil className="size-4" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions.onDuplicate(chat)}>
          <Copy className="size-4" />
          Duplicate
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderInput className="size-4" />
            Move to project
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            <MoveToProjectOptions
              chat={chat}
              projects={projects}
              onMoveToProject={actions.onMoveToProject}
              ItemLine={({ checked, label, onClick }) => (
                <ContextMenuItem onClick={onClick}>
                  <span className="flex w-4 justify-center">
                    {checked && <Check className="size-4" />}
                  </span>
                  <span className="truncate">{label}</span>
                </ContextMenuItem>
              )}
            />
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem onClick={() => actions.onArchive(chat)}>
          <Archive className="size-4" />
          Archive
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => actions.onDelete(chat)}>
          <Trash2 className="size-4" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
