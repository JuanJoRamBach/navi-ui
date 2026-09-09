// Real per-user session handling (2026-09-10) — layered ON TOP of
// apiAuth.ts's shared access-key gate, not replacing it. See
// storage/auth.py's own module docstring on the backend for the full
// reasoning: the shared key stays the outer "is this a legitimate caller
// at all" boundary; this is the additional, real-identity layer, needed
// only by the specific routes that care WHO (Agent Work's edited_by,
// seeing/restoring/purging deleted workflows — see server.py's
// _require_role). A token here with no shared key still gets nowhere;
// a shared key with no token still works for everything that doesn't
// need real identity, same as before this existed.
import { NAVI_BACKEND_URL } from "./config";

const STORAGE_KEY = "navi_session_token";

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Private browsing / storage disabled — same non-fatal shape as
    // apiAuth.ts's setApiKey: the token just won't survive a reload.
  }
}

export function clearSessionToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}

// Same "patch fetch once, every existing call site gets it for free"
// approach as apiAuth.ts's installApiAuth — see that file for why.
let patched = false;
export function installSessionAuth(): void {
  if (patched) return;
  patched = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : null;
    if (url && url.startsWith(NAVI_BACKEND_URL)) {
      const token = getSessionToken();
      if (token) {
        const headers = new Headers(init?.headers);
        headers.set("Authorization", `Bearer ${token}`);
        init = { ...init, headers };
      }
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}
