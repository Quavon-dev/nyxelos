"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { trpcClient } from "@/lib/trpc";

export default function WorkspaceSettingsPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const queryClient = useQueryClient();

  const workspaceQuery = useQuery({
    queryKey: ["workspace", workspaceId],
    queryFn: () => trpcClient.workspaces.get.query({ workspaceId }),
  });

  const [instructions, setInstructions] = useState("");

  // Seed the textarea once the workspace loads, without clobbering edits in
  // progress on every background refetch.
  useEffect(() => {
    if (workspaceQuery.data) setInstructions(workspaceQuery.data.customInstructions ?? "");
  }, [workspaceQuery.data]);

  const save = useMutation({
    mutationFn: () =>
      trpcClient.workspaces.updateInstructions.mutate({
        workspaceId,
        customInstructions: instructions.trim() === "" ? null : instructions,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Custom instructions</h1>
        <p className="text-muted-foreground">
          Prepended as a system-prompt block before every chat in this workspace (see
          ARCHITECTURE.md section 5).
        </p>
      </div>

      <Card className="space-y-3 p-4">
        <Textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="e.g. Always answer in German. Prefer concise, direct answers."
          rows={8}
          disabled={workspaceQuery.isLoading}
        />
        <div className="flex items-center gap-3">
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || workspaceQuery.isLoading}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          {save.isSuccess && <span className="text-sm text-muted-foreground">Saved.</span>}
        </div>
      </Card>
    </div>
  );
}
