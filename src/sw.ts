// Custom service worker (injectManifest strategy — see vite.config.ts).
// Everything from the old auto-generated worker (precache the app
// shell, activate immediately) still happens here, just written by
// hand instead of by Workbox's generator, because push notifications
// need real event-handler code generateSW mode has no way to inject.
// Type-checked separately (tsconfig.sw.json, WebWorker lib) — mixing
// this file's ServiceWorkerGlobalScope types into the main app's DOM-lib
// tsconfig produces conflicting global declarations.

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { appendMessage } from "./storage";

declare const self: ServiceWorkerGlobalScope;

// Injected at build time with the list of built assets to precache —
// this placeholder is exactly what injectManifest mode looks for.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));

self.skipWaiting();
self.addEventListener("activate", () => self.clients.claim());

interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

// Fires whenever NAVI's backend sends a push, regardless of whether the
// app is open, backgrounded, or fully closed — that's the entire point
// of push over a live connection (see the send/receive architecture
// discussion: no persistent connection to keep alive, the push service
// wakes this handler on demand).
self.addEventListener("push", event => {
  let payload: PushPayload = { title: "NAVI", body: "" };
  try {
    if (event.data) payload = event.data.json();
  } catch {
    // Non-JSON payload (shouldn't happen — the backend always sends
    // JSON) — fall back to a generic notification rather than crash
    // the handler and lose the push silently.
    payload = { title: "NAVI", body: event.data?.text() ?? "New message" };
  }

  const message = { role: "navi" as const, text: payload.body, timestamp: Date.now() };

  event.waitUntil(
    Promise.all([
      // Written to the same IndexedDB store the app reads on load, so
      // the message is there even if the app was fully closed and gets
      // relaunched later.
      appendMessage(message),
      self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: "icon-192.png",
        badge: "icon-192.png",
        data: { url: payload.url ?? "." },
      }),
      // If the app is already open (foreground or just backgrounded,
      // not closed), it already loaded its message list once at mount
      // and has no way to know IndexedDB changed underneath it — a
      // push landing wouldn't show up until the next full relaunch
      // without this. Tell every open tab directly instead of relying
      // on a reload.
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
        for (const client of clients) client.postMessage({ type: "navi-message", message });
      }),
    ]),
  );
});

// Tapping the notification focuses an already-open tab if one exists,
// instead of always spawning a new one — matches how every real chat
// app's notifications behave.
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = (event.notification.data?.url as string) ?? ".";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
