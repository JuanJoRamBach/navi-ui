// Chat persistence — IndexedDB, not localStorage. Two reasons:
//   1. localStorage is synchronous and blocks the main thread on every
//      read/write; fine for a handful of KB, but this grows unbounded
//      as a conversation does.
//   2. localStorage doesn't exist in a service worker's global scope at
//      all — and the service worker's push handler (src/sw.ts) needs
//      to write an incoming message to storage from a push event, with
//      the app not even open. Only IndexedDB is reachable from both
//      contexts, which is the whole reason this module exists instead
//      of a one-line localStorage call.
import { openDB, type DBSchema, type IDBPTransaction, type StoreNames } from "idb";
import type { ChatMode } from "./tokens";

export interface StoredMessage {
  role: "user" | "navi";
  text: string;
  timestamp: number; // ms since epoch — drives the per-message time label and day dividers
}

export interface Conversation {
  id: string;
  title: string;
  mode: ChatMode; // last-active mode — restored when the conversation is reopened, drives the history list's colored dot
  updatedAt: number; // last message's timestamp, or creation time if still empty — sort key for the history list
  messages: StoredMessage[];
}

interface NaviDB extends DBSchema {
  conversations: {
    key: string;
    value: Conversation;
    indexes: { "by-updatedAt": number };
  };
  // Single-row store: just the id of whichever conversation is currently
  // active, so a push arriving via the service worker (which has no
  // React state of its own) knows where to append.
  meta: {
    key: string;
    value: string;
  };
}

const DB_NAME = "navi-pwa";
const DB_VERSION = 2;

export function deriveTitle(messages: StoredMessage[]): string {
  const firstUser = messages.find(m => m.role === "user");
  const text = (firstUser?.text ?? "").trim();
  if (!text) return "New conversation";
  return text.length > 40 ? `${text.slice(0, 40).trimEnd()}…` : text;
}

// Migrates the old single-conversation v1 store (one fixed key,
// "current", holding a flat message array) into the v2 multi-
// conversation schema, rather than silently losing whatever's already
// saved in the browser. Only runs for a browser that actually has v1
// data (oldVersion === 1) — a brand-new install jumps straight to v2
// with nothing to migrate.
async function migrateV1ToV2(transaction: IDBPTransaction<NaviDB, StoreNames<NaviDB>[], "versionchange">): Promise<void> {
  // idb typed the legacy store out of NaviDB (it's not part of the
  // current schema) — reach it through the untyped transaction handle.
  const legacyStore = (transaction as unknown as { objectStore(name: string): { get(key: string): Promise<StoredMessage[] | undefined> } }).objectStore("conversation");
  const oldMessages = await legacyStore.get("current");
  if (!oldMessages || oldMessages.length === 0) return;

  const id = crypto.randomUUID();
  const last = oldMessages[oldMessages.length - 1];
  await transaction.objectStore("conversations").put({
    id,
    title: deriveTitle(oldMessages),
    mode: "normal",
    updatedAt: last?.timestamp ?? Date.now(),
    messages: oldMessages,
  });
  await transaction.objectStore("meta").put(id, "activeId");
}

const dbPromise = openDB<NaviDB>(DB_NAME, DB_VERSION, {
  async upgrade(db, oldVersion, _newVersion, transaction) {
    if (oldVersion < 2) {
      const conversations = db.createObjectStore("conversations", { keyPath: "id" });
      conversations.createIndex("by-updatedAt", "updatedAt");
      db.createObjectStore("meta");
    }
    if (oldVersion === 1) {
      await migrateV1ToV2(transaction);
      // "conversation" (singular) is the v1 store — not part of the
      // current schema type, hence the cast.
      (db as unknown as { deleteObjectStore(name: string): void }).deleteObjectStore("conversation");
    }
  },
});

export async function getActiveConversationId(): Promise<string | null> {
  const db = await dbPromise;
  return (await db.get("meta", "activeId")) ?? null;
}

async function setActiveConversationId(id: string): Promise<void> {
  const db = await dbPromise;
  await db.put("meta", id, "activeId");
}

export async function loadConversation(id: string): Promise<Conversation | undefined> {
  const db = await dbPromise;
  return db.get("conversations", id);
}

export async function saveConversation(conversation: Conversation): Promise<void> {
  const db = await dbPromise;
  await db.put("conversations", conversation);
}

// Most-recently-updated first, for the "Past conversations" panel.
export async function listConversations(): Promise<Conversation[]> {
  const db = await dbPromise;
  const all = await db.getAllFromIndex("conversations", "by-updatedAt");
  return all.reverse();
}

export async function createConversation(mode: ChatMode): Promise<Conversation> {
  const conversation: Conversation = {
    id: crypto.randomUUID(),
    title: "New conversation",
    mode,
    updatedAt: Date.now(),
    messages: [],
  };
  await saveConversation(conversation);
  await setActiveConversationId(conversation.id);
  return conversation;
}

export async function switchActiveConversation(id: string): Promise<void> {
  await setActiveConversationId(id);
}

// Used from the service worker's push handler — appends one incoming
// message to whichever conversation is currently active, without
// needing the full array the page's React state holds. If nothing's
// active yet (e.g. a push arrives before the app was ever opened on
// this device), creates one rather than silently dropping the message.
export async function appendMessage(message: StoredMessage): Promise<void> {
  const db = await dbPromise;
  const activeId = await db.get("meta", "activeId");
  let conversation = activeId ? await db.get("conversations", activeId) : undefined;

  if (!conversation) {
    conversation = { id: crypto.randomUUID(), title: "New conversation", mode: "normal", updatedAt: message.timestamp, messages: [] };
    await db.put("meta", conversation.id, "activeId");
  }

  conversation.messages = [...conversation.messages, message];
  conversation.updatedAt = message.timestamp;
  if (conversation.title === "New conversation" && message.role === "user") {
    conversation.title = deriveTitle(conversation.messages);
  }
  await db.put("conversations", conversation);
}
