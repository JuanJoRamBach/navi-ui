// REST client for server.py's /config/keys routes (2026-09-23): bring your
// own key, for a paid provider NAVI doesn't use by default, for one of
// the 8 free providers (to run on your own account instead of NAVI's), or
// for any OpenAI-compatible API ("Other"). Owner/Admin only on the
// backend; a key never comes back from the server, only its last four
// characters.
import { NAVI_BACKEND_URL } from "./config";

export type ProviderKind = "free" | "paid" | "custom";

export interface CatalogEntry {
  id: string;
  label: string;
  kind: "free" | "paid";
  needs_account_id?: boolean;
  // False for a provider with no way to check a key before using it (LLM7).
  checkable?: boolean;
}

export interface KeyRow {
  provider: string;
  label: string;
  kind: ProviderKind;
  connected: boolean;
  // "yours": pasted in Settings, removable. "navi": a free provider on
  // NAVI's own key. "server": a paid key set in the server's .env.
  source: "yours" | "navi" | "server" | null;
  hint: string | null;
  models: number | null;
  checkable: boolean;
}

export interface KeysOverview {
  catalog: CatalogEntry[];
  connected: KeyRow[];
}

export interface SaveKeyInput {
  provider: string; // a catalog id, or "other"
  api_key: string;
  account_id?: string; // Cloudflare
  name?: string; // Other
  base_url?: string; // Other
}

type Result<T> = T | { error: string };

async function jsonOrError<T>(res: Response): Promise<Result<T>> {
  const body = await res.json().catch(() => null);
  if (res.ok && body) return body as T;
  return { error: body?.error ?? `Request failed (${res.status})` };
}

// null = this person can't manage keys (not Owner/Admin).
export async function fetchKeys(): Promise<KeysOverview | null> {
  try {
    const res = await fetch(`${NAVI_BACKEND_URL}/config/keys`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function saveKey(input: SaveKeyInput): Promise<Result<{ row: KeyRow }>> {
  try {
    const res = await fetch(`${NAVI_BACKEND_URL}/config/keys`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return jsonOrError(res);
  } catch {
    return { error: "Couldn't reach NAVI." };
  }
}

export async function removeKey(provider: string): Promise<Result<{ row: KeyRow | null }>> {
  try {
    const res = await fetch(`${NAVI_BACKEND_URL}/config/keys/${encodeURIComponent(provider)}`, { method: "DELETE" });
    return jsonOrError(res);
  } catch {
    return { error: "Couldn't reach NAVI." };
  }
}
