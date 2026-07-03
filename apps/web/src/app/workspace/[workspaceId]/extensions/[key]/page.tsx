"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import type { ComponentType } from "react";
import { LocalLeadScoutExtensionPage } from "@/components/extensions/local-lead-scout-page";
import { SeoAnalyzerExtensionPage } from "@/components/extensions/seo-analyzer-page";
import { VideoStudioExtensionPage } from "@/components/extensions/video-studio-page";
import { PageHeaderSkeleton } from "@/components/loading";
import { PageHeader } from "@/components/page-header";
import { trpcClient } from "@/lib/trpc";

/** Per-extension page component, keyed by ExtensionCatalogEntry.route (see
 * apps/server/src/extensions.ts). An installed extension with no entry here
 * falls back to a generic "not built yet" placeholder instead of 404ing. */
const EXTENSION_PAGES: Record<string, ComponentType<{ workspaceId: string }>> = {
  "seo-analyzer": SeoAnalyzerExtensionPage,
  "video-studio": VideoStudioExtensionPage,
  "local-lead-scout": LocalLeadScoutExtensionPage,
};

export default function ExtensionDetailPage() {
  const params = useParams<{ workspaceId: string; key: string }>();
  const { workspaceId, key } = params;

  const catalogQuery = useQuery({
    queryKey: ["extensions", "catalog"],
    queryFn: () => trpcClient.extensions.catalog.query(),
  });
  const installedQuery = useQuery({
    queryKey: ["extensions", "list", workspaceId],
    queryFn: () => trpcClient.extensions.list.query({ workspaceId }),
  });

  if (catalogQuery.isLoading || installedQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
        <PageHeaderSkeleton />
      </div>
    );
  }

  const catalogEntry = catalogQuery.data?.find((entry) => entry.route === key);
  const installed = installedQuery.data?.find((ext) => ext.key === catalogEntry?.key);

  if (!catalogEntry || !installed) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
        <PageHeader
          title="Extension not installed"
          description="Install this extension from workspace settings first."
        />
      </div>
    );
  }

  const ExtensionPage = EXTENSION_PAGES[catalogEntry.route];

  if (!ExtensionPage) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
        <PageHeader title={catalogEntry.name} description={catalogEntry.description} />
        <p className="text-sm text-muted-foreground">
          This extension doesn&apos;t have a page yet.
        </p>
      </div>
    );
  }

  return <ExtensionPage workspaceId={workspaceId} />;
}
