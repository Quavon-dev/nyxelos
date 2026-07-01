"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Bell, Check, Languages, Settings, X } from "lucide-react";
import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { trpcClient } from "@/lib/trpc";
import { useInstallation } from "@/lib/use-installation";

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function timeAgo(date: Date | string) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function AppHeader() {
  const installationQuery = useInstallation();
  const workspaceId = installationQuery.data?.record?.primaryWorkspaceId;
  const queryClient = useQueryClient();

  const workspaceQuery = useQuery({
    queryKey: ["workspace", workspaceId],
    queryFn: () => trpcClient.workspaces.get.query({ workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
  });

  const auditLogQuery = useQuery({
    queryKey: ["auditLog", workspaceId, "recent"],
    queryFn: () => trpcClient.auditLog.list.query({ workspaceId: workspaceId!, limit: 10 }),
    enabled: Boolean(workspaceId),
  });

  const pendingApprovalsQuery = useQuery({
    queryKey: ["approvals", workspaceId, "pending"],
    queryFn: () =>
      trpcClient.approvals.list.query({ workspaceId: workspaceId!, status: "pending" }),
    enabled: Boolean(workspaceId),
    refetchInterval: 15_000,
  });
  const pending = pendingApprovalsQuery.data ?? [];

  const invalidateApprovals = () => {
    queryClient.invalidateQueries({ queryKey: ["approvals", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["auditLog", workspaceId] });
  };
  const approve = useMutation({
    mutationFn: (id: string) => trpcClient.approvals.approve.mutate({ id }),
    onSuccess: invalidateApprovals,
  });
  const reject = useMutation({
    mutationFn: (id: string) => trpcClient.approvals.reject.mutate({ id }),
    onSuccess: invalidateApprovals,
  });

  const workspaceName = workspaceQuery.data?.name;
  const mode = installationQuery.data?.record?.mode;

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger />
      <div className="h-4 w-px bg-border" />

      <div className="relative max-w-sm flex-1">
        <Input placeholder="Type to search…" className="pl-3" />
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground">
              <Languages className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Language (not yet configurable)</TooltipContent>
        </Tooltip>

        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground">
              <Activity className="size-4" />
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Activity</SheetTitle>
              <SheetDescription>
                Recent tool calls in this workspace — chats, automations, approvals, and delegated
                sub-agents.
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 overflow-y-auto px-4">
              {auditLogQuery.data?.length === 0 && (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              )}
              {auditLogQuery.data?.map((entry) => (
                <div key={entry.id} className="space-y-1 border-b pb-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{entry.toolLabel}</span>
                    <span className="text-xs text-muted-foreground">
                      {timeAgo(entry.createdAt)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {entry.actor} · {entry.status}
                  </div>
                </div>
              ))}
            </div>
          </SheetContent>
        </Sheet>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative text-muted-foreground">
              <Bell className="size-4" />
              {pending.length > 0 && (
                <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-destructive" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-96 p-0">
            <div className="flex items-center justify-between border-b p-3">
              <span className="text-sm font-medium">Pending approvals</span>
              {pending.length > 0 && <Badge variant="secondary">{pending.length} new</Badge>}
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {pending.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">Nothing awaiting approval.</p>
              )}
              {pending.map((approval) => (
                <div key={approval.id} className="space-y-2 rounded-md p-2 text-sm hover:bg-accent">
                  <div className="font-medium">{approval.toolLabel}</div>
                  <div className="text-xs text-muted-foreground">{timeAgo(approval.createdAt)}</div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => approve.mutate(approval.id)}
                      disabled={approve.isPending || reject.isPending}
                    >
                      <Check className="size-3.5" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2"
                      onClick={() => reject.mutate(approval.id)}
                      disabled={approve.isPending || reject.isPending}
                    >
                      <X className="size-3.5" />
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {workspaceId && (
              <div className="border-t p-2">
                <Button variant="ghost" size="sm" className="w-full" asChild>
                  <Link href={`/workspace/${workspaceId}/approvals`}>View all approvals</Link>
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            >
              <Avatar className="size-8">
                <AvatarFallback>{workspaceName ? initials(workspaceName) : "N"}</AvatarFallback>
              </Avatar>
              <div className="hidden text-left leading-tight sm:block">
                <div className="font-medium">{workspaceName ?? "Loading…"}</div>
                <div className="text-xs text-muted-foreground">
                  {mode ? `${mode === "server" ? "Server" : "PC"} mode` : "Owner"}
                </div>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{workspaceName ?? "Workspace"}</p>
                <p className="text-xs leading-none text-muted-foreground">
                  {mode === "server" ? "Server mode" : "PC mode"}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {workspaceId && (
              <DropdownMenuItem asChild>
                <Link href={`/workspace/${workspaceId}/settings`}>
                  <Settings className="size-4" />
                  Workspace settings
                </Link>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
