"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  Blocks,
  Bot,
  CheckSquare,
  ClipboardCheck,
  Clock,
  Film,
  Images,
  LayoutDashboard,
  Library,
  MessageSquare,
  Package,
  Plug,
  Puzzle,
  ScrollText,
  Settings,
  TrendingUp,
  Workflow,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NyxelLogoMark } from "@/components/brand-mark";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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
import { WorkspaceSettingsPanel } from "@/components/workspace-settings-panel";
import { markNotificationSeen, useUnseenNotificationBadge } from "@/lib/notification-store";
import { trpcClient } from "@/lib/trpc";
import { useInstallation } from "@/lib/use-installation";

// Maps an ExtensionCatalogEntry.icon string (see apps/server/src/extensions.ts)
// to the actual lucide component — keeps the catalog data serializable
// instead of shipping component references over tRPC.
const EXTENSION_ICON_MAP: Record<string, typeof Puzzle> = {
  TrendingUp,
  Film,
};

export function AppSidebar() {
  const pathname = usePathname();
  const installationQuery = useInstallation();
  const workspaceId = installationQuery.data?.record?.primaryWorkspaceId;
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  // Popping dot on "Chat" when a generation finishes elsewhere in the app —
  // see use-app-notifications.ts, which relays the same push events the
  // service worker receives. Cleared once the user actually visits that
  // section.
  const chatUnseen = useUnseenNotificationBadge("/chat");
  useEffect(() => {
    if (pathname.startsWith("/chat")) markNotificationSeen("/chat");
  }, [pathname]);

  // Installed + enabled extensions render as their own sidebar group below
  // "Workspace" — see workspace-settings-panel.tsx's "Extensions" section for
  // where they get installed.
  const extensionCatalogQuery = useQuery({
    queryKey: ["extensions", "catalog"],
    queryFn: () => trpcClient.extensions.catalog.query(),
  });
  const installedExtensionsQuery = useQuery({
    queryKey: ["extensions", "list", workspaceId],
    queryFn: () => trpcClient.extensions.list.query({ workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
  });
  const extensionNavItems = (installedExtensionsQuery.data ?? [])
    .filter((ext) => ext.enabled)
    .map((ext) => {
      const catalogEntry = extensionCatalogQuery.data?.find((e) => e.key === ext.key);
      if (!catalogEntry || !workspaceId) return null;
      return {
        href: `/workspace/${workspaceId}/extensions/${catalogEntry.route}`,
        label: catalogEntry.name,
        icon: EXTENSION_ICON_MAP[catalogEntry.icon] ?? Puzzle,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const navItems = workspaceId
    ? [
        { href: "/", label: "Overview", icon: LayoutDashboard },
        { href: "/chat", label: "Chat", icon: MessageSquare, dot: chatUnseen > 0 },
        {
          href: `/workspace/${workspaceId}/settings`,
          label: "Settings",
          icon: Settings,
        },
        { href: `/workspace/${workspaceId}/agents`, label: "Agents", icon: Bot },
        { href: `/workspace/${workspaceId}/tasks`, label: "Tasks", icon: CheckSquare },
        { href: `/workspace/${workspaceId}/skills`, label: "Skills", icon: Blocks },
        { href: `/workspace/${workspaceId}/plugins`, label: "Plugins", icon: Package },
        { href: `/workspace/${workspaceId}/tools`, label: "Tools", icon: Wrench },
        { href: `/workspace/${workspaceId}/mcp-servers`, label: "Connectors", icon: Plug },
        { href: `/workspace/${workspaceId}/automations`, label: "Automations", icon: Clock },
        {
          href: `/workspace/${workspaceId}/approvals`,
          label: "Approvals",
          icon: ClipboardCheck,
          badge: pendingCount > 0 ? pendingCount : undefined,
        },
        { href: `/workspace/${workspaceId}/audit-log`, label: "Audit Log", icon: ScrollText },
        { href: `/workspace/${workspaceId}/archive`, label: "Archive", icon: Archive },
        {
          href: `/workspace/${workspaceId}/knowledge-base`,
          label: "Knowledge Base",
          icon: Library,
        },
        {
          href: `/workspace/${workspaceId}/library`,
          label: "Library",
          icon: Images,
        },
        {
          href: `/workspace/${workspaceId}/workflows`,
          label: "Workflows",
          icon: Workflow,
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
                <NyxelLogoMark className="h-8 w-[31px] shrink-0 text-sidebar-foreground" />
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
                      <span className="relative flex">
                        <item.icon />
                        {"dot" in item && item.dot && (
                          <span
                            aria-hidden="true"
                            className="-top-0.5 -right-0.5 absolute size-1.5 animate-pulse rounded-full bg-primary"
                          />
                        )}
                      </span>
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

        {extensionNavItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Extensions</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {extensionNavItems.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.href}
                      tooltip={item.label}
                    >
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      {workspaceId && (
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Settings" onClick={() => setSettingsOpen(true)}>
                <Settings />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      )}

      <SidebarRail />

      {workspaceId && (
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="flex h-[640px] max-w-4xl flex-col p-6 sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>Workspace settings</DialogTitle>
            </DialogHeader>
            <WorkspaceSettingsPanel workspaceId={workspaceId} className="min-h-0" />
          </DialogContent>
        </Dialog>
      )}
    </Sidebar>
  );
}
