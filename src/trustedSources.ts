// Trusted Sites registry client — the Sources tab's second window
// (2026-09-06, JuanJo: "the user inputs the sites where the sources will
// be fetched from... from those sites is where the fetch happens").
// A plain domain/URL list, localStorage-backed for now (same reasoning
// as prompts.ts — no backend route exists yet), shaped as async
// functions so a real backend swap later needs zero call-site changes.
//
// This is JUST the registry. Actually scoping web_search/fetch_page to
// only pull from these entries is separate backend work (tools/search.py,
// dispatcher) — not done yet. This module only stores the list a future
// dispatcher change would read.

const STORAGE_KEY = "navi_trusted_sources";

export const TRUSTED_SOURCES_CHANGED_EVENT = "trusted-sources-changed";

function readAll(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAll(sites: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sites));
    window.dispatchEvent(new Event(TRUSTED_SOURCES_CHANGED_EVENT));
  } catch {
    // localStorage can throw (private browsing, quota) — list just
    // won't persist this change, not fatal for the caller.
  }
}

export async function listTrustedSites(): Promise<string[]> {
  return readAll();
}

export async function addTrustedSite(site: string): Promise<void> {
  const trimmed = site.trim();
  if (!trimmed) return;
  const sites = readAll();
  if (sites.includes(trimmed)) return;
  writeAll([...sites, trimmed]);
}

export async function removeTrustedSite(site: string): Promise<void> {
  writeAll(readAll().filter(s => s !== site));
}
