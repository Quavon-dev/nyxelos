/** Lets a device point this same web build at a different Nyxel server —
 * e.g. a LAN IP at home, a Tailscale/ngrok tunnel on the road, or a public
 * domain. Stored per-browser so a phone and a laptop can each connect to a
 * different install without rebuilding the app. Falls back to the build-time
 * default when nothing's been saved yet. */
export const SERVER_URL_STORAGE_KEY = "nyxel:serverUrl";

export function getDefaultServerUrl(): string {
  return process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";
}

export function getServerUrl(): string {
  if (typeof window === "undefined") return getDefaultServerUrl();
  return window.localStorage.getItem(SERVER_URL_STORAGE_KEY) || getDefaultServerUrl();
}

/** Takes effect after a reload — the tRPC client is built once at module
 * load, see lib/trpc.ts. */
export function setServerUrl(url: string): void {
  const trimmed = url.trim().replace(/\/$/, "");
  if (!trimmed) {
    window.localStorage.removeItem(SERVER_URL_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(SERVER_URL_STORAGE_KEY, trimmed);
}
