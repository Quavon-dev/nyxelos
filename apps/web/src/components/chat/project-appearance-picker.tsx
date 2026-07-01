"use client";

import { Check } from "lucide-react";
import {
  PROJECT_COLORS,
  PROJECT_ICONS,
  type ProjectColor,
  type ProjectIcon,
  projectDotClasses,
  projectIconComponent,
} from "@/lib/project-appearance";
import { cn } from "@/lib/utils";

export function ProjectAppearancePicker({
  color,
  icon,
  onColorChange,
  onIconChange,
}: {
  color: string;
  icon: string;
  onColorChange: (color: ProjectColor) => void;
  onIconChange: (icon: ProjectIcon) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-xs text-muted-foreground">Color</p>
        <div className="flex flex-wrap gap-1.5">
          {PROJECT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onColorChange(c)}
              aria-label={c}
              className={cn(
                "flex size-6 items-center justify-center rounded-full transition",
                projectDotClasses(c),
                color === c && "ring-2 ring-offset-2 ring-offset-background ring-foreground/60",
              )}
            >
              {color === c && <Check className="size-3.5 text-white" />}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs text-muted-foreground">Icon</p>
        <div className="flex flex-wrap gap-1.5">
          {PROJECT_ICONS.map((i) => {
            const Icon = projectIconComponent(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => onIconChange(i)}
                aria-label={i}
                className={cn(
                  "flex size-8 items-center justify-center rounded-lg border text-muted-foreground transition hover:bg-muted",
                  icon === i && "border-foreground/40 bg-muted text-foreground",
                )}
              >
                <Icon className="size-4" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
