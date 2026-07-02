"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { recordNotification } from "./notification-store";

/** Relays push events the service worker already receives (video/chat
 * generation done — see apps/server/src/push.ts) into in-app UI: a toast
 * plus a sidebar badge dot, on top of the OS-level notification the SW
 * shows itself. Requires the user to already be push-subscribed (workspace
 * settings > notifications) — this doesn't add a second delivery path, it
 * just surfaces the existing one inside the open tab too. */
export function useAppNotifications() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    function handleMessage(event: MessageEvent) {
      if (event.data?.type !== "nyxel-push") return;
      const payload = event.data.payload as
        | { title?: string; body?: string; url?: string; tag?: string }
        | undefined;
      if (!payload?.title) return;
      const notification = {
        title: payload.title,
        body: payload.body ?? "",
        url: payload.url ?? "/",
        tag: payload.tag,
      };
      recordNotification(notification);
      toast(notification.title, { description: notification.body || undefined });
    }

    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, []);
}
