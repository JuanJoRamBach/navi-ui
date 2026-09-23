// REST client for server.py's /config/keys routes (2026-09-23) — bring
// your own key for providers NAVI never uses by default (DeepSeek,
// Claude). Owner/Admin only on the backend; the key itself never comes
// back from the server, only its last four characters.
import { NAVI_BACKEND_URL } from "./config";

export interface ProviderKeyStatus {
  provider: string;
  label: string;
  configured: boolean;
  // "saved" was pasted in Settings and can be removed there; "env" comes
  // from the server's .env and can't be.
  source: "saved" | "env" | null;
  hint: string | null;
  models: string[];
}

// null = this person can't manage keys (not Owner/Admin), so the section
// isn't shown at all.
export async function listProviderKeys(): Promise<ProviderKeyStatus[] | null> {
  try {
    const res = await fetch(`${NAVI_BACKEND_URL}/config/keys`);
    if (!res.ok) return null;
    return (await res.json()).providers;
  } catch {
    return null;
  }
}

export async function saveProviderKey(provider: string, apiKey: string): Promise<ProviderKeyStatus | { error: string }> {
  try {
    const res = await fetch(`${NAVI_BACKEND_URL}/config/keys`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, api_key: apiKey }),
    });
    const body = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
    return res.ok ? body : { error: body.error ?? `Request failed (${res.status})` };
  } catch {
    return { error: "Couldn't reach NAVI." };
  }
}

export async function removeProviderKey(provider: string): Promise<ProviderKeyStatus | { error: string }> {
  try {
    const res = await fetch(`${NAVI_BACKEND_URL}/config/keys/${encodeURIComponent(provider)}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
    return res.ok ? body : { error: body.error ?? `Request failed (${res.status})` };
  } catch {
    return { error: "Couldn't reach NAVI." };
  }
}
