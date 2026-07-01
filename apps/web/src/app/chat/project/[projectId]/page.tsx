"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Folder, MessagesSquare, Pencil, Plus, Trash2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ChatListItem } from "@/components/chat/chat-list-item";
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
import { type ChatSummary, trpcClient } from "@/lib/trpc";
import { useInstallation } from "@/lib/use-installation";

export default function ProjectPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const router = useRouter();
  const queryClient = useQueryClient();
  const installationQuery = useInstallation();
  const workspaceId = installationQuery.data?.record?.primaryWorkspaceId;

  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameChatTarget, setRenameChatTarget] = useState<ChatSummary | null>(null);
  const [renameChatTitle, setRenameChatTitle] = useState("");
  const [deleteChatTarget, setDeleteChatTarget] = useState<ChatSummary | null>(null);
  const [shareTarget, setShareTarget] = useState<ChatSummary | null>(null);

  const projectQuery = useQuery({
    queryKey: ["projects", "get", projectId],
    queryFn: () => trpcClient.projects.get.query({ projectId }),
    enabled: Boolean(projectId),
  });

  const chatsQuery = useQuery({
    queryKey: ["chats", "byProject", projectId],
    queryFn: () => trpcClient.chats.listByProject.query({ projectId }),
    enabled: Boolean(projectId),
  });

  const projectsQuery = useQuery({
    queryKey: ["projects", workspaceId],
    queryFn: () => trpcClient.projects.list.query({ workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
  });

  const models = useQuery({
    queryKey: ["models", "list", workspaceId],
    queryFn: () => trpcClient.models.list.query({ workspaceId }),
    enabled: Boolean(workspaceId),
  });

  const project = projectQuery.data;
  const chats = chatsQuery.data ?? [];
  const projects = projectsQuery.data ?? [];

  function invalidateChats() {
    queryClient.invalidateQueries({
      queryKey: ["chats", "byProject", projectId],
    });
    queryClient.invalidateQueries({ queryKey: ["chats", workspaceId] });
  }

  const renameProject = useMutation({
    mutationFn: (newName: string) =>
      trpcClient.projects.rename.mutate({ projectId, name: newName }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["projects", "get", projectId],
      });
      queryClient.invalidateQueries({ queryKey: ["projects", workspaceId] });
      setRenameOpen(false);
    },
  });

  const deleteProject = useMutation({
    mutationFn: () => trpcClient.projects.delete.mutate({ projectId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects", workspaceId] });
      router.push("/chat");
    },
  });

  const renameChat = useMutation({
    mutationFn: ({ chatId, title }: { chatId: string; title: string }) =>
      trpcClient.chats.rename.mutate({ chatId, title }),
    onSuccess: () => {
      invalidateChats();
      setRenameChatTarget(null);
    },
  });

  const archiveChat = useMutation({
    mutationFn: (chatId: string) => trpcClient.chats.setArchived.mutate({ chatId, archived: true }),
    onSuccess: invalidateChats,
  });

  const deleteChat = useMutation({
    mutationFn: (chatId: string) => trpcClient.chats.delete.mutate({ chatId }),
    onSuccess: () => {
      invalidateChats();
      setDeleteChatTarget(null);
    },
  });

  const pinChat = useMutation({
    mutationFn: ({ chatId, pinned }: { chatId: string; pinned: boolean }) =>
      trpcClient.chats.setPinned.mutate({ chatId, pinned }),
    onSuccess: invalidateChats,
  });

  const duplicateChat = useMutation({
    mutationFn: (chatId: string) => trpcClient.chats.duplicate.mutate({ chatId }),
    onSuccess: (chat) => {
      invalidateChats();
      router.push(`/chat/${chat.id}`);
    },
  });

  const moveChatToProject = useMutation({
    mutationFn: ({ chatId, projectId: target }: { chatId: string; projectId: string | null }) =>
      trpcClient.chats.setProject.mutate({ chatId, projectId: target }),
    onSuccess: invalidateChats,
  });

  const shareChat = useMutation({
    mutationFn: (chatId: string) => trpcClient.chats.share.mutate({ chatId }),
    onSuccess: (chat) => setShareTarget(chat),
  });

  const unshareChat = useMutation({
    mutationFn: (chatId: string) => trpcClient.chats.unshare.mutate({ chatId }),
    onSuccess: () => setShareTarget(null),
  });

  function shareUrlFor(shareId: string) {
    if (typeof window === "undefined") return `/share/${shareId}`;
    return `${window.location.origin}/share/${shareId}`;
  }

  if (projectQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
        <PageHeaderSkeleton actions={2} />
        <StatCardsSkeleton count={2} />
      </div>
    );
  }

  if (!projectQuery.isLoading && !project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm text-muted-foreground">This project no longer exists.</p>
        <Button variant="outline" onClick={() => router.push("/chat")}>
          Back to chats
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Folder className="size-5 text-muted-foreground" />
            {project?.name ?? "Project"}
          </span>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setName(project?.name ?? "");
                setRenameOpen(true);
              }}
            >
              <Pencil className="size-4" />
              Rename
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="size-4" />
              Delete
            </Button>
            <Button
              size="sm"
              onClick={() => router.push(`/chat?projectId=${projectId}`)}
              disabled={!models.data?.length}
            >
              <Plus className="size-4" />
              New chat
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Chats"
          value={chats.length}
          icon={<MessagesSquare className="size-4" />}
        />
        <StatCard
          label="Created"
          value={
            project?.createdAt
              ? new Date(project.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : "—"
          }
          icon={<CalendarDays className="size-4" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Chats</CardTitle>
        </CardHeader>
        <CardContent>
          {chats.length === 0 ? (
            <p className="text-sm text-muted-foreground">No chats in this project yet.</p>
          ) : (
            <div className="rounded-lg border">
              {chats.map((chat, i) => (
                <div key={chat.id} className={i > 0 ? "border-t" : undefined}>
                  <ChatListItem
                    chat={chat}
                    isActive={false}
                    projects={projects}
                    actions={{
                      onRename: (c) => {
                        setRenameChatTarget(c);
                        setRenameChatTitle(c.title);
                      },
                      onDuplicate: (c) => duplicateChat.mutate(c.id),
                      onShare: (c) => shareChat.mutate(c.id),
                      onTogglePin: (c) => pinChat.mutate({ chatId: c.id, pinned: !c.pinnedAt }),
                      onArchive: (c) => archiveChat.mutate(c.id),
                      onDelete: (c) => setDeleteChatTarget(c),
                      onMoveToProject: (c, target) =>
                        moveChatToProject.mutate({ chatId: c.id, projectId: target }),
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
          </DialogHeader>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && renameProject.mutate(name.trim())}
          />
          <DialogFooter showCloseButton>
            <Button
              onClick={() => name.trim() && renameProject.mutate(name.trim())}
              disabled={!name.trim() || renameProject.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete project</DialogTitle>
            <DialogDescription>
              This deletes the project. Its chats are kept and become unfiled.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button
              variant="destructive"
              onClick={() => deleteProject.mutate()}
              disabled={deleteProject.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(renameChatTarget)}
        onOpenChange={(open) => !open && setRenameChatTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
          </DialogHeader>
          <Input
            value={renameChatTitle}
            onChange={(e) => setRenameChatTitle(e.target.value)}
            maxLength={120}
          />
          <DialogFooter showCloseButton>
            <Button
              onClick={() =>
                renameChatTarget &&
                renameChatTitle.trim() &&
                renameChat.mutate({
                  chatId: renameChatTarget.id,
                  title: renameChatTitle.trim(),
                })
              }
              disabled={!renameChatTitle.trim() || renameChat.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleteChatTarget)}
        onOpenChange={(open) => !open && setDeleteChatTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete chat</DialogTitle>
            <DialogDescription>
              This permanently deletes the chat and its messages. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button
              variant="destructive"
              onClick={() => deleteChatTarget && deleteChat.mutate(deleteChatTarget.id)}
              disabled={deleteChat.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(shareTarget)} onOpenChange={(open) => !open && setShareTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share chat</DialogTitle>
            <DialogDescription>
              Anyone with this link can view a read-only copy of this conversation.
            </DialogDescription>
          </DialogHeader>
          {shareTarget?.shareId && (
            <Input readOnly value={shareUrlFor(shareTarget.shareId)} className="text-sm" />
          )}
          <DialogFooter showCloseButton>
            <Button
              variant="destructive"
              onClick={() => shareTarget && unshareChat.mutate(shareTarget.id)}
              disabled={unshareChat.isPending}
            >
              Stop sharing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
