"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  Compass,
  Copy,
  FolderPlus,
  History,
  LibraryBig,
  Plus,
  Search,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ChatListItem } from "@/components/chat/chat-list-item";
import { ProjectAppearancePicker } from "@/components/chat/project-appearance-picker";
import { ProjectListItem } from "@/components/chat/project-list-item";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ProjectColor, ProjectIcon } from "@/lib/project-appearance";
import { type ChatSummary, type ProjectSummary, trpcClient } from "@/lib/trpc";
import { useInstallation } from "@/lib/use-installation";
import { cn } from "@/lib/utils";

function groupChats(chats: ChatSummary[]) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const sevenDaysAgo = new Date(startOfToday);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const groups: { label: string; chats: ChatSummary[] }[] = [
    { label: "Today", chats: [] },
    { label: "Yesterday", chats: [] },
    { label: "7 Days Ago", chats: [] },
    { label: "Older", chats: [] },
  ];

  for (const chat of chats) {
    const createdAt = new Date(chat.createdAt);
    if (createdAt >= startOfToday) groups[0]?.chats.push(chat);
    else if (createdAt >= startOfYesterday) groups[1]?.chats.push(chat);
    else if (createdAt >= sevenDaysAgo) groups[2]?.chats.push(chat);
    else groups[3]?.chats.push(chat);
  }

  return groups.filter((g) => g.chats.length > 0);
}

function shareUrlFor(shareId: string) {
  if (typeof window === "undefined") return `/share/${shareId}`;
  return `${window.location.origin}/share/${shareId}`;
}

export function ChatSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const installationQuery = useInstallation();
  const workspaceId = installationQuery.data?.record?.primaryWorkspaceId;
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  function toggleGroup(label: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  const [renameTarget, setRenameTarget] = useState<ChatSummary | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ChatSummary | null>(null);
  const [shareTarget, setShareTarget] = useState<ChatSummary | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const [projectDialog, setProjectDialog] = useState<
    { mode: "create" } | { mode: "rename"; project: ProjectSummary } | null
  >(null);
  const [projectName, setProjectName] = useState("");
  const [projectColor, setProjectColor] = useState<ProjectColor>("gray");
  const [projectIcon, setProjectIcon] = useState<ProjectIcon>("folder");
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<ProjectSummary | null>(null);

  const chatsQuery = useQuery({
    queryKey: ["chats", workspaceId],
    queryFn: () => trpcClient.chats.list.query({ workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
  });

  const projectsQuery = useQuery({
    queryKey: ["projects", workspaceId],
    queryFn: () => trpcClient.projects.list.query({ workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
  });
  const projects = projectsQuery.data ?? [];

  const chats = chatsQuery.data ?? [];
  const filtered = useMemo(() => {
    if (!search.trim()) return chats;
    const q = search.trim().toLowerCase();
    return chats.filter((c) => c.title.toLowerCase().includes(q));
  }, [chats, search]);

  const pinnedChats = useMemo(
    () =>
      filtered
        .filter((c) => c.pinnedAt)
        .sort((a, b) => +new Date(b.pinnedAt ?? 0) - +new Date(a.pinnedAt ?? 0)),
    [filtered],
  );
  const unpinnedChats = useMemo(() => filtered.filter((c) => !c.pinnedAt), [filtered]);
  const groups = useMemo(
    () =>
      groupChats(
        [...unpinnedChats].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
      ),
    [unpinnedChats],
  );

  const bottomNav = [
    { label: "Explore", icon: Compass, href: "/" },
    {
      label: "Library",
      icon: LibraryBig,
      href: workspaceId ? `/workspace/${workspaceId}/knowledge-base` : "/",
    },
    {
      label: "History",
      icon: History,
      href: workspaceId ? `/workspace/${workspaceId}/audit-log` : "/",
    },
  ];

  function invalidateChats() {
    queryClient.invalidateQueries({ queryKey: ["chats", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["chats", "list", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["chats", "archived", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["chats", "byProject"] });
  }

  function invalidateProjects() {
    queryClient.invalidateQueries({ queryKey: ["projects", workspaceId] });
  }

  const renameChat = useMutation({
    mutationFn: ({ chatId, title }: { chatId: string; title: string }) =>
      trpcClient.chats.rename.mutate({ chatId, title }),
    onSuccess: () => {
      invalidateChats();
      setRenameTarget(null);
      setRenameTitle("");
    },
  });

  const archiveChat = useMutation({
    mutationFn: (chatId: string) => trpcClient.chats.setArchived.mutate({ chatId, archived: true }),
    onSuccess: (chat) => {
      invalidateChats();
      if (pathname === `/chat/${chat.id}`) {
        router.push(workspaceId ? `/workspace/${workspaceId}/archive` : "/chat");
      }
    },
  });

  const deleteChat = useMutation({
    mutationFn: (chatId: string) => trpcClient.chats.delete.mutate({ chatId }),
    onSuccess: (_, chatId) => {
      invalidateChats();
      if (pathname === `/chat/${chatId}`) router.push("/chat");
      setDeleteTarget(null);
    },
  });

  const pinChat = useMutation({
    mutationFn: ({ chatId, pinned }: { chatId: string; pinned: boolean }) =>
      trpcClient.chats.setPinned.mutate({ chatId, pinned }),
    onSuccess: invalidateChats,
  });

  const moveChatToProject = useMutation({
    mutationFn: ({ chatId, projectId }: { chatId: string; projectId: string | null }) =>
      trpcClient.chats.setProject.mutate({ chatId, projectId }),
    onSuccess: invalidateChats,
  });

  const duplicateChat = useMutation({
    mutationFn: (chatId: string) => trpcClient.chats.duplicate.mutate({ chatId }),
    onSuccess: (chat) => {
      invalidateChats();
      router.push(`/chat/${chat.id}`);
    },
  });

  const shareChat = useMutation({
    mutationFn: (chatId: string) => trpcClient.chats.share.mutate({ chatId }),
    onSuccess: (chat) => {
      invalidateChats();
      setShareTarget(chat);
    },
  });

  const unshareChat = useMutation({
    mutationFn: (chatId: string) => trpcClient.chats.unshare.mutate({ chatId }),
    onSuccess: () => {
      invalidateChats();
      setShareTarget(null);
    },
  });

  const createProject = useMutation({
    mutationFn: ({ name, color, icon }: { name: string; color: string; icon: string }) =>
      trpcClient.projects.create.mutate({ workspaceId: workspaceId!, name, color, icon }),
    onSuccess: (project) => {
      invalidateProjects();
      setProjectDialog(null);
      setProjectName("");
      router.push(`/chat/project/${project.id}`);
    },
  });

  const renameProject = useMutation({
    mutationFn: ({
      projectId,
      name,
      color,
      icon,
    }: {
      projectId: string;
      name: string;
      color: string;
      icon: string;
    }) =>
      trpcClient.projects.rename
        .mutate({ projectId, name })
        .then(() => trpcClient.projects.setAppearance.mutate({ projectId, color, icon })),
    onSuccess: () => {
      invalidateProjects();
      setProjectDialog(null);
      setProjectName("");
    },
  });

  const duplicateProject = useMutation({
    mutationFn: (projectId: string) => trpcClient.projects.duplicate.mutate({ projectId }),
    onSuccess: (project) => {
      invalidateProjects();
      invalidateChats();
      router.push(`/chat/project/${project.id}`);
    },
  });

  const deleteProject = useMutation({
    mutationFn: (projectId: string) => trpcClient.projects.delete.mutate({ projectId }),
    onSuccess: (_, projectId) => {
      invalidateProjects();
      invalidateChats();
      setDeleteProjectTarget(null);
      if (pathname === `/chat/project/${projectId}`) router.push("/chat");
    },
  });

  function openRename(chat: ChatSummary) {
    setRenameTarget(chat);
    setRenameTitle(chat.title);
  }

  function openShare(chat: ChatSummary) {
    setLinkCopied(false);
    setShareTarget(chat);
    shareChat.mutate(chat.id);
  }

  async function copyShareLink() {
    if (!shareTarget?.shareId) return;
    try {
      await navigator.clipboard.writeText(shareUrlFor(shareTarget.shareId));
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by the browser — the link is still
      // visible and selectable in the input, so this is a soft failure.
    }
  }

  function openCreateProject() {
    setProjectDialog({ mode: "create" });
    setProjectName("");
    setProjectColor("gray");
    setProjectIcon("folder");
  }

  function openRenameProject(project: ProjectSummary) {
    setProjectDialog({ mode: "rename", project });
    setProjectName(project.name);
    setProjectColor((project.color as ProjectColor) || "gray");
    setProjectIcon((project.icon as ProjectIcon) || "folder");
  }

  function saveProject() {
    const name = projectName.trim();
    if (!name || !projectDialog) return;
    if (projectDialog.mode === "create") {
      createProject.mutate({ name, color: projectColor, icon: projectIcon });
    } else {
      renameProject.mutate({
        projectId: projectDialog.project.id,
        name,
        color: projectColor,
        icon: projectIcon,
      });
    }
  }

  const chatActions = {
    onRename: openRename,
    onDuplicate: (chat: ChatSummary) => duplicateChat.mutate(chat.id),
    onShare: openShare,
    onTogglePin: (chat: ChatSummary) => pinChat.mutate({ chatId: chat.id, pinned: !chat.pinnedAt }),
    onArchive: (chat: ChatSummary) => archiveChat.mutate(chat.id),
    onDelete: (chat: ChatSummary) => setDeleteTarget(chat),
    onMoveToProject: (chat: ChatSummary, projectId: string | null) =>
      moveChatToProject.mutate({ chatId: chat.id, projectId }),
  };

  return (
    <>
      <aside className="flex h-full w-72 shrink-0 flex-col border-r bg-background">
        <div className="p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats…"
              className="h-9 border-none bg-muted pl-8 text-sm shadow-none focus-visible:ring-1"
            />
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-3 pb-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between px-1">
              <button
                type="button"
                onClick={() => setProjectsOpen((open) => !open)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ChevronDown
                  className={cn("size-3.5 transition-transform", !projectsOpen && "-rotate-90")}
                />
                Projects
              </button>
              <button
                type="button"
                onClick={openCreateProject}
                className="flex size-6 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="New project"
              >
                <Plus className="size-3.5" />
              </button>
            </div>

            {projectsOpen && (
              <div className="space-y-0.5">
                {projects.length === 0 ? (
                  <button
                    type="button"
                    onClick={openCreateProject}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  >
                    <FolderPlus className="size-4" />
                    New project
                  </button>
                ) : (
                  projects.map((project) => (
                    <ProjectListItem
                      key={project.id}
                      project={project}
                      isActive={pathname === `/chat/project/${project.id}`}
                      onRename={openRenameProject}
                      onDuplicate={(p) => duplicateProject.mutate(p.id)}
                      onDelete={setDeleteProjectTarget}
                    />
                  ))
                )}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <p className="px-1 text-xs text-muted-foreground">Chats</p>

            {pinnedChats.length === 0 && groups.length === 0 && (
              <p className="px-1 text-sm text-muted-foreground">
                {chats.length === 0
                  ? "No chats yet — start one below."
                  : "No chats match your search."}
              </p>
            )}

            {pinnedChats.length > 0 && (
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => toggleGroup("Pinned")}
                  className="flex items-center gap-1 px-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown
                    className={cn(
                      "size-3 transition-transform",
                      collapsedGroups.has("Pinned") && "-rotate-90",
                    )}
                  />
                  Pinned
                </button>
                {!collapsedGroups.has("Pinned") &&
                  pinnedChats.map((chat) => (
                    <ChatListItem
                      key={chat.id}
                      chat={chat}
                      isActive={pathname === `/chat/${chat.id}`}
                      projects={projects}
                      actions={chatActions}
                    />
                  ))}
              </div>
            )}

            {groups.map((group) => (
              <div key={group.label} className="space-y-1">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  className="flex items-center gap-1 px-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown
                    className={cn(
                      "size-3 transition-transform",
                      collapsedGroups.has(group.label) && "-rotate-90",
                    )}
                  />
                  {group.label}
                </button>
                {!collapsedGroups.has(group.label) &&
                  group.chats.map((chat) => (
                    <ChatListItem
                      key={chat.id}
                      chat={chat}
                      isActive={pathname === `/chat/${chat.id}`}
                      projects={projects}
                      actions={chatActions}
                    />
                  ))}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3 border-t p-3">
          <nav className="space-y-0.5">
            {bottomNav.map((item) => (
              <Button
                key={item.label}
                asChild
                variant="ghost"
                className="h-10 w-full justify-start gap-2.5 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Link href={item.href}>
                  <item.icon className="size-4" />
                  {item.label}
                </Link>
              </Button>
            ))}
          </nav>

          <button
            type="button"
            onClick={() => router.push("/chat")}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            <Plus className="size-4" />
            New Chat
          </button>
        </div>
      </aside>

      <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
            <DialogDescription>Give this chat a clearer title for the sidebar.</DialogDescription>
          </DialogHeader>
          <Input
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            placeholder="Chat title"
            maxLength={120}
          />
          <DialogFooter showCloseButton>
            <Button
              onClick={() =>
                renameTarget &&
                renameTitle.trim() &&
                renameChat.mutate({ chatId: renameTarget.id, title: renameTitle.trim() })
              }
              disabled={!renameTitle.trim() || renameChat.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
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
              onClick={() => deleteTarget && deleteChat.mutate(deleteTarget.id)}
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
          {shareTarget?.shareId ? (
            <div className="flex items-center gap-2">
              <Input readOnly value={shareUrlFor(shareTarget.shareId)} className="text-sm" />
              <Button type="button" variant="outline" size="sm" onClick={copyShareLink}>
                {linkCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Generating link…</p>
          )}
          <DialogFooter showCloseButton>
            <Button
              variant="destructive"
              onClick={() => shareTarget && unshareChat.mutate(shareTarget.id)}
              disabled={unshareChat.isPending || !shareTarget?.shareId}
            >
              Stop sharing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(projectDialog)}
        onOpenChange={(open) => !open && setProjectDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {projectDialog?.mode === "create" ? "New project" : "Rename project"}
            </DialogTitle>
            <DialogDescription>
              Projects group related chats together in the sidebar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Project name"
              maxLength={120}
              onKeyDown={(e) => e.key === "Enter" && saveProject()}
            />
            <ProjectAppearancePicker
              color={projectColor}
              icon={projectIcon}
              onColorChange={setProjectColor}
              onIconChange={setProjectIcon}
            />
          </div>
          <DialogFooter showCloseButton>
            <Button
              onClick={saveProject}
              disabled={!projectName.trim() || createProject.isPending || renameProject.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleteProjectTarget)}
        onOpenChange={(open) => !open && setDeleteProjectTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete project</DialogTitle>
            <DialogDescription>
              This deletes the "{deleteProjectTarget?.name}" project. Its chats are kept and simply
              become unfiled.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button
              variant="destructive"
              onClick={() => deleteProjectTarget && deleteProject.mutate(deleteProjectTarget.id)}
              disabled={deleteProject.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
