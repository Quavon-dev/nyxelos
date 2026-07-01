"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";
import {
  type AttachedFile,
  ChatComposerToolbar,
  type ChatToolSelection,
} from "@/components/chat/chat-composer-toolbar";
import { Textarea } from "@/components/ui/textarea";
import { serializeChatMessageContent } from "@/lib/chat-message";
import type { MultiSelectPrompt } from "@/lib/chat-prompts";
import type { ChatToolPolicy } from "@/lib/trpc";
import { MultiSelectPromptCard } from "./multi-select-prompt";

interface MessageLike {
  role: string;
  content: string;
}

export function ChatInput({
  onSend,
  disabled,
  workspaceId,
  modelId,
  toolSelection,
  onToolSelectionChange,
  chatToolPolicy,
  onChatToolPolicyChange,
  attachedFile,
  onAttachedFileChange,
  messages,
  assistantQuestion,
  assistantPrompt,
}: {
  onSend: (message: string) => void;
  disabled?: boolean;
  workspaceId: string | undefined;
  modelId?: string;
  toolSelection: ChatToolSelection | null;
  onToolSelectionChange: (next: ChatToolSelection | null) => void;
  chatToolPolicy: ChatToolPolicy;
  onChatToolPolicyChange: (next: ChatToolPolicy) => void;
  attachedFile: AttachedFile | null;
  onAttachedFileChange: (file: AttachedFile | null) => void;
  messages: MessageLike[];
  assistantQuestion: string | null;
  assistantPrompt: MultiSelectPrompt | null;
}) {
  const [value, setValue] = useState("");
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const promptKey = assistantPrompt
    ? `${assistantPrompt.question}:${assistantPrompt.options.map((option) => option.id).join(",")}`
    : "none";

  useEffect(() => {
    if (promptKey !== "none") {
      setSelectedOptionIds([]);
    }
  }, [promptKey]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;

    const selectedLabels = assistantPrompt
      ? assistantPrompt.options
          .filter((option) => selectedOptionIds.includes(option.id))
          .map((option) => option.label)
      : [];

    if (!value.trim() && selectedLabels.length === 0 && !attachedFile) return;

    // Attachments are stored inline as a structured envelope so the chat can
    // render them later without needing a separate upload backend yet.
    const answerText =
      assistantPrompt && selectedLabels.length > 0
        ? [
            `Selected answers: ${selectedLabels.join("; ")}`,
            value.trim() ? `Note: ${value.trim()}` : null,
          ]
            .filter(Boolean)
            .join("\n")
        : value.trim();

    const outgoing = attachedFile
      ? serializeChatMessageContent(answerText, [attachedFile])
      : answerText;

    onSend(outgoing);
    setValue("");
    setSelectedOptionIds([]);
    onAttachedFileChange(null);
  }

  const placeholder = assistantPrompt
    ? "Add an optional note…"
    : assistantQuestion
      ? "Answer the question…"
      : "Message Nyxel…";

  function toggleOption(optionId: string) {
    setSelectedOptionIds((current) =>
      current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId],
    );
  }

  return (
    <form onSubmit={handleSubmit} className="pt-4">
      <div className="space-y-1 rounded-2xl border bg-card p-2 shadow-sm">
        {assistantPrompt && (
          <MultiSelectPromptCard
            prompt={assistantPrompt}
            mode="interactive"
            selectedIds={selectedOptionIds}
            onToggle={toggleOption}
            onClear={() => setSelectedOptionIds([])}
            note="Die Auswahl wird zusammen mit einer optionalen Notiz als Antwort gespeichert."
          />
        )}
        {!assistantPrompt && assistantQuestion && (
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
          rows={assistantPrompt ? 2 : 1}
          className="max-h-40 min-h-9 resize-none border-0 p-1.5 shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center gap-2 px-0.5">
          <div className="min-w-0 flex-1">
            <ChatComposerToolbar
              mode="compact"
              workspaceId={workspaceId}
              modelId={modelId}
              toolSelection={toolSelection}
              onToolSelectionChange={onToolSelectionChange}
              chatToolPolicy={chatToolPolicy}
              onChatToolPolicyChange={onChatToolPolicyChange}
              attachedFile={attachedFile}
              onAttachedFileChange={onAttachedFileChange}
              onVoiceResult={(text) => setValue((prev) => (prev ? `${prev} ${text}` : text))}
              messages={messages}
            />
          </div>
          <button
            type="submit"
            disabled={
              disabled ||
              (!value.trim() &&
                (!assistantPrompt || selectedOptionIds.length === 0) &&
                !attachedFile)
            }
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </div>
    </form>
  );
}
