"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  ClipboardCheck,
  Clock,
  LayoutDashboard,
  Library,
  NotebookPen,
  Plug,
  ScrollText,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { trpcClient } from "@/lib/trpc";
import { useInstallation } from "@/lib/use-installation";

export function AppSidebar() {
  const pathname = usePathname();
  const installationQuery = useInstallation();
  const workspaceId = installationQuery.data?.record?.primaryWorkspaceId;

  // A live badge on "Approvals" — the one nav item where "something is
  // waiting on you" is worth surfacing without a click, same idea as the
  // Discount(2) badge in the reference layout.
  const pendingApprovalsQuery = useQuery({
    queryKey: ["approvals", workspaceId, "pending"],
    queryFn: () =>
      trpcClient.approvals.list.query({ workspaceId: workspaceId!, status: "pending" }),
    enabled: Boolean(workspaceId),
    refetchInterval: 15_000,
  });
  const pendingCount = pendingApprovalsQuery.data?.length ?? 0;

  const navItems = workspaceId
    ? [
        { href: "/", label: "Overview", icon: LayoutDashboard },
        {
          href: `/workspace/${workspaceId}/settings`,
          label: "Custom Instructions",
          icon: NotebookPen,
        },
        { href: `/workspace/${workspaceId}/agents`, label: "Agents", icon: Bot },
        { href: `/workspace/${workspaceId}/mcp-servers`, label: "MCP Servers", icon: Plug },
        { href: `/workspace/${workspaceId}/automations`, label: "Automations", icon: Clock },
        {
          href: `/workspace/${workspaceId}/approvals`,
          label: "Approvals",
          icon: ClipboardCheck,
          badge: pendingCount > 0 ? pendingCount : undefined,
        },
        { href: `/workspace/${workspaceId}/audit-log`, label: "Audit Log", icon: ScrollText },
        {
          href: `/workspace/${workspaceId}/knowledge-base`,
          label: "Knowledge Base",
          icon: Library,
        },
      ]
    : [{ href: "/", label: "Overview", icon: LayoutDashboard }];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Sparkles className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Nyxel</span>
                  <span className="truncate text-xs text-muted-foreground">Agentic OS</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={item.label}>
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                  {"badge" in item && item.badge !== undefined && (
                    <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
