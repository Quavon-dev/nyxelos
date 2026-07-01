"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, MessageSquare, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { CardListSkeleton, PageHeaderSkeleton, StatCardsSkeleton } from "@/components/loading";
import { PageHeader, StatCard } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type ChatSummary, trpcClient } from "@/lib/trpc";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function ArchivePage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const queryClient = useQueryClient();

  const archivedChatsQuery = useQuery({
    queryKey: ["chats", "archived", workspaceId],
    queryFn: () => trpcClient.chats.listArchived.query({ workspaceId }),
  });

  function invalidateChats() {
    queryClient.invalidateQueries({ queryKey: ["chats", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["chats", "list", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["chats", "archived", workspaceId] });
  }

  const restoreChat = useMutation({
    mutationFn: (chatId: string) =>
      trpcClient.chats.setArchived.mutate({ chatId, archived: false }),
    onSuccess: invalidateChats,
  });

  const deleteChat = useMutation({
    mutationFn: (chatId: string) => trpcClient.chats.delete.mutate({ chatId }),
    onSuccess: invalidateChats,
  });

  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<ChatSummary | null>(null);

  const archivedChats = [...(archivedChatsQuery.data ?? [])].sort(
    (a, b) => +new Date(b.archivedAt ?? b.createdAt) - +new Date(a.archivedAt ?? a.createdAt),
  );

  if (archivedChatsQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 md:p-8">
        <PageHeaderSkeleton actions={1} />
        <StatCardsSkeleton count={2} />
        <CardListSkeleton rows={4} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Archive"
        description="Archived chats stay out of the active sidebar but remain available for review, restore, or permanent deletion."
        actions={
          <Button asChild variant="outline">
            <Link href="/chat">
              <MessageSquare className="size-4" />
              Back to chat
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Archived chats"
          value={archivedChats.length}
          icon={<Archive className="size-4" />}
        />
        <StatCard
          label="Most recent archive"
          value={archivedChats[0]?.archivedAt ? formatDate(archivedChats[0].archivedAt) : "—"}
          icon={<ArchiveRestore className="size-4" />}
        />
      </div>

      <Card>
        <CardContent className="pt-6">
          {archivedChats.length === 0 ? (
            <p className="text-sm text-muted-foreground">No archived chats yet.</p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Title</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Archived</TableHead>
                    <TableHead className="w-[220px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {archivedChats.map((chat) => (
                    <TableRow key={chat.id}>
                      <TableCell className="font-medium">{chat.title || "Untitled chat"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(chat.createdAt)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {chat.archivedAt ? formatDate(chat.archivedAt) : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/chat/${chat.id}`}>Open</Link>
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => restoreChat.mutate(chat.id)}
                            disabled={restoreChat.isPending}
                          >
                            <ArchiveRestore className="size-4" />
                            Restore
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setDeleteConfirmTarget(chat)}
                            disabled={deleteChat.isPending}
                          >
                            <Trash2 className="size-4" />
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(deleteConfirmTarget)}
        onOpenChange={(open) => !open && setDeleteConfirmTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete chat</DialogTitle>
            <DialogDescription>
              This permanently deletes &quot;{deleteConfirmTarget?.title || "Untitled chat"}&quot;
              and its messages. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteConfirmTarget) {
                  deleteChat.mutate(deleteConfirmTarget.id);
                  setDeleteConfirmTarget(null);
                }
              }}
              disabled={deleteChat.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
