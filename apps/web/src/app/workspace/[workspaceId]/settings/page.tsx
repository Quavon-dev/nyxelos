"use client";

import { useParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { WorkspaceSettingsPanel } from "@/components/workspace-settings-panel";

export default function WorkspaceSettingsPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Workspace settings"
        description="Configure prompt defaults and model providers for this workspace."
      />
      <WorkspaceSettingsPanel workspaceId={workspaceId} />
    </div>
  );
}
