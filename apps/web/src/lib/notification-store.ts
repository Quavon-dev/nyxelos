"use client";

import { useSyncExternalStore } from "react";

export type AppNotification = {
  title: string;
  body: string;
  url: string;
  tag?: string;
};

type Listener = () => void;

const listeners = new Set<Listener>();
let unseenByPrefix = new Map<string, number>();

function emitChange() {
  for (const listener of listeners) listener();
}

/** URL prefixes the sidebar puts a badge dot on — a notification's url is
 * matched against these to decide which nav item lights up. Extend this
 * list alongside any new push-notification source that should surface in
 * the sidebar. */
const BADGE_PREFIXES = ["/chat"];

function prefixFor(url: string): string | null {
  return BADGE_PREFIXES.find((prefix) => url.includes(prefix)) ?? null;
}

/** Clears the badge dot for a nav prefix — call when the user visits that
 * section, so the dot means "something happened since you last looked". */
export function markNotificationSeen(prefix: string) {
  if (!unseenByPrefix.has(prefix)) return;
  unseenByPrefix = new Map(unseenByPrefix);
  unseenByPrefix.delete(prefix);
  emitChange();
}

export function recordNotification(notification: AppNotification) {
  const prefix = prefixFor(notification.url);
  if (!prefix) return;
  unseenByPrefix = new Map(unseenByPrefix);
  unseenByPrefix.set(prefix, (unseenByPrefix.get(prefix) ?? 0) + 1);
  emitChange();
}

export function useUnseenNotificationBadge(prefix: string): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => unseenByPrefix.get(prefix) ?? 0,
    () => 0,
  );
}
