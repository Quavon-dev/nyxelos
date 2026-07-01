"use client";

import { CheckCircle2, Clock, XCircle } from "lucide-react";
import type { ApprovalStatus } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/** Minimal shape MessageList/ChatApprovalCard need — a subset of
 * ApprovalSummary so callers don't have to pass the full DB record. */
export interface ChatApprovalItem {
  id: string;
  toolLabel: string;
  input: Record<string, unknown>;
  status: ApprovalStatus;
  errorMessage?: string | null;
}

const STATUS_STYLES: Record<ApprovalStatus, string> = {
  pending: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  approved: "border-green-500/25 bg-green-500/10 text-green-700 dark:text-green-400",
  rejected: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

const STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: "Awaiting approval",
  approved: "Approved",
  rejected: "Rejected",
};

const STATUS_ICON: Record<ApprovalStatus, typeof Clock> = {
  pending: Clock,
  approved: CheckCircle2,
  rejected: XCircle,
};

/**
 * Renders a pending (or resolved) tool-call approval inline in the chat
 * timeline, right where the model paused — mirrors the card on the
 * /workspace/[workspaceId]/approvals page but sized for the message list and
 * wired to the same approvals.approve/approvals.reject mutations.
 */
export function ChatApprovalCard({
  approval,
  isActing,
  onApprove,
  onReject,
}: {
  approval: ChatApprovalItem;
  isActing?: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const Icon = STATUS_ICON[approval.status];

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[80%] space-y-2 rounded-2xl border border-border/70 bg-background p-3.5 text-sm shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              Tool call
            </span>
            <code className="text-xs text-foreground">{approval.toolLabel}</code>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
              STATUS_STYLES[approval.status],
            )}
          >
            <Icon className="size-3" />
            {STATUS_LABEL[approval.status]}
          </span>
        </div>

        <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-2 text-xs leading-relaxed">
          {JSON.stringify(approval.input, null, 2)}
        </pre>

        {approval.errorMessage && (
          <p className="text-xs text-destructive">{approval.errorMessage}</p>
        )}

        {approval.status === "pending" && (
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onApprove}
              disabled={isActing}
              className="rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity disabled:opacity-40"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={onReject}
              disabled={isActing}
              className="rounded-full border border-border/70 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
            >
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
