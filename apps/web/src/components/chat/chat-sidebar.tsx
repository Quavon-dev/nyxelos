"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Compass,
  Ellipsis,
  History,
  LibraryBig,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { type ChatSummary, trpcClient } from "@/lib/trpc";
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

export function ChatSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const installationQuery = useInstallation();
  const workspaceId = installationQuery.data?.record?.primaryWorkspaceId;
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [renameTarget, setRenameTarget] = useState<ChatSummary | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ChatSummary | null>(null);

  const chatsQuery = useQuery({
    queryKey: ["chats", workspaceId],
    queryFn: () => trpcClient.chats.list.query({ workspaceId: workspaceId! }),
    enabled: Boolean(workspaceId),
  });

  const chats = chatsQuery.data ?? [];
  const filtered = useMemo(() => {
    if (!search.trim()) return chats;
    const q = search.trim().toLowerCase();
    return chats.filter((c) => c.title.toLowerCase().includes(q));
  }, [chats, search]);
  const groups = useMemo(
    () => groupChats([...filtered].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))),
    [filtered],
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

  function openRename(chat: ChatSummary) {
    setRenameTarget(chat);
    setRenameTitle(chat.title);
  }

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
          {groups.length === 0 && (
            <p className="px-1 text-sm text-muted-foreground">
              {chats.length === 0
                ? "No chats yet — start one below."
                : "No chats match your search."}
            </p>
          )}
          {groups.map((group) => (
            <div key={group.label} className="space-y-1">
              <p className="px-1 text-xs text-muted-foreground">{group.label}</p>
              {group.chats.map((chat) => {
                const isActive = pathname === `/chat/${chat.id}`;
                return (
                  <ContextMenu key={chat.id}>
                    <ContextMenuTrigger asChild>
                      <div
                        className={cn(
                          "group flex items-center gap-1 rounded-md transition-colors",
                          isActive ? "bg-muted" : "hover:bg-muted/60",
                        )}
                      >
                        <Link
                          href={`/chat/${chat.id}`}
                          className={cn(
                            "min-w-0 flex-1 truncate px-2 py-1.5 text-sm",
                            isActive
                              ? "font-medium text-foreground"
                              : "text-foreground/80 group-hover:text-foreground",
                          )}
                        >
                          {chat.title || "Untitled chat"}
                        </Link>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                "mr-1 flex size-7 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition hover:bg-background/80 hover:text-foreground group-hover:opacity-100",
                                isActive && "opacity-100",
                              )}
                              aria-label={`Open actions for ${chat.title || "chat"}`}
                            >
                              <Ellipsis className="size-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40 min-w-40">
                            <DropdownMenuItem onClick={() => openRename(chat)}>
                              <Pencil className="size-4" />
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => archiveChat.mutate(chat.id)}>
                              <Archive className="size-4" />
                              Archive
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setDeleteTarget(chat)}
                            >
                              <Trash2 className="size-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem onClick={() => openRename(chat)}>
                        <Pencil className="size-4" />
                        Rename
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => archiveChat.mutate(chat.id)}>
                        <Archive className="size-4" />
                        Archive
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem variant="destructive" onClick={() => setDeleteTarget(chat)}>
                        <Trash2 className="size-4" />
                        Delete
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </div>
          ))}
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
    </>
  );
}
