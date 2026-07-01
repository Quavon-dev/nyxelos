import type { ReactNode } from "react";

/**
 * Shared title/description/actions header used at the top of every
 * workspace page so the "space above the fold" reads the same everywhere —
 * same type scale, same gap to the description, same slot for a primary
 * action button on the right.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * A small stat tile for summary rows at the top of data-heavy pages
 * (agents, automations, approvals, audit log) — same pattern as the
 * "Summe bezahlter Rechnungen" cards in the reference dashboard.
 */
export function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-xs">
      {icon && (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-lg font-semibold leading-tight">{value}</p>
      </div>
    </div>
  );
}
