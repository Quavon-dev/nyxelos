"use client";

import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "nyxel:installBannerDismissed";

/** Registers the service worker on every load, then — only on browsers that
 * fire `beforeinstallprompt` (Chromium/Android; Safari/iOS has no
 * programmatic prompt, users add-to-home-screen manually) — shows a small
 * dismissible banner offering the native install flow. */
export function PwaInstallBanner() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.error("Service worker registration failed:", error);
      });
    }

    setDismissed(window.localStorage.getItem(DISMISSED_KEY) === "1");

    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  const isStandalone =
    typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches;

  if (!installEvent || dismissed || isStandalone) return null;

  return (
    <div className="flex items-center gap-3 border-b bg-muted/60 px-4 py-2 text-sm">
      <Download className="size-4 shrink-0 text-muted-foreground" />
      <p className="flex-1">Install Nyxel as an app for quick access and push notifications.</p>
      <Button
        size="sm"
        onClick={async () => {
          await installEvent.prompt();
          await installEvent.userChoice;
          setInstallEvent(null);
        }}
      >
        Install
      </Button>
      <button
        type="button"
        aria-label="Dismiss"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => {
          window.localStorage.setItem(DISMISSED_KEY, "1");
          setDismissed(true);
        }}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
