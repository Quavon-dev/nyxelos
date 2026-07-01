import { cn } from "@/lib/utils";

export function MessageBubble({ sender, content }: { sender: string; content: string }) {
  const isUser = sender === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-3 py-2 text-sm",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {content}
      </div>
    </div>
  );
}
