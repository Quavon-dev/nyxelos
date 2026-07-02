"use client";

import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { LoginScreen } from "@/components/login-screen";
import { PwaInstallBanner } from "@/components/pwa-install-banner";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useSession } from "@/lib/auth-client";
import { useAppNotifications } from "@/lib/use-app-notifications";
import { useInstallation } from "@/lib/use-installation";

/**
 * The sidebar/header chrome only makes sense once there's a workspace to
 * navigate — before that, the setup wizard (src/app/page.tsx's
 * not-installed branch) is a full-bleed first-run screen with nothing to
 * put in a sidebar yet. While installation status is loading, render
 * children bare rather than flashing the shell in and out.
 *
 * Once installed, every workspace-scoped tRPC call requires a valid
 * better-auth session (server enforces this — see ADR-0017); a missing or
 * expired session here shows a plain sign-in form instead of the shell so
 * the underlying pages never even attempt authenticated queries. The
 * account that owns the session cookie is established either by the setup
 * wizard's inline sign-in (first run) or by this screen (returning visit,
 * expired cookie, second device).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const installationQuery = useInstallation();
  const { data: session, isPending: sessionPending } = useSession();
  useAppNotifications();

  if (!installationQuery.data?.isInstalled) {
    return <>{children}</>;
  }

  if (sessionPending) {
    return null;
  }

  if (!session) {
    return <LoginScreen />;
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
