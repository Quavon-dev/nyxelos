"use client";

import { useQuery } from "@tanstack/react-query";
import { Compass, History, LibraryBig, Plus, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
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
  const [search, setSearch] = useState("");

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

  return (
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
            {chats.length === 0 ? "No chats yet — start one below." : "No chats match your search."}
          </p>
        )}
        {groups.map((group) => (
          <div key={group.label} className="space-y-1">
            <p className="px-1 text-xs text-muted-foreground">{group.label}</p>
            {group.chats.map((chat) => {
              const isActive = pathname === `/chat/${chat.id}`;
              return (
                <Link
                  key={chat.id}
                  href={`/chat/${chat.id}`}
                  className={cn(
                    "block truncate rounded-md px-2 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-muted font-medium text-foreground"
                      : "text-foreground/80 hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  {chat.title || "Untitled chat"}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      <div className="space-y-3 border-t p-3">
        <nav className="space-y-0.5">
          {bottomNav.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
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
  );
}
