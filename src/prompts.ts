// Prompt Vault client — a reusable library of saved prompt snippets,
// distinct from NAVI's real /commands (research, graph-data, etc. —
// hardcoded, backend-executed, dispatcher/parser.py). A saved prompt is
// just template TEXT that fills the chat input when clicked — no new
// backend behavior, so unlike agents.ts there's no server route for this
// yet. localStorage-backed for now (same reasoning as apiAuth.ts), but
// shaped as async functions (matching agents.ts's call signatures) so a
// future real backend (a `prompts` table, same shape) is a drop-in swap
// with no changes needed at any call site.

const STORAGE_KEY = "navi_prompt_vault";

export interface SavedPrompt {
  id: string;
  name: string;
  description: string;
  template: string;
  created_at: number;
  updated_at: number;
}

export interface SavedPromptInput {
  name: string;
  description: string;
  template: string;
}

// Fired whenever the Vault changes from anywhere other than the
// component reading it — same shortcut AGENT_VAULT_CHANGED_EVENT uses.
export const PROMPT_VAULT_CHANGED_EVENT = "prompt-vault-changed";

function readAll(): SavedPrompt[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAll(prompts: SavedPrompt[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
    window.dispatchEvent(new Event(PROMPT_VAULT_CHANGED_EVENT));
  } catch {
    // localStorage can throw (private browsing, quota) — Vault just
    // won't persist this change, not a fatal error for the caller.
  }
}

export async function listPrompts(): Promise<SavedPrompt[]> {
  return readAll().sort((a, b) => b.updated_at - a.updated_at);
}

export async function createPrompt(input: SavedPromptInput): Promise<{ id?: string; error?: string }> {
  if (!input.name.trim() || !input.template.trim()) {
    return { error: "Name and template are both required." };
  }
  const now = Date.now();
  const id = `prompt_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const prompts = readAll();
  prompts.push({ id, name: input.name.trim(), description: input.description.trim(), template: input.template, created_at: now, updated_at: now });
  writeAll(prompts);
  return { id };
}

export async function updatePrompt(id: string, input: SavedPromptInput): Promise<{ ok?: boolean; error?: string }> {
  const prompts = readAll();
  const idx = prompts.findIndex(p => p.id === id);
  if (idx === -1) return { error: "Prompt not found." };
  prompts[idx] = { ...prompts[idx], name: input.name.trim(), description: input.description.trim(), template: input.template, updated_at: Date.now() };
  writeAll(prompts);
  return { ok: true };
}

export async function deletePrompt(id: string): Promise<{ ok?: boolean }> {
  writeAll(readAll().filter(p => p.id !== id));
  return { ok: true };
}
