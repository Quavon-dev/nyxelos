import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Shared loading / empty / error building blocks so every page speaks the
 * same visual language while data is in flight. Before this, pages rendered
 * `data ?? []` and flashed their empty state during the first fetch; these
 * give them real placeholders instead.
 */

// Stable, render-independent keys for the fixed-length placeholder loops
// below — the elements never reorder, so index keys would be fine, but this
// keeps the linter's noArrayIndexKey rule satisfied without ignore comments.
const KEY_POOL = Array.from({ length: 64 }, (_, i) => `sk-${i}`);
const keys = (n: number) => KEY_POOL.slice(0, n);

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} />;
}

/** A skeleton echo of the `PageHeader` (title + one description line). */
export function PageHeaderSkeleton({ actions = 0 }: { actions?: number }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {actions > 0 && (
        <div className="flex shrink-0 gap-2">
          {keys(actions).map((key) => (
            <Skeleton key={key} className="h-9 w-28" />
          ))}
        </div>
      )}
    </div>
  );
}

/** Row of `StatCard`-shaped skeletons. */
export function StatCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {keys(count).map((key) => (
        <div key={key} className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-xs">
          <Skeleton className="size-9 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-5 w-12" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Vertical list of bordered rows — the default "card list" placeholder. */
export function ListSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {keys(rows).map((key) => (
        <div key={key} className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="size-8 shrink-0 rounded-md" />
        </div>
      ))}
    </div>
  );
}

/** A card wrapping a `ListSkeleton`, matching the common Card+CardContent page body. */
export function CardListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Card>
      <CardHeader className="pb-0">
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="pt-6">
        <ListSkeleton rows={rows} />
      </CardContent>
    </Card>
  );
}

/** Table-shaped skeleton for the data pages that render a `<Table>`. */
export function TableSkeleton({ rows = 5, cols = 3 }: { rows?: number; cols?: number }) {
  const colKeys = keys(cols);
  return (
    <div className="rounded-lg border">
      <div className="flex gap-4 border-b px-4 py-3">
        {colKeys.map((key) => (
          <Skeleton key={key} className="h-4 flex-1" />
        ))}
      </div>
      {keys(rows).map((rowKey) => (
        <div key={rowKey} className="flex gap-4 border-b px-4 py-3.5 last:border-0">
          {colKeys.map((colKey) => (
            <Skeleton key={`${rowKey}-${colKey}`} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Centered inline loader for full-height panels (chat, share view) where a
 * skeleton grid would be more noise than signal.
 */
export function CenteredLoader({ label }: { label?: ReactNode }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 p-8 text-muted-foreground">
      <Spinner className="size-5" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  );
}
