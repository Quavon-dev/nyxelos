import {
  Book,
  Bot,
  Boxes,
  Briefcase,
  Code2,
  Compass,
  FlaskConical,
  Folder,
  Layers,
  Lightbulb,
  type LucideIcon,
  MessageCircle,
  Rocket,
  Sparkles,
  Target,
} from "lucide-react";

// Stored on project.color / project.icon as fixed token names (not raw
// hex/svg) so the palette can be restyled later without touching data.
export const PROJECT_COLORS = [
  "gray",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "violet",
  "pink",
] as const;

export type ProjectColor = (typeof PROJECT_COLORS)[number];

const COLOR_CLASSES: Record<ProjectColor, string> = {
  gray: "bg-muted text-muted-foreground",
  red: "bg-red-500/15 text-red-700 dark:bg-red-500/10 dark:text-red-400",
  orange: "bg-orange-500/15 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400",
  amber: "bg-amber-500/15 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  green: "bg-green-500/15 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  teal: "bg-teal-500/15 text-teal-700 dark:bg-teal-500/10 dark:text-teal-400",
  blue: "bg-blue-500/15 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  indigo: "bg-indigo-500/15 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
  violet: "bg-violet-500/15 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300",
  pink: "bg-pink-500/15 text-pink-700 dark:bg-pink-500/10 dark:text-pink-400",
};

const DOT_CLASSES: Record<ProjectColor, string> = {
  gray: "bg-muted-foreground",
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  green: "bg-green-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
};

export const PROJECT_ICONS = [
  "folder",
  "sparkles",
  "rocket",
  "briefcase",
  "code",
  "flask",
  "lightbulb",
  "target",
  "layers",
  "compass",
  "message",
  "bot",
  "book",
  "boxes",
] as const;

export type ProjectIcon = (typeof PROJECT_ICONS)[number];

const ICON_COMPONENTS: Record<ProjectIcon, LucideIcon> = {
  folder: Folder,
  sparkles: Sparkles,
  rocket: Rocket,
  briefcase: Briefcase,
  code: Code2,
  flask: FlaskConical,
  lightbulb: Lightbulb,
  target: Target,
  layers: Layers,
  compass: Compass,
  message: MessageCircle,
  bot: Bot,
  book: Book,
  boxes: Boxes,
};

function isProjectColor(value: string): value is ProjectColor {
  return (PROJECT_COLORS as readonly string[]).includes(value);
}

function isProjectIcon(value: string): value is ProjectIcon {
  return (PROJECT_ICONS as readonly string[]).includes(value);
}

/** Badge background/text classes for a stored color token, falling back to
 * gray for unknown/legacy values. */
export function projectColorClasses(color: string): string {
  return COLOR_CLASSES[isProjectColor(color) ? color : "gray"];
}

/** Solid dot classes for a stored color token — used in compact contexts
 * (sidebar rows) where a full badge background would be too heavy. */
export function projectDotClasses(color: string): string {
  return DOT_CLASSES[isProjectColor(color) ? color : "gray"];
}

/** Icon component for a stored icon token, falling back to Folder for
 * unknown/legacy values. */
export function projectIconComponent(icon: string): LucideIcon {
  return ICON_COMPONENTS[isProjectIcon(icon) ? icon : "folder"];
}
