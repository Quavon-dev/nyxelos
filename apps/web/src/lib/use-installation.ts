"use client";

import { useQuery } from "@tanstack/react-query";
import { trpcClient } from "@/lib/trpc";

/**
 * The single source of truth for "is Nyxel installed, and what's the primary
 * workspace id" — shared by the app shell (sidebar/header need a workspaceId
 * to link to) and the home page's setup-wizard-vs-dashboard branch. Same
 * queryKey as the setup wizard uses, so there's one network round trip per
 * page load regardless of how many components ask for it.
 */
export function useInstallation() {
  return useQuery({
    queryKey: ["installation", "status"],
    queryFn: () => trpcClient.installation.status.query(),
  });
}
