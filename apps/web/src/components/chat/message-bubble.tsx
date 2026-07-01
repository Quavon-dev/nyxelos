import { parseAssistantContent } from "@/lib/chat-prompts";
import { cn } from "@/lib/utils";
import { MultiSelectPromptCard } from "./multi-select-prompt";

export function MessageBubble({ sender, content }: { sender: string; content: string }) {
  const isUser = sender === "user";
  const parsed = !isUser ? parseAssistantContent(content) : null;
  const body = parsed?.body || content;
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
      >
        {parsed?.prompt ? (
          <div className="space-y-2">
            {body && <div>{body}</div>}
            <MultiSelectPromptCard prompt={parsed.prompt} mode="preview" />
          </div>
        ) : (
          content
        )}
      </div>
    </div>
  );
}
