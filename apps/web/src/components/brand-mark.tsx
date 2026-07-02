import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

/**
 * The Nyxel logo lockup, factored out so first-run, auth, sidebar, and system
 * screens all brand themselves identically.
 */
export function NyxelLogoMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 611 626"
      role="img"
      aria-label="Nyxel"
      shapeRendering="crispEdges"
      className={className}
      {...props}
    >
      <g transform="translate(-91 -108)">
        <g fill="var(--primary)">
          <rect x="193" y="224" width="102" height="306" />
          <rect x="295" y="326" width="102" height="102" />
          <rect x="498" y="108" width="204" height="218" />
          <rect x="396" y="428" width="204" height="102" />
          <rect x="498" y="326" width="102" height="306" />
        </g>
        <g fill="currentColor">
          <rect x="193" y="108" width="102" height="116" />
          <rect x="91" y="224" width="102" height="509" />
          <rect x="193" y="530" width="102" height="203" />
          <rect x="295" y="224" width="102" height="102" />
          <rect x="295" y="428" width="102" height="102" />
          <rect x="396" y="326" width="102" height="102" />
          <rect x="396" y="530" width="102" height="102" />
          <rect x="498" y="632" width="102" height="102" />
          <rect x="600" y="326" width="102" height="306" />
        </g>
      </g>
    </svg>
  );
}

export function BrandMark({
  size = "md",
  subtitle = "Agentic OS",
  className,
}: {
  size?: "md" | "lg";
  subtitle?: string | null;
  className?: string;
}) {
  const glyph = size === "lg" ? "h-11 w-[42px]" : "h-9 w-[35px]";
  const title = size === "lg" ? "text-lg" : "text-sm";

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <NyxelLogoMark className={cn("shrink-0 text-foreground", glyph)} />
      <div className="grid text-left leading-tight">
        <span className={cn("font-semibold tracking-tight", title)}>Nyxel</span>
        {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
      </div>
    </div>
  );
}
