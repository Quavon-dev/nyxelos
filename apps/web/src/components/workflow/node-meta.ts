import {
  Bot,
  CheckCircle2,
  Clapperboard,
  Clock,
  FileVideo,
  GitBranch,
  Globe,
  ImagePlus,
  type LucideIcon,
  Scissors,
  Sparkles,
  Type,
} from "lucide-react";
import type { WorkflowNodeKind } from "@/lib/trpc";

export type NodeKindCategory = "Inputs" | "Generate" | "Flow" | "Output";

export interface NodeKindMeta {
  kind: WorkflowNodeKind;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Grouping for the add-node panel — matches the reference editor's
   * categorized "What happens next?" list. */
  category: NodeKindCategory;
  /** Whether this kind accepts an incoming edge / produces an outgoing one —
   * drives which handles WorkflowNode renders and what the add-node panel
   * explains. */
  hasInput: boolean;
  hasOutput: boolean;
  /** Icon chip background + text color, Tailwind classes — gives each kind
   * a distinct identity on the canvas and in the add-node panel, same idea
   * as n8n's per-integration colored icon chips. */
  accent: string;
  /** Named output handles for multi-output kinds (currently only
   * "condition"'s true/false branches) — overrides the single default
   * output handle `hasOutput` alone would render. */
  outputs?: { id: string; label: string }[];
}

export const NODE_KIND_META: Record<WorkflowNodeKind, NodeKindMeta> = {
  text_prompt: {
    kind: "text_prompt",
    category: "Inputs",
    label: "Text Prompt",
    description: "A fixed piece of prompt text to feed downstream nodes.",
    icon: Type,
    hasInput: false,
    hasOutput: true,
    accent: "bg-sky-500/15 text-sky-500",
  },
  image_upload: {
    kind: "image_upload",
    category: "Inputs",
    label: "Image",
    description: "An existing image from the Library.",
    icon: ImagePlus,
    hasInput: false,
    hasOutput: true,
    accent: "bg-violet-500/15 text-violet-500",
  },
  video_upload: {
    kind: "video_upload",
    category: "Inputs",
    label: "Video",
    description: "An existing video from the Library.",
    icon: FileVideo,
    hasInput: false,
    hasOutput: true,
    accent: "bg-violet-500/15 text-violet-500",
  },
  generate_image: {
    kind: "generate_image",
    category: "Generate",
    label: "Generate Image",
    description: "Generate an image from a prompt (and optional reference image).",
    icon: Sparkles,
    hasInput: true,
    hasOutput: true,
    accent: "bg-amber-500/15 text-amber-500",
  },
  generate_video: {
    kind: "generate_video",
    category: "Generate",
    label: "Generate Video",
    description: "Generate a video from a prompt (and optional reference image).",
    icon: Clapperboard,
    hasInput: true,
    hasOutput: true,
    accent: "bg-amber-500/15 text-amber-500",
  },
  edit_video: {
    kind: "edit_video",
    category: "Generate",
    label: "Edit Video",
    description: "Trim, mute, adjust volume/speed, extract a frame, or render a GIF.",
    icon: Scissors,
    hasInput: true,
    hasOutput: true,
    accent: "bg-rose-500/15 text-rose-500",
  },
  agent: {
    kind: "agent",
    category: "Generate",
    label: "Agent",
    description: "Hand this step off to one of the workspace's agents and use its reply.",
    icon: Bot,
    hasInput: true,
    hasOutput: true,
    accent: "bg-indigo-500/15 text-indigo-500",
  },
  http_request: {
    kind: "http_request",
    category: "Flow",
    label: "HTTP Request",
    description: "Call a URL with the connected input and capture the response as text.",
    icon: Globe,
    hasInput: true,
    hasOutput: true,
    accent: "bg-teal-500/15 text-teal-500",
  },
  delay: {
    kind: "delay",
    category: "Flow",
    label: "Delay",
    description: "Wait a fixed number of seconds before passing the input along.",
    icon: Clock,
    hasInput: true,
    hasOutput: true,
    accent: "bg-slate-500/15 text-slate-500",
  },
  condition: {
    kind: "condition",
    category: "Flow",
    label: "Condition",
    description: "Branch the workflow depending on whether the input text matches a value.",
    icon: GitBranch,
    hasInput: true,
    hasOutput: true,
    accent: "bg-fuchsia-500/15 text-fuchsia-500",
    outputs: [
      { id: "true", label: "True" },
      { id: "false", label: "False" },
    ],
  },
  output: {
    kind: "output",
    category: "Output",
    label: "Output",
    description: "Marks a result as one of this workflow's final outputs.",
    icon: CheckCircle2,
    hasInput: true,
    hasOutput: false,
    accent: "bg-emerald-500/15 text-emerald-500",
  },
};

export const NODE_KIND_ORDER: WorkflowNodeKind[] = [
  "text_prompt",
  "image_upload",
  "video_upload",
  "generate_image",
  "generate_video",
  "edit_video",
  "agent",
  "http_request",
  "delay",
  "condition",
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
    case "agent":
      return { agentId: null, instruction: "" };
    case "http_request":
      return { url: "", method: "GET" };
    case "delay":
      return { seconds: 5 };
    case "condition":
      return { value: "" };
    case "output":
      return { label: "" };
  }
}
