"use client";

import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { PwaInstallBanner } from "@/components/pwa-install-banner";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useAppNotifications } from "@/lib/use-app-notifications";
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
  useAppNotifications();

  if (!installationQuery.data?.isInstalled) {
    return <>{children}</>;
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <PwaInstallBanner />
        <AppHeader />
        <div className="flex flex-1 flex-col">{children}</div>
      </SidebarInset>
      <Toaster richColors position="bottom-right" />
    </SidebarProvider>
  );
}
