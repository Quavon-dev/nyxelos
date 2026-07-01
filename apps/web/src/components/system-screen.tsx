import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import { cn } from "@/lib/utils";

/**
 * Full-bleed, centered chrome for the screens that live *outside* the
 * workspace shell — first-run setup, MCP auth callback, and any other
 * "system is talking to you" moment. One background treatment, one branded
 * header, one card width so these stop each inventing their own look.
 *
 * `width` controls the panel: "sm" for a single status message, "md" for a
 * form, "xl" for the split marketing-plus-form setup layout (which supplies
 * its own children grid).
 */
export function SystemScreen({
  children,
  width = "md",
  className,
}: {
  children: ReactNode;
  width?: "sm" | "md" | "xl";
  className?: string;
}) {
  const maxWidth = width === "sm" ? "max-w-md" : width === "md" ? "max-w-lg" : "max-w-6xl";

  return (
    <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background p-4 sm:p-6 md:p-10">
      {/* Brand-tinted ambience built from design tokens — no hardcoded
          pastels, so it tracks light/dark and any future theme change. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_40rem_at_50%_-10%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_30rem_at_100%_100%,color-mix(in_oklch,var(--primary)_8%,transparent),transparent)]"
      />
      <div className={cn("relative z-10 w-full", maxWidth, className)}>{children}</div>
    </main>
  );
}

/**
 * The default card body for `SystemScreen` — a branded header row plus a
 * bordered card. Setup uses `SystemScreen` directly for its split layout;
 * simpler screens (auth callback, errors) use this.
 */
export function SystemPanel({
  title,
  description,
  children,
  footer,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <BrandMark size="lg" />
      <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {title}
          </h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {children && <div className="mt-6">{children}</div>}
      </div>
      {footer && <p className="text-center text-xs text-muted-foreground">{footer}</p>}
    </div>
  );
}
