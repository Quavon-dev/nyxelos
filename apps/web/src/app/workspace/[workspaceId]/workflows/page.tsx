"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Copy, Plus, Sparkles, Trash2, Workflow as WorkflowIcon } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeaderSkeleton, StatCardsSkeleton } from "@/components/loading";
import { PageHeader, StatCard } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpcClient, type WorkflowDraftResult, type WorkflowSummary } from "@/lib/trpc";

function formatDate(d: Date | string) {
  return new Date(d).toLocaleString();
}

export default function WorkflowsPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const router = useRouter();
  const queryClient = useQueryClient();

  const workflowsQuery = useQuery({
    queryKey: ["workflows", "list", workspaceId],
    queryFn: () => trpcClient.workflows.list.query({ workspaceId }),
  });
  const workflows = workflowsQuery.data ?? [];

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["workflows", "list", workspaceId] });

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const createWorkflow = useMutation({
    mutationFn: () =>
      trpcClient.workflows.create.mutate({
        workspaceId,
        name: name.trim(),
        description: description.trim() || undefined,
      }),
    onSuccess: (workflow) => {
      setCreateOpen(false);
      setName("");
      setDescription("");
      invalidate();
      router.push(`/workspace/${workspaceId}/workflows/${workflow.id}`);
    },
  });

  const [promptOpen, setPromptOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [draft, setDraft] = useState<WorkflowDraftResult | null>(null);
  const [draftName, setDraftName] = useState("");

  const resetPromptState = () => {
    setPromptText("");
    setDraft(null);
    setDraftName("");
  };

  const generateDraft = useMutation({
    mutationFn: () =>
      trpcClient.workflows.generateFromPrompt.mutate({
        workspaceId,
        prompt: promptText.trim(),
      }),
    onSuccess: (result) => {
      setDraft(result);
      setDraftName(result.suggestedName);
    },
  });

  const saveDraft = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error("Nothing generated yet.");
      return trpcClient.workflows.create.mutate({
        workspaceId,
        name: draftName.trim(),
        definition: draft.definition,
      });
    },
    onSuccess: (workflow) => {
      const warnings = draft?.warnings ?? [];
      setPromptOpen(false);
      resetPromptState();
      invalidate();
      router.push(`/workspace/${workspaceId}/workflows/${workflow.id}`);
      if (warnings.length > 0) {
        toast.warning("Draft saved with a few things to review", {
          description: warnings.slice(0, 3).join(" "),
        });
      }
    },
  });

  const duplicateWorkflow = useMutation({
    mutationFn: (id: string) => trpcClient.workflows.duplicate.mutate({ id }),
    onSuccess: invalidate,
  });

  const [deleteTarget, setDeleteTarget] = useState<WorkflowSummary | null>(null);
  const deleteWorkflow = useMutation({
    mutationFn: (id: string) => trpcClient.workflows.delete.mutate({ id }),
    onSuccess: invalidate,
  });

  if (workflowsQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 md:p-8">
        <PageHeaderSkeleton actions={1} />
        <StatCardsSkeleton count={3} />
      </div>
    );
  }

  const emptyCount = workflows.filter((w) => w.definition.nodes.length === 0).length;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Workflows"
        description="Build node-based pipelines that chain prompts, image generation, video generation, and edits into a single repeatable run — every result lands in the Library too."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setPromptOpen(true)}>
              <Sparkles className="size-4" />
              Create from prompt
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              New workflow
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Workflows"
          value={workflows.length}
          icon={<WorkflowIcon className="size-4" />}
        />
        <StatCard label="Drafts" value={emptyCount} icon={<Plus className="size-4" />} />
        <StatCard
          label="Ready to run"
          value={workflows.length - emptyCount}
          icon={<Copy className="size-4" />}
        />
      </div>

      {workflows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-16 text-center">
          <WorkflowIcon className="size-10 text-muted-foreground/50" />
          <p className="text-sm font-medium">No workflows yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Create a workflow to chain prompts, image generation, and video generation into one
            pipeline you can run again and again.
          </p>
          <Button className="mt-2" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New workflow
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workflows.map((workflow) => (
            <Card key={workflow.id} className="flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <WorkflowIcon className="size-4 text-muted-foreground" />
                  <Link
                    href={`/workspace/${workspaceId}/workflows/${workflow.id}`}
                    className="truncate hover:underline"
                  >
                    {workflow.name}
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
                <p className="line-clamp-2 flex-1 text-sm text-muted-foreground">
                  {workflow.description || "No description."}
                </p>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{workflow.definition.nodes.length} nodes</span>
                  <span>Updated {formatDate(workflow.updatedAt)}</span>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button variant="outline" size="sm" asChild className="flex-1">
                    <Link href={`/workspace/${workspaceId}/workflows/${workflow.id}`}>Open</Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => duplicateWorkflow.mutate(workflow.id)}
                    disabled={duplicateWorkflow.isPending}
                    title="Duplicate"
                  >
                    <Copy className="size-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setDeleteTarget(workflow)}
                    title="Delete"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New workflow</DialogTitle>
            <DialogDescription>
              Starts as an empty canvas — add nodes and connect them once it opens.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='e.g. "Prompt to product video"'
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description (optional)</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter showCloseButton>
            <Button
              onClick={() => createWorkflow.mutate()}
              disabled={!name.trim() || createWorkflow.isPending}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={promptOpen}
        onOpenChange={(open) => {
          setPromptOpen(open);
          if (!open) resetPromptState();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create from prompt</DialogTitle>
            <DialogDescription>
              Describe what the workflow should do — a draft is generated for you to review and
              edit. Nothing is saved or run automatically.
            </DialogDescription>
          </DialogHeader>

          {!draft ? (
            <>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  placeholder='e.g. "Take a text prompt, generate an image from it, then generate a 5 second video from that image."'
                  rows={5}
                  autoFocus
                />
              </div>
              {generateDraft.isError && (
                <p className="text-sm text-destructive">
                  {generateDraft.error instanceof Error
                    ? generateDraft.error.message
                    : "Couldn't generate a draft. Try again."}
                </p>
              )}
              <DialogFooter showCloseButton>
                <Button
                  onClick={() => generateDraft.mutate()}
                  disabled={!promptText.trim() || generateDraft.isPending}
                >
                  {generateDraft.isPending ? "Generating…" : "Generate draft"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    autoFocus
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  {draft.definition.nodes.length} node(s), {draft.definition.edges.length}{" "}
                  connection(s) — this is only a draft. Review it on the canvas and run it yourself
                  when it's ready.
                </p>
                {draft.warnings.length > 0 && (
                  <div className="space-y-1.5 rounded-lg border border-amber-500/40 p-3">
                    <p className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
                      <CircleAlert className="size-4" />
                      Needs a look before it can run
                    </p>
                    <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                      {draft.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <DialogFooter showCloseButton>
                <Button variant="outline" onClick={() => setDraft(null)}>
                  Start over
                </Button>
                <Button
                  onClick={() => saveDraft.mutate()}
                  disabled={!draftName.trim() || saveDraft.isPending}
                >
                  Save draft
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete workflow</DialogTitle>
            <DialogDescription>
              This permanently deletes &quot;{deleteTarget?.name}&quot; and its run history. This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteTarget) {
                  deleteWorkflow.mutate(deleteTarget.id);
                  setDeleteTarget(null);
                }
              }}
              disabled={deleteWorkflow.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
