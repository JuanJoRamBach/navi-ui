// Chat persistence — IndexedDB, not localStorage. Two reasons:
//   1. localStorage is synchronous and blocks the main thread on every
//      read/write; fine for a handful of KB, but this grows unbounded
//      as the conversation does.
//   2. localStorage doesn't exist in a service worker's global scope at
//      all — and the service worker's push handler (src/sw.ts) needs
//      to write an incoming message to storage from a push event, with
//      the app not even open. Only IndexedDB is reachable from both
//      contexts, which is the whole reason this module exists instead
//      of a one-line localStorage call.
import { openDB, type DBSchema } from "idb";

export interface StoredMessage {
  role: "user" | "navi";
  text: string;
  timestamp: number; // ms since epoch — drives the per-message time label and day dividers
}

interface NaviDB extends DBSchema {
  conversation: {
    key: string;
    value: StoredMessage[];
  };
}

const DB_NAME = "navi-pwa";
const DB_VERSION = 1;
const STORE = "conversation";
// Single-conversation prototype — one fixed key. Multiple saved
// conversations (the "Past conversations" panel is still mock) would
// mean one key per conversation id instead.
const CURRENT_KEY = "current";

const dbPromise = openDB<NaviDB>(DB_NAME, DB_VERSION, {
  upgrade(db) {
    db.createObjectStore(STORE);
  },
});

export async function loadMessages(): Promise<StoredMessage[] | undefined> {
  const db = await dbPromise;
  const stored = await db.get(STORE, CURRENT_KEY);
  if (!stored) return stored;
  // Migration for messages saved before `timestamp` existed — backfill
  // with "now" rather than crash the day-divider logic on a missing
  // field. Cast to Partial: the static type says timestamp always
  // exists, but data written before this field was added genuinely
  // won't have it at runtime. Only matters once; the next save
  // persists the real value.
  return (stored as Partial<StoredMessage>[]).map(m => ({
    role: m.role ?? "navi",
    text: m.text ?? "",
    timestamp: m.timestamp ?? Date.now(),
  }));
}

export async function saveMessages(messages: StoredMessage[]): Promise<void> {
  const db = await dbPromise;
  await db.put(STORE, messages, CURRENT_KEY);
}

// Used from the service worker's push handler — appends one incoming
// message without needing the full array the page's React state holds.
// Read-modify-write against the same store the app itself reads on
// load, so a message that arrives while the app is closed is just
// there next time it opens, no separate "pending notifications" queue
// to reconcile.
export async function appendMessage(message: StoredMessage): Promise<void> {
  const db = await dbPromise;
  const existing = (await db.get(STORE, CURRENT_KEY)) ?? [];
  await db.put(STORE, [...existing, message], CURRENT_KEY);
}
