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

export interface MessageAttachment {
  filename: string;
  downloadUrl: string;
  viewUrl?: string;
}

// Canonical home for this regex/parse (moved from App.tsx, 2026-08-29) —
// needed here too now, not just for rendering: the Activity panel reads
// StoredMessage.attachments directly instead of re-parsing raw text on
// every render, and sw.ts's push handler (which has no access to
// App.tsx's rendering code) needs the same parsing to flag an incoming
// push-delivered /research result at write time.
const DOWNLOAD_LINE_RE = /📎 (.+?): (https?:\/\/\S+)/g;
const VIEW_LINE_RE = /🌐 (.+?): (https?:\/\/\S+)/g;

export function parseAttachments(text: string): MessageAttachment[] {
  const byFilename = new Map<string, MessageAttachment>();
  for (const m of text.matchAll(DOWNLOAD_LINE_RE)) {
    byFilename.set(m[1], { filename: m[1], downloadUrl: m[2] });
  }
  for (const m of text.matchAll(VIEW_LINE_RE)) {
    const existing = byFilename.get(m[1]);
    if (existing) existing.viewUrl = m[2];
    else byFilename.set(m[1], { filename: m[1], downloadUrl: m[2], viewUrl: m[2] });
  }
  return Array.from(byFilename.values());
}

// The slash-command that triggered this exchange, if any — parsed once
// at write time (see command below) rather than re-derived from text
// later, so the Activity panel doesn't need its own copy of "what does
// a command look like" parsing logic. Undefined for plain chat.
export function parseCommand(text: string): string | undefined {
  const match = text.trim().match(/^\/(\w[\w-]*)/);
  return match?.[1];
}

export interface StoredMessage {
  role: "user" | "navi";
  text: string;
  timestamp: number; // ms since epoch — drives the per-message time label and day dividers
  // Both optional and only ever set at write time (sendMessage in
  // App.tsx, the push handler in sw.ts) — never re-derived from `text`
  // later. Older stored messages simply won't have these fields; every
  // reader treats their absence as "plain chat, no command, no files."
  command?: string; // set on the user message that triggered a command
  attachments?: MessageAttachment[]; // set on the navi reply that produced file(s)
}

export interface Conversation {
  id: string;
  title: string;
  mode: ChatMode; // last-active mode — restored when the conversation is reopened, drives the history list's colored dot
  updatedAt: number; // last message's timestamp, or creation time if still empty — sort key for the history list
  messages: StoredMessage[];
  // Sub-chats ("branches") — set only on a chat created by branching off
  // another one. A branch, never a version-control system: no diff/
  // merge, just "this conversation started from that one, here's its
  // name, here's the tree." parentId is the trunk/parent chat's own id;
  // absent on a normal top-level chat.
  parentId?: string;
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

// The project's one designated Main Chat — set once, on the very first
// conversation ever created (see createConversation below), never
// reassigned. Every conversation after that is a branch off it (or off
// another branch), never a second independent top-level chat — that's
// the whole point of the one-main-chat model: "New Chat" as a concept
// is retired, replaced by "New Branch Chat."
export async function getMainConversationId(): Promise<string | null> {
  const db = await dbPromise;
  return (await db.get("meta", "mainId")) ?? null;
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

export async function createConversation(mode: ChatMode, parentId?: string): Promise<Conversation> {
  const conversation: Conversation = {
    id: crypto.randomUUID(),
    title: "New conversation",
    mode,
    updatedAt: Date.now(),
    messages: [],
    ...(parentId ? { parentId } : {}),
  };
  await saveConversation(conversation);
  await setActiveConversationId(conversation.id);
  if (!parentId && !(await getMainConversationId())) {
    const db = await dbPromise;
    await db.put("meta", conversation.id, "mainId");
  }
  return conversation;
}

// Every branch (any depth — a branch of a branch counts too), flat,
// most-recently-updated first, each carrying its direct parent's title
// for context. Flat rather than a nested tree on purpose: with only
// one Main Chat as the true root, a full indented tree view is more
// UI than the common case needs — most branches are one hop off Main
// Chat or off each other, and the direct-parent label already answers
// "where did this come from" without indentation depth to manage.
export interface BranchListItem extends Conversation {
  parentTitle: string;
}
export async function listBranches(): Promise<BranchListItem[]> {
  const all = await listConversations();
  const byId = new Map(all.map(c => [c.id, c]));
  return all
    .filter((c): c is Conversation & { parentId: string } => !!c.parentId)
    .map(c => ({ ...c, parentTitle: byId.get(c.parentId)?.title ?? "a deleted chat" }));
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
