"use client";

import { ArrowUp } from "lucide-react";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";

export function ChatInput({
  onSend,
  disabled,
}: {
  onSend: (message: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue("");
  }

  return (
    <form onSubmit={handleSubmit} className="border-t pt-4">
      <div className="flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-xs">
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
          placeholder="Message Nyxel…"
          disabled={disabled}
          rows={1}
          className="max-h-40 min-h-9 resize-none border-0 p-1.5 shadow-none focus-visible:ring-0"
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
        >
          <ArrowUp className="size-4" />
        </button>
      </div>
    </form>
  );
}
