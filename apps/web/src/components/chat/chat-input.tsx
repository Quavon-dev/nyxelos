"use client";

import { ArrowUp } from "lucide-react";
import { useState } from "react";
import {
  type AttachedFile,
  ChatComposerToolbar,
  type ChatToolSelection,
} from "@/components/chat/chat-composer-toolbar";
import { Textarea } from "@/components/ui/textarea";

interface MessageLike {
  role: string;
  content: string;
}

export function ChatInput({
  onSend,
  disabled,
  workspaceId,
  toolSelection,
  onToolSelectionChange,
  attachedFile,
  onAttachedFileChange,
  messages,
  assistantQuestion,
}: {
  onSend: (message: string) => void;
  disabled?: boolean;
  workspaceId: string | undefined;
  toolSelection: ChatToolSelection | null;
  onToolSelectionChange: (next: ChatToolSelection | null) => void;
  attachedFile: AttachedFile | null;
  onAttachedFileChange: (file: AttachedFile | null) => void;
  messages: MessageLike[];
  assistantQuestion: string | null;
}) {
  const [value, setValue] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || disabled) return;

    // Same client-side "file search" behavior as the landing page: fold the
    // attached file's text straight into the outgoing message.
    const outgoing = attachedFile
      ? `${value.trim()}\n\n---\nAttached file: ${attachedFile.name}\n\`\`\`\n${attachedFile.content}\n\`\`\``
      : value.trim();

    onSend(outgoing);
    setValue("");
    onAttachedFileChange(null);
  }

  const placeholder = assistantQuestion ? "Answer the question…" : "Message Nyxel…";

  return (
    <form onSubmit={handleSubmit} className="pt-4">
      <div className="space-y-1 rounded-2xl border bg-card p-2 shadow-sm">
        {assistantQuestion && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            Nyxel asked: <span className="text-foreground">{assistantQuestion}</span>
          </div>
        )}
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="max-h-40 min-h-9 resize-none border-0 p-1.5 shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center gap-2 px-0.5">
          <div className="min-w-0 flex-1">
            <ChatComposerToolbar
              mode="compact"
              workspaceId={workspaceId}
              toolSelection={toolSelection}
              onToolSelectionChange={onToolSelectionChange}
              attachedFile={attachedFile}
              onAttachedFileChange={onAttachedFileChange}
              onVoiceResult={(text) => setValue((prev) => (prev ? `${prev} ${text}` : text))}
              messages={messages}
            />
          </div>
          <button
            type="submit"
            disabled={disabled || !value.trim()}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </div>
    </form>
  );
}
