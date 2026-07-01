import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The Nyxel logo lockup — the same primary square + Sparkles glyph the
 * sidebar header uses, factored out so first-run, auth, and system screens
 * all brand themselves identically instead of each rolling their own header.
 */
export function BrandMark({
  size = "md",
  subtitle = "Agentic OS",
  className,
}: {
  size?: "md" | "lg";
  subtitle?: string | null;
  className?: string;
}) {
  const box = size === "lg" ? "size-11" : "size-9";
  const glyph = size === "lg" ? "size-5" : "size-4";
  const title = size === "lg" ? "text-lg" : "text-sm";

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className={cn(
          "flex aspect-square items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm",
          box,
        )}
      >
        <Sparkles className={glyph} />
      </div>
      <div className="grid text-left leading-tight">
        <span className={cn("font-semibold tracking-tight", title)}>Nyxel</span>
        {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
      </div>
    </div>
  );
}
