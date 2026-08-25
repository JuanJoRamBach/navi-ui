// Chat persistence — IndexedDB, not localStorage. Two reasons:
//   1. localStorage is synchronous and blocks the main thread on every
//      read/write; fine for a handful of KB, but this grows unbounded
//      as the conversation does.
//   2. localStorage doesn't exist in a service worker's global scope at
//      all. Once push notifications land (a later piece), the service
//      worker needs to write an incoming message to storage from a
//      push event — with the app not even open. Only IndexedDB is
//      reachable from both contexts, so starting there now avoids a
//      storage-layer rewrite later.
import { openDB, type DBSchema } from "idb";

export interface StoredMessage {
  role: "user" | "navi";
  text: string;
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
  return db.get(STORE, CURRENT_KEY);
}

export async function saveMessages(messages: StoredMessage[]): Promise<void> {
  const db = await dbPromise;
  await db.put(STORE, messages, CURRENT_KEY);
}
