import { parseChatMessageContent } from "@/lib/chat-message";
import { parseAssistantContent } from "@/lib/chat-prompts";
import { cn } from "@/lib/utils";
import { MultiSelectPromptCard } from "./multi-select-prompt";

export function MessageBubble({ sender, content }: { sender: string; content: string }) {
  const isUser = sender === "user";
  const parsed = !isUser ? parseAssistantContent(content) : null;
  const userAttachment = isUser ? parseChatMessageContent(content) : null;
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
        ) : userAttachment ? (
          <div className="space-y-2">
            {userAttachment.text.trim() && <div>{userAttachment.text}</div>}
            <div className="space-y-2">
              {userAttachment.attachments.map((attachment) => (
                <div
                  key={`${attachment.name}-${attachment.kind}`}
                  className="overflow-hidden rounded-xl border border-border/70 bg-background/70"
                >
                  <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
                    <span className="truncate font-medium text-foreground">
                      {attachment.name}
                    </span>
                    <span className="shrink-0 uppercase">{attachment.kind}</span>
                  </div>
                  {attachment.kind === "image" ? (
                    <img
                      src={attachment.content}
                      alt={attachment.name}
                      className="max-h-80 w-full object-contain"
                    />
                  ) : attachment.kind === "pdf" ? (
                    <iframe
                      title={attachment.name}
                      src={attachment.content}
                      className="h-80 w-full border-0 bg-background"
                    />
                  ) : (
                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap px-3 py-2 text-xs leading-relaxed">
                      {attachment.content}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          content
        )}
      </div>
    </div>
  );
}
