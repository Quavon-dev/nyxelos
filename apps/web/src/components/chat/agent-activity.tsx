"use client";

import {
  ChevronDown,
  FilePlus,
  FileSearch,
  FileText,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Lightbulb,
  Loader2,
  Move,
  Pencil,
  Scissors,
  Trash2,
  Users,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import type { AgentActivityStep } from "@/lib/chat-agent-activity";
import { libraryFileUrl } from "@/lib/trpc";
import { MarkdownContent } from "./markdown-content";

const STEP_META: Record<string, { verb: string; icon: typeof FileText }> = {
  workspace_file_read: { verb: "Read", icon: FileText },
  workspace_file_read_range: { verb: "Read", icon: FileText },
  workspace_file_stat: { verb: "Checked", icon: FileSearch },
  workspace_file_list: { verb: "Listed", icon: FolderOpen },
  workspace_file_write: { verb: "Written", icon: FilePlus },
  workspace_file_append: { verb: "Appended", icon: FilePlus },
  workspace_file_patch: { verb: "Edited", icon: Pencil },
  workspace_file_move: { verb: "Moved", icon: Move },
  workspace_file_delete: { verb: "Deleted", icon: Trash2 },
  write_note: { verb: "Note created", icon: FilePlus },
  delegate_to_agent: { verb: "Delegated", icon: Users },
  generate_image: { verb: "Image generated", icon: ImageIcon },
  generate_video: { verb: "Video generated", icon: Film },
  edit_video: { verb: "Video edited", icon: Scissors },
};

/** Matches the `{ mimeType, base64 }` shape shared by generate_image,
 * browser_screenshot, and file_view_image's tool output — any tool step
 * carrying that shape gets rendered as an actual image instead of a raw
 * JSON dump. */
function generatedImageFromOutput(output: unknown): { mimeType: string; base64: string } | null {
  if (!output || typeof output !== "object") return null;
  const record = output as Record<string, unknown>;
  if (
    typeof record.mimeType === "string" &&
    record.mimeType.startsWith("image/") &&
    typeof record.base64 === "string" &&
    record.base64.length > 0
  ) {
    return { mimeType: record.mimeType, base64: record.base64 };
  }
  return null;
}

/** Library file ids are server-generated randomUUID()s — anything else in a
 * tool-output payload is malformed or attacker-shaped and must not reach a
 * media src URL. */
const LIBRARY_FILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Matches the `{ mimeType, libraryFileId }` shape shared by generate_video
 * and edit_video's tool output — unlike generate_image, a video clip is
 * megabytes, far too large to inline as base64 in every persisted chat
 * message, so these tools save straight to the library and hand back an id
 * to resolve through libraryFileUrl() instead. edit_video's extractFrame/
 * toGif operations reuse this same shape with an image/* mimeType. Ids are
 * validated against the UUID shape so untrusted tool output can never smuggle
 * arbitrary URL content into the rendered <video>/<img> src. */
function generatedMediaFromOutput(
  output: unknown,
): { mimeType: string; libraryFileId: string; posterLibraryFileId: string | null } | null {
  if (!output || typeof output !== "object") return null;
  const record = output as Record<string, unknown>;
  if (
    typeof record.mimeType === "string" &&
    (record.mimeType.startsWith("video/") || record.mimeType.startsWith("image/")) &&
    typeof record.libraryFileId === "string" &&
    LIBRARY_FILE_ID_PATTERN.test(record.libraryFileId)
  ) {
    return {
      mimeType: record.mimeType,
      libraryFileId: record.libraryFileId,
      posterLibraryFileId:
        typeof record.posterLibraryFileId === "string" &&
        LIBRARY_FILE_ID_PATTERN.test(record.posterLibraryFileId)
          ? record.posterLibraryFileId
          : null,
    };
  }
  return null;
}

function stepMeta(name: string) {
  return STEP_META[name] ?? { verb: "Used", icon: Wrench };
}

function stepTarget(step: AgentActivityStep): string {
  const input = step.input;
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    if (typeof record.path === "string") return record.path;
    if (typeof record.toPath === "string") return record.toPath;
    if (typeof record.prompt === "string") return record.prompt;
  }
  return step.name;
}

/** Only workspace_file_patch results carry a unified-diff-style preview
 * (see buildUnifiedDiffPreview in packages/skills-sdk) — everything else has
 * nothing to count, so this quietly returns null rather than a fake 0/0. */
function diffStats(output: unknown): { added: number; removed: number } | null {
  if (!output || typeof output !== "object") return null;
  const diffPreview = (output as Record<string, unknown>).diffPreview;
  if (typeof diffPreview !== "string") return null;

  let added = 0;
  let removed = 0;
  for (const line of diffPreview.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return added || removed ? { added, removed } : null;
}

function ToolStepRow({ step }: { step: AgentActivityStep }) {
  const [open, setOpen] = useState(false);
  const { verb, icon: Icon } = stepMeta(step.name);
  const target = stepTarget(step);
  const stats = diffStats(step.output);
  const running = step.output === undefined && !step.error;
  const isImageGeneration = step.name === "generate_image";
  const isVideoStep = step.name === "generate_video" || step.name === "edit_video";
  const generatedImage = generatedImageFromOutput(step.output);
  const generatedMedia = generatedMediaFromOutput(step.output);
  const detail = step.error
    ? step.error
    : step.output !== undefined && !generatedImage && !generatedMedia
      ? JSON.stringify(step.output, null, 2)
      : null;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/30">
      <button
        type="button"
        onClick={() => detail && setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs"
      >
        {running ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className={step.error ? "text-destructive" : "text-foreground"}>{verb}</span>
        <code className="truncate rounded bg-background/80 px-1 py-0.5 font-mono text-[11px] text-muted-foreground">
          {target}
        </code>
        {stats && (
          <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[11px]">
            <span className="text-emerald-600 dark:text-emerald-400">+{stats.added}</span>
            <span className="text-red-600 dark:text-red-400">-{stats.removed}</span>
          </span>
        )}
        {detail && (
          <ChevronDown
            className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${stats ? "" : "ml-auto"} ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {isImageGeneration && running && (
        <div className="border-t border-border/60 p-2.5">
          <div className="flex aspect-square w-full max-w-56 animate-pulse items-center justify-center rounded-lg border border-border/60 bg-background/50">
            <ImageIcon className="size-6 text-muted-foreground/40" />
          </div>
        </div>
      )}

      {generatedImage && (
        <div className="border-t border-border/60 p-2.5">
          <img
            src={`data:${generatedImage.mimeType};base64,${generatedImage.base64}`}
            alt={target}
            className="max-h-80 w-full max-w-56 rounded-lg border border-border/60 object-contain"
          />
        </div>
      )}

      {isVideoStep && running && (
        <div className="border-t border-border/60 p-2.5">
          <div className="flex aspect-video w-full max-w-72 animate-pulse items-center justify-center rounded-lg border border-border/60 bg-background/50">
            <Film className="size-6 text-muted-foreground/40" />
          </div>
        </div>
      )}

      {generatedMedia?.mimeType.startsWith("video/") && (
        <div className="border-t border-border/60 p-2.5">
          {/* biome-ignore lint/a11y/useMediaCaption: generated clips have no caption track to attach */}
          <video
            src={libraryFileUrl(generatedMedia.libraryFileId)}
            poster={
              generatedMedia.posterLibraryFileId
                ? libraryFileUrl(generatedMedia.posterLibraryFileId)
                : undefined
            }
            controls
            className="max-h-80 w-full max-w-72 rounded-lg border border-border/60 object-contain"
          />
        </div>
      )}

      {generatedMedia?.mimeType.startsWith("image/") && (
        <div className="border-t border-border/60 p-2.5">
          <img
            src={libraryFileUrl(generatedMedia.libraryFileId)}
            alt={target}
            className="max-h-80 w-full max-w-56 rounded-lg border border-border/60 object-contain"
          />
        </div>
      )}

      {open && detail && (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap border-t border-border/60 px-2.5 py-2 font-mono text-[11px] text-muted-foreground">
          {detail}
        </pre>
      )}
    </div>
  );
}

/**
 * Three bouncing dots — the only signal that a turn is in flight before the
 * model has emitted a single reasoning/text/tool-call event yet (e.g. still
 * doing prompt processing on a local model). Without this the UI goes
 * completely silent between hitting send and the first visible token/step,
 * which reads as "did this even go through?".
 */
export function TypingIndicator() {
  return (
    <span
      className="inline-flex items-center gap-1 py-1"
      role="status"
      aria-label="Nyxel arbeitet…"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}

/**
 * Renders a model turn's "thinking" trail — reasoning text (what Gemini
 * labels "Thoughts") and the tool calls it made, in call order. Shown live
 * while streaming and, once persisted, replayed from the trailing
 * ```nyxel-activity block on history reload — see chat-agent-activity.ts.
 */
export function AgentActivity({
  reasoning,
  steps,
  thinking = false,
}: {
  reasoning?: string;
  steps: AgentActivityStep[];
  /** True while the model is actively reasoning and hasn't produced answer
   * text yet — auto-opens the panel and shows a live "Thinking…" header so
   * thinking is visible as it happens instead of hiding behind a collapsed
   * row. Collapses again once the answer starts, unless the user pinned it. */
  thinking?: boolean;
}) {
  // null = user hasn't toggled; follow the live thinking state in that case.
  const [reasoningToggled, setReasoningToggled] = useState<boolean | null>(null);
  if (!reasoning && steps.length === 0) return null;
  const reasoningOpen = reasoningToggled ?? thinking;

  return (
    <div className="space-y-1.5">
      {reasoning && (
        <div className="rounded-lg border border-border/60 bg-muted/30">
          <button
            type="button"
            onClick={() => setReasoningToggled(!reasoningOpen)}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs font-medium text-muted-foreground"
          >
            <Lightbulb className="size-3.5 shrink-0" />
            {thinking ? <span className="thinking-shimmer">Thinking…</span> : "Thoughts"}
            <ChevronDown
              className={`ml-auto size-3.5 shrink-0 transition-transform ${reasoningOpen ? "rotate-180" : ""}`}
            />
          </button>
          {reasoningOpen && (
            <div className="border-t border-border/60 px-2.5 py-2 text-xs text-muted-foreground [&_code]:text-[0.9em] [&_pre]:text-[11px]">
              <MarkdownContent content={reasoning} />
            </div>
          )}
        </div>
      )}
      {steps.map((step) => (
        <ToolStepRow key={step.id} step={step} />
      ))}
    </div>
  );
}
