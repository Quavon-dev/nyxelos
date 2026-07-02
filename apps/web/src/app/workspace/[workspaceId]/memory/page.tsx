"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { CardListSkeleton, PageHeaderSkeleton } from "@/components/loading";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { type MemoryEntrySummary, type MemoryType, trpcClient } from "@/lib/trpc";

const MEMORY_TYPE_LABEL: Record<MemoryType, string> = {
  user_preference: "User preference",
  workspace_fact: "Workspace fact",
  project_decision: "Project decision",
  agent_observation: "Agent observation",
  task_summary: "Task summary",
  file_summary: "File summary",
  repo_summary: "Repo summary",
  long_term_note: "Long-term note",
};

const MEMORY_TYPES = Object.keys(MEMORY_TYPE_LABEL) as MemoryType[];

export default function MemoryPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const queryClient = useQueryClient();

  const memoryQuery = useQuery({
    queryKey: ["memory", workspaceId],
    queryFn: () => trpcClient.memory.list.query({ workspaceId }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["memory", workspaceId] });

  const [open, setOpen] = useState(false);
  const [type, setType] = useState<MemoryType>("workspace_fact");
  const [content, setContent] = useState("");

  const create = useMutation({
    mutationFn: () =>
      trpcClient.memory.create.mutate({ workspaceId, type, content, source: "user" }),
    onSuccess: () => {
      invalidate();
      setOpen(false);
      setContent("");
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => trpcClient.memory.delete.mutate({ id }),
    onSuccess: invalidate,
  });

  const entries = memoryQuery.data ?? [];
  const grouped = MEMORY_TYPES.map((memType) => ({
    type: memType,
    entries: entries.filter((entry) => entry.type === memType),
  })).filter((group) => group.entries.length > 0);

  if (memoryQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
        <PageHeaderSkeleton />
        <CardListSkeleton rows={4} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Memory"
        description="Controlled, workspace-scoped facts and observations agents can draw on — every entry is user-editable and deletable, nothing here is written silently without a declared type and source."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="size-4" />
                Add memory
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add memory entry</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={type} onValueChange={(v) => setType(v as MemoryType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MEMORY_TYPES.map((memType) => (
                        <SelectItem key={memType} value={memType}>
                          {MEMORY_TYPE_LABEL[memType]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Content</Label>
                  <Textarea
                    rows={4}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="What should agents in this workspace remember?"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => create.mutate()}
                  disabled={!content.trim() || create.isPending}
                >
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {grouped.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No memory entries yet. Agents haven't recorded anything, and nothing has been added
            manually.
          </CardContent>
        </Card>
      ) : (
        grouped.map((group) => (
          <div key={group.type} className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">
              {MEMORY_TYPE_LABEL[group.type]}
            </h2>
            <div className="space-y-2">
              {group.entries.map((entry) => (
                <MemoryRow key={entry.id} entry={entry} onDelete={() => remove.mutate(entry.id)} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function MemoryRow({
  entry,
  onDelete,
}: {
  entry: MemoryEntrySummary;
  onDelete: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 pt-6">
        <div className="space-y-1">
          <p className="text-sm">{entry.content}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{entry.source}</Badge>
            <span>confidence {Math.round(entry.confidence * 100)}%</span>
            <span>{new Date(entry.updatedAt).toLocaleString()}</span>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onDelete}>
          <Trash2 className="size-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
