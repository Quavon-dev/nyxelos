import { cn } from "@/lib/utils";

export function MessageBubble({ sender, content }: { sender: string; content: string }) {
  const isUser = sender === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
      >
        {content}
      </div>
    </div>
  );
}
