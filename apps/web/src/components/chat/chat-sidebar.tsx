"use client";

import { useQuery } from "@tanstack/react-query";
import { MessageSquarePlus, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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
    { label: "Previous 7 days", chats: [] },
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

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r">
      <div className="space-y-3 border-b p-3">
        <Button className="w-full justify-start gap-2" onClick={() => router.push("/chat")}>
          <MessageSquarePlus className="size-4" />
          New chat
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats…"
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {groups.length === 0 && (
          <p className="px-1 text-sm text-muted-foreground">
            {chats.length === 0 ? "No chats yet — start one above." : "No chats match your search."}
          </p>
        )}
        {groups.map((group) => (
          <div key={group.label} className="space-y-1">
            <p className="px-1 text-xs font-medium text-muted-foreground">{group.label}</p>
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
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  {chat.title || "Untitled chat"}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      {workspaceId && (
        <div className="border-t p-3">
          <Link
            href={`/workspace/${workspaceId}/settings`}
            className="block rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            ← Back to workspace
          </Link>
        </div>
      )}
    </aside>
  );
}
