// Push notification subscribe flow. The actual receiving/display logic
// lives in src/sw.ts (the service worker) — this module only handles
// the one-time setup: ask permission, register with the browser's push
// service, hand the resulting subscription to NAVI's backend so it
// knows where to send future pushes.

// Public key only — safe to ship in client source. Must match
// VAPID_PUBLIC_KEY in NAVI's .env exactly; if the backend's key pair is
// ever rotated, this needs updating too or subscribe calls will fail
// with a key-mismatch error from the push service.
const VAPID_PUBLIC_KEY = "BK1C5jSXcABSJRzDQuU5761LwzUC9_9KZ6Fwyz55Pr6Swqsa1P72mmDT0x7ORstt5dv-7rQG-T81oy0Y7moYUQM";

const NAVI_BACKEND_URL = "https://navi-fih8.onrender.com";

export type PushStatus = "unsupported" | "denied" | "subscribed" | "unsubscribed";

// The Push API wants the VAPID key as a raw Uint8Array, not the
// base64url string form everything else in this app passes it around
// as — this is the standard conversion every push-subscribe
// implementation needs.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  return existing ? "subscribed" : "unsubscribed";
}

// Renders the app inert on nothing missing — Render's free tier sleeps
// after inactivity, so the very first subscribe call (or any call,
// really) after a quiet period can take 30-60s while it wakes up. The
// caller should show that wait, not assume a hung request is broken.
export async function subscribeToPush(): Promise<{ ok: boolean; error?: string }> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, error: "Push isn't supported in this browser." };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, error: "Notification permission was not granted." };
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // Cast: TS's lib.dom typings for BufferSource are stricter about
      // the ArrayBuffer/SharedArrayBuffer generic than the Push API
      // spec actually requires — a plain Uint8Array is valid at runtime
      // regardless.
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    });
  }

  try {
    const res = await fetch(`${NAVI_BACKEND_URL}/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
    if (!res.ok) return { ok: false, error: `Backend rejected the subscription (${res.status}).` };
  } catch {
    return { ok: false, error: "Couldn't reach NAVI's backend — it may still be waking up (Render free tier sleeps), try again in a moment." };
  }

  return { ok: true };
}
