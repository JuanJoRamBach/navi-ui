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
  choices?: string[]; // from ask_user_choice — set on the navi message that asked
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
  // Which project this conversation belongs to — every conversation has
  // exactly one (see Project below). Required going forward; the v2->v3
  // migration stamps it onto every pre-existing conversation.
  projectId: string;
  // NAVI's server-side conversation id for this chat, once one exists —
  // set the first time /chat/send returns one (2026-09-01: real
  // multi-turn server memory, see how_to_handle_context.md). Absent
  // until the first plain-chat message is sent; a branch starts without
  // one too (gets its own on its own first message, doesn't inherit the
  // parent's).
  serverConversationId?: string;
}

// Project is the real top-level container — everything else (canvases,
// conversations, branches) lives inside one. Local/IndexedDB-only for
// now (see migrateV2ToV3 below): no team/multi-user sharing yet, that's
// backend-gated and deliberately not built here. Kept deliberately thin
// (id/name/timestamps) so a later backend-backed Project can satisfy the
// same shape without this type needing to change.
export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

interface NaviDB extends DBSchema {
  conversations: {
    key: string;
    value: Conversation;
    indexes: { "by-updatedAt": number };
  };
  projects: {
    key: string;
    value: Project;
    indexes: { "by-updatedAt": number };
  };
  // Single-row store: mostly per-project keys (`activeId:<projectId>`,
  // `mainId:<projectId>`) so a push arriving via the service worker
  // (which has no React state of its own) knows where to append within
  // whichever project is current, plus one global `activeProjectId` key
  // for which project that is.
  meta: {
    key: string;
    value: string;
  };
}

const DB_NAME = "navi-pwa";
const DB_VERSION = 3;

const DEFAULT_PROJECT_NAME = "Personal";

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
  // projectId is stamped in migrateV2ToV3 right after this runs (every
  // conversation existing at that point, this one included, gets one) —
  // the v1 schema predates projects entirely, so there's nothing to set
  // here yet.
  await transaction.objectStore("conversations").put({
    id,
    title: deriveTitle(oldMessages),
    mode: "normal",
    updatedAt: last?.timestamp ?? Date.now(),
    messages: oldMessages,
  } as Conversation);
  await transaction.objectStore("meta").put(id, "activeId");
}

// Introduces Project as the real top-level container. Every conversation
// that existed before this migration (whether it just arrived via
// migrateV1ToV2 above, or was already a v2 conversation) gets folded
// into one auto-created "Personal" project, so nobody's existing chats
// go missing behind an empty project list. The old global `activeId`/
// `mainId` meta keys become that project's per-project keys
// (`activeId:<id>` / `mainId:<id>`), and `activeProjectId` is set so the
// app opens straight back into the same chat it had open before.
async function migrateV2ToV3(transaction: IDBPTransaction<NaviDB, StoreNames<NaviDB>[], "versionchange">): Promise<void> {
  const conversationsStore = transaction.objectStore("conversations");
  const allConversations = await conversationsStore.getAll();
  if (allConversations.length === 0) return;

  const metaStore = transaction.objectStore("meta");
  const now = Date.now();
  const project: Project = { id: crypto.randomUUID(), name: DEFAULT_PROJECT_NAME, createdAt: now, updatedAt: now };
  await transaction.objectStore("projects").put(project);

  for (const conversation of allConversations) {
    await conversationsStore.put({ ...conversation, projectId: project.id });
  }

  const oldActiveId = await metaStore.get("activeId");
  const oldMainId = await metaStore.get("mainId");
  if (oldActiveId) await metaStore.put(oldActiveId, `activeId:${project.id}`);
  if (oldMainId) await metaStore.put(oldMainId, `mainId:${project.id}`);
  await metaStore.put(project.id, "activeProjectId");
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
    if (oldVersion < 3) {
      const projects = db.createObjectStore("projects", { keyPath: "id" });
      projects.createIndex("by-updatedAt", "updatedAt");
      await migrateV2ToV3(transaction);
    }
  },
});

// Guards the auto-create-on-first-launch branch below against the same
// race initStartedRef guards in App.tsx's mount effect: three separate
// effects (chat load, Main Chat id, project list) all resolve their own
// getActiveProjectId() call on mount, and without this, two calls
// racing before either's `db.put` lands would each see "no active
// project yet" and each create their own "Personal" project. Safe
// without an await between the check and the assignment below — nothing
// else can run in between on JS's single-threaded event loop, so
// whichever call resumes from `db.get` first claims the slot before the
// next one gets a chance to check it.
let creatingDefaultProject: Promise<string> | null = null;

// Whichever project is current — auto-creates the default "Personal"
// project on a genuinely first-ever launch (mirrors how createConversation
// always auto-creates a Main Chat if none exists yet), so a fresh install
// still boots straight into a chat rather than an empty project list.
// This is the one function every project-scoped call below resolves
// through — swapping local storage for a real backend later means
// changing this function's body (e.g. reading the signed-in user's
// current project from an API) without touching any of its callers.
export async function getActiveProjectId(): Promise<string> {
  const db = await dbPromise;
  const existing = await db.get("meta", "activeProjectId");
  if (existing) return existing;
  if (!creatingDefaultProject) {
    creatingDefaultProject = (async () => {
      const now = Date.now();
      const project: Project = { id: crypto.randomUUID(), name: DEFAULT_PROJECT_NAME, createdAt: now, updatedAt: now };
      await db.put("projects", project);
      await db.put("meta", project.id, "activeProjectId");
      return project.id;
    })();
  }
  return creatingDefaultProject;
}

export async function listProjects(): Promise<Project[]> {
  const db = await dbPromise;
  const all = await db.getAllFromIndex("projects", "by-updatedAt");
  return all.reverse();
}

export async function createProject(name: string): Promise<Project> {
  const db = await dbPromise;
  const now = Date.now();
  const project: Project = { id: crypto.randomUUID(), name: name.trim() || "Untitled project", createdAt: now, updatedAt: now };
  await db.put("projects", project);
  await db.put("meta", project.id, "activeProjectId");
  return project;
}

// Switches which project is current — the caller (App.tsx) is
// responsible for then loading/creating that project's active
// conversation, same as it does on initial mount.
export async function switchActiveProject(id: string): Promise<void> {
  const db = await dbPromise;
  await db.put("meta", id, "activeProjectId");
}

export async function getActiveConversationId(): Promise<string | null> {
  const db = await dbPromise;
  const projectId = await getActiveProjectId();
  return (await db.get("meta", `activeId:${projectId}`)) ?? null;
}

// The current project's one designated Main Chat — set once, on the
// very first conversation ever created in that project (see
// createConversation below), never reassigned. Every conversation after
// that is a branch off it (or off another branch), never a second
// independent top-level chat — that's the whole point of the
// one-main-chat model: "New Chat" as a concept is retired, replaced by
// "New Branch Chat." Each project gets its own Main Chat.
export async function getMainConversationId(): Promise<string | null> {
  const db = await dbPromise;
  const projectId = await getActiveProjectId();
  return (await db.get("meta", `mainId:${projectId}`)) ?? null;
}

async function setActiveConversationId(id: string): Promise<void> {
  const db = await dbPromise;
  const projectId = await getActiveProjectId();
  await db.put("meta", id, `activeId:${projectId}`);
}

export async function loadConversation(id: string): Promise<Conversation | undefined> {
  const db = await dbPromise;
  return db.get("conversations", id);
}

export async function saveConversation(conversation: Conversation): Promise<void> {
  const db = await dbPromise;
  await db.put("conversations", conversation);
}

// Most-recently-updated first, scoped to the current project only.
export async function listConversations(): Promise<Conversation[]> {
  const db = await dbPromise;
  const projectId = await getActiveProjectId();
  const all = await db.getAllFromIndex("conversations", "by-updatedAt");
  return all.filter(c => c.projectId === projectId).reverse();
}

export async function createConversation(mode: ChatMode, parentId?: string): Promise<Conversation> {
  const projectId = await getActiveProjectId();
  const conversation: Conversation = {
    id: crypto.randomUUID(),
    title: "New conversation",
    mode,
    updatedAt: Date.now(),
    messages: [],
    projectId,
    ...(parentId ? { parentId } : {}),
  };
  await saveConversation(conversation);
  await setActiveConversationId(conversation.id);
  if (!parentId && !(await getMainConversationId())) {
    const db = await dbPromise;
    await db.put("meta", conversation.id, `mainId:${projectId}`);
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
  const projectId = await getActiveProjectId();
  const activeId = await db.get("meta", `activeId:${projectId}`);
  let conversation = activeId ? await db.get("conversations", activeId) : undefined;

  if (!conversation) {
    conversation = { id: crypto.randomUUID(), title: "New conversation", mode: "normal", updatedAt: message.timestamp, messages: [], projectId };
    await db.put("meta", conversation.id, `activeId:${projectId}`);
  }

  conversation.messages = [...conversation.messages, message];
  conversation.updatedAt = message.timestamp;
  if (conversation.title === "New conversation" && message.role === "user") {
    conversation.title = deriveTitle(conversation.messages);
  }
  await db.put("conversations", conversation);
}
