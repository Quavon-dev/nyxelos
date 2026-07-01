"use client";

import type { ReactNode } from "react";
import { ChatSidebar } from "@/components/chat/chat-sidebar";

// 3.5rem matches the app header's fixed height (h-14) — the outer AppShell
// already gives us everything below it, so this is the full remaining
// viewport split between the chat list and the active thread.
export default function ChatLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[calc(100svh-3.5rem)] min-h-0">
      <ChatSidebar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
