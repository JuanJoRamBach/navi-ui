// Access-key handling for NAVI's backend API (2026-09-04) — the backend
// had zero authentication until now (confirmed by hand: a bare curl to
// GET /mcp/connections returned real data with no credentials at all).
// server.py now requires an X-Navi-Api-Key header matching NAVI_API_KEY
// on every route except the health check, /files/* (self-gated already),
// and the two webhooks.
//
// This is a stopgap for the testing phase, not real per-user auth — NAVI
// has no user-account system at all yet (see IDEAS.md's "Project as the
// real top-level container" gap). The key lives only in this browser's
// localStorage, entered once by whoever was actually given it — it is
// NEVER baked into the built JS bundle (this is a public static site on
// GitHub Pages; a build-time constant would be readable by anyone who
// views the deployed source). That raises the bar from "anyone who finds
// the URL" to "someone who was actually given the key" — it does not
// protect against a determined holder of that key misusing it. Real
// per-user auth is the eventual proper fix, unbuilt.
import { NAVI_BACKEND_URL } from "./config";

const STORAGE_KEY = "navi_api_key";
export const API_KEY_HEADER = "X-Navi-Api-Key";

export function getApiKey(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setApiKey(key: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, key.trim());
  } catch {
    // Private browsing / storage disabled — the key just won't survive a
    // reload; nothing else here depends on this succeeding.
  }
}

export function clearApiKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}

// Patches the page's global fetch exactly once, at startup (see
// main.tsx). Every call site across the app (mcpConnections.ts,
// agentWork.ts, App.tsx, agents.ts, devslate.ts, AgentWorkChat.tsx,
// push.ts) already just calls fetch(`${NAVI_BACKEND_URL}/...`) directly
// with a plain string URL — intercepting here avoids threading the
// header through every one of those call sites by hand, and means a new
// call site added later gets this for free without remembering to.
let patched = false;
export function installApiAuth(): void {
  if (patched) return;
  patched = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : null;
    if (url && url.startsWith(NAVI_BACKEND_URL)) {
      const key = getApiKey();
      if (key) {
        const headers = new Headers(init?.headers);
        headers.set(API_KEY_HEADER, key);
        init = { ...init, headers };
      }
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}
