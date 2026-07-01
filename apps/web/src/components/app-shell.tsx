"use client";

import type { ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useInstallation } from "@/lib/use-installation";

/**
 * The sidebar/header chrome only makes sense once there's a workspace to
 * navigate — before that, the setup wizard (src/app/page.tsx's
 * not-installed branch) is a full-bleed first-run screen with nothing to
 * put in a sidebar yet. While installation status is loading, render
 * children bare rather than flashing the shell in and out.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const installationQuery = useInstallation();

  if (!installationQuery.data?.isInstalled) {
    return <>{children}</>;
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        <div className="flex flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
