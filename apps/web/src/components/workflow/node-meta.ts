import {
  CheckCircle2,
  Clapperboard,
  FileVideo,
  ImagePlus,
  type LucideIcon,
  Scissors,
  Sparkles,
  Type,
} from "lucide-react";
import type { WorkflowNodeKind } from "@/lib/trpc";

export interface NodeKindMeta {
  kind: WorkflowNodeKind;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Whether this kind accepts an incoming edge / produces an outgoing one —
   * drives which handles WorkflowNode renders and what the palette explains. */
  hasInput: boolean;
  hasOutput: boolean;
}

export const NODE_KIND_META: Record<WorkflowNodeKind, NodeKindMeta> = {
  text_prompt: {
    kind: "text_prompt",
    label: "Text Prompt",
    description: "A fixed piece of prompt text to feed downstream nodes.",
    icon: Type,
    hasInput: false,
    hasOutput: true,
  },
  image_upload: {
    kind: "image_upload",
    label: "Image",
    description: "An existing image from the Library.",
    icon: ImagePlus,
    hasInput: false,
    hasOutput: true,
  },
  video_upload: {
    kind: "video_upload",
    label: "Video",
    description: "An existing video from the Library.",
    icon: FileVideo,
    hasInput: false,
    hasOutput: true,
  },
  generate_image: {
    kind: "generate_image",
    label: "Generate Image",
    description: "Generate an image from a prompt (and optional reference image).",
    icon: Sparkles,
    hasInput: true,
    hasOutput: true,
  },
  generate_video: {
    kind: "generate_video",
    label: "Generate Video",
    description: "Generate a video from a prompt (and optional reference image).",
    icon: Clapperboard,
    hasInput: true,
    hasOutput: true,
  },
  edit_video: {
    kind: "edit_video",
    label: "Edit Video",
    description: "Trim, mute, adjust volume/speed, extract a frame, or render a GIF.",
    icon: Scissors,
    hasInput: true,
    hasOutput: true,
  },
  output: {
    kind: "output",
    label: "Output",
    description: "Marks a result as one of this workflow's final outputs.",
    icon: CheckCircle2,
    hasInput: true,
    hasOutput: false,
  },
};

export const NODE_KIND_ORDER: WorkflowNodeKind[] = [
  "text_prompt",
  "image_upload",
  "video_upload",
  "generate_image",
  "generate_video",
  "edit_video",
  "output",
];

/** Starting `data` for a freshly dropped node of this kind — every field the
 * inspector edits gets a defined (if empty) value so it's never reading off
 * `undefined`. */
export function defaultNodeData(kind: WorkflowNodeKind): Record<string, unknown> {
  switch (kind) {
    case "text_prompt":
      return { prompt: "" };
    case "image_upload":
    case "video_upload":
      return { libraryFileId: null };
    case "generate_image":
      return { prompt: "", model: undefined, size: undefined };
    case "generate_video":
      return { prompt: "", model: undefined, size: undefined, seconds: undefined };
    case "edit_video":
      return { operation: "trim" };
    case "output":
      return { label: "" };
  }
}
