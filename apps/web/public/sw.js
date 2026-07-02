// Minimal service worker — installability + Web Push only, no offline
// asset caching (the app needs a live server connection to be useful, so
// caching pages would just serve stale UI against a fresh backend).
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Nyxel", body: event.data.text() };
  }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(payload.title ?? "Nyxel", {
        body: payload.body,
        tag: payload.tag,
        data: { url: payload.url ?? "/" },
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
      }),
      // Relay the same payload to any open tab so it can show an in-app
      // toast + sidebar badge instead of relying solely on the OS-level
      // notification above (which some browsers suppress while focused).
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: "nyxel-push", payload });
        }
      }),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      for (const client of clients) {
        if ("focus" in client && "navigate" in client) {
          return client.focus().then(() => client.navigate(url));
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
