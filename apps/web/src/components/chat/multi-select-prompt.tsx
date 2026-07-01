"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MultiSelectPrompt } from "@/lib/chat-prompts";

export function MultiSelectPromptCard({
  prompt,
  mode,
  selectedIds = [],
  onToggle,
  onClear,
  note,
  submitLabel = "Antwort senden",
}: {
  prompt: MultiSelectPrompt;
  mode: "interactive" | "preview";
  selectedIds?: string[];
  onToggle?: (optionId: string) => void;
  onClear?: () => void;
  note?: string;
  submitLabel?: string;
}) {
  const interactive = mode === "interactive";
  const selectedCount = selectedIds.length;

  return (
    <div className="rounded-2xl border border-primary/15 bg-primary/5 p-3 shadow-sm">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-medium leading-snug text-foreground">{prompt.question}</p>
            <p className="text-xs text-muted-foreground">
              Mehrfachauswahl möglich{interactive ? " · Auswahl wird als Antwort gespeichert" : ""}
            </p>
          </div>
          {interactive && selectedCount > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Zurücksetzen
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {prompt.options.map((option) => {
            const selected = selectedIds.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                disabled={!interactive}
                onClick={() => onToggle?.(option.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-left text-sm transition-colors",
                  interactive ? "cursor-pointer" : "cursor-default",
                  selected
                    ? "border-primary/35 bg-primary text-primary-foreground shadow-sm"
                    : "border-border/70 bg-background/70 text-foreground hover:border-primary/25 hover:bg-background",
                )}
                aria-pressed={selected}
              >
                <span
                  className={cn(
                    "flex size-4 items-center justify-center rounded-full border text-[10px]",
                    selected
                      ? "border-primary-foreground/40 bg-primary-foreground/15 text-primary-foreground"
                      : "border-border/70 bg-muted text-transparent",
                  )}
                  aria-hidden="true"
                >
                  <Check className="size-2.5" />
                </span>
                <span className="max-w-[18rem] whitespace-normal">{option.label}</span>
              </button>
            );
          })}
        </div>

        {note && <p className="text-xs text-muted-foreground">{note}</p>}

        {interactive && (
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-xs text-muted-foreground">
              {selectedCount === 0 ? "Wähle mindestens eine Antwort aus." : `${selectedCount} gewählt`}
            </p>
            <button
              type="submit"
              disabled={selectedCount === 0}
              className="rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity disabled:opacity-40"
            >
              {submitLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
