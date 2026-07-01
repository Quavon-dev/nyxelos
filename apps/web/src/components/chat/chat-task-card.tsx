"use client";

import { ListTodo } from "lucide-react";
import Link from "next/link";
import type { TaskPriority, TaskStatus } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export interface ChatTaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignedAgentName: string | null;
}

const STATUS_STYLES: Record<TaskStatus, string> = {
  pending: "border-muted-foreground/25 bg-muted text-muted-foreground",
  planning: "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  ready: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  running: "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  blocked: "border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  waiting_approval: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  completed: "border-green-500/25 bg-green-500/10 text-green-700 dark:text-green-400",
  failed: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-400",
  cancelled: "border-muted-foreground/25 bg-muted text-muted-foreground",
};

/**
 * Inline card shown in the chat timeline when the assistant creates a
 * durable task via the workspace_task_create management tool — task.sourceChatId
 * links it back to this chat (see management-tools.ts), so this doesn't rely
 * on parsing free-form assistant text.
 */
export function ChatTaskCard({
  task,
  workspaceId,
}: {
  task: ChatTaskItem;
  workspaceId: string;
}) {
  return (
    <div className="flex justify-start">
      <Link
        href={`/workspace/${workspaceId}/tasks/${task.id}`}
        className="flex w-full max-w-[80%] items-center gap-3 rounded-2xl border border-border/70 bg-background p-3.5 text-sm shadow-sm transition-colors hover:bg-muted/50"
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <ListTodo className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">{task.title}</p>
          <p className="text-xs text-muted-foreground">
            {task.assignedAgentName ?? "Unassigned"} · {task.priority}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
            STATUS_STYLES[task.status],
          )}
        >
          {task.status.replace("_", " ")}
        </span>
      </Link>
    </div>
  );
}
