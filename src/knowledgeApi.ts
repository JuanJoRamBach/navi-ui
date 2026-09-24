// REST client for server.py's company and project knowledge routes
// (2026-09-24). Every rule (who can edit, who can approve, the Owner
// exception, stale approvals, append-only history) is enforced by the
// server in storage/knowledge.py; the UI only decides what to show, and
// shows the server's own reason when it refuses something.
import { NAVI_BACKEND_URL } from "./config";

export type Access = "chat" | "edit";
export type Scope = "company" | `project:${string}`;

export interface ServerProject {
  id: string;
  name: string;
  access: Access;
}

export interface KnowledgeOverview {
  me: { id: string; email: string; role: "owner" | "admin" | "member" };
  projects: ServerProject[];
  // scope -> how many things wait for ME (approvals, suggestions, reviews)
  waiting: Record<string, number>;
  limits: { company: number; project: number };
}

export type BriefStatus =
  | "pending" | "approved" | "applied_unreviewed" | "reviewed" | "flagged"
  | "rejected" | "withdrawn" | "superseded" | "stale";

export interface BriefVersion {
  id: string;
  scope: Scope;
  text: string;
  status: BriefStatus;
  author_id: string;
  author_email: string;
  created_at: number;
  based_on: string | null;
  reverted_from: string | null;
  decided_by: string | null;
  decided_at: number | null;
  note: string | null;
  live_at: number | null;
  reviewed_by: string | null;
  reviewed_at: number | null;
}

export interface BriefState {
  scope: Scope;
  limit: number;
  can_edit: boolean;
  current: BriefVersion | null;
  pending: BriefVersion | null;
  can_approve_pending: boolean;
  unreviewed: BriefVersion[];
  can_review: boolean;
  versions: BriefVersion[];
  restorable: string[];
}

export interface Entry {
  id: string;
  scope: Scope;
  title: string;
  body: string;
  status: "active" | "pending" | "rejected" | "retired";
  source: "editor" | "member" | "navi";
  author_email: string;
  conversation_id: string | null;
  created_at: number;
  decided_by: string | null;
  note: string | null;
}

export interface EntryList {
  can_edit: boolean;
  active: Entry[];
  pending: Entry[];
}

export interface HistoryEvent {
  seq: number;
  at: number;
  scope: Scope;
  action: string;
  actor: string;
  subject_id: string | null;
  detail: string | null;
}

export interface Member {
  user_id: string;
  email: string;
  name: string | null;
  access: Access;
  via_role: boolean; // an Owner/Admin, who can edit every project anyway
}

export interface MemberList {
  members: Member[];
  addable: { user_id: string; email: string; name: string | null }[];
  project: ServerProject;
}

type Result<T> = T | { error: string };

async function call<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  try {
    const res = await fetch(`${NAVI_BACKEND_URL}${path}`, init);
    const body = await res.json().catch(() => null);
    if (res.ok && body) return body as T;
    return { error: body?.error ?? `Request failed (${res.status})` };
  } catch {
    return { error: "Couldn't reach NAVI." };
  }
}

const post = <T,>(path: string, body?: unknown) =>
  call<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

const q = (scope: Scope) => `scope=${encodeURIComponent(scope)}`;

export const isError = <T,>(r: Result<T>): r is { error: string } =>
  typeof r === "object" && r !== null && "error" in r;

export const fetchOverview = () => call<KnowledgeOverview>("/knowledge/overview");
export const createServerProject = (name: string) => post<ServerProject>("/projects", { name });
export const archiveProject = (id: string) => post<{ ok: true }>(`/projects/${encodeURIComponent(id)}/archive`);
export const fetchMembers = (id: string) => call<MemberList>(`/projects/${encodeURIComponent(id)}/members`);
export const setMember = (id: string, userId: string, access: Access | null) =>
  post<{ ok: true }>(`/projects/${encodeURIComponent(id)}/members`, { user_id: userId, access });

export const fetchBrief = (scope: Scope) => call<BriefState>(`/knowledge/brief?${q(scope)}`);
export const proposeBrief = (scope: Scope, text: string) => post<BriefVersion>("/knowledge/brief", { scope, text });
export const approveBrief = (id: string) => post<BriefVersion>(`/knowledge/brief/${id}/approve`);
export const rejectBrief = (id: string, note?: string) => post<BriefVersion>(`/knowledge/brief/${id}/reject`, { note });
export const reviewBrief = (id: string, flag: boolean, note?: string) =>
  post<BriefVersion>(`/knowledge/brief/${id}/review`, { flag, note });
export const restoreBrief = (id: string) => post<BriefVersion>(`/knowledge/brief/${id}/restore`);

export const fetchEntries = (scope: Scope) => call<EntryList>(`/knowledge/entries?${q(scope)}`);
export const addEntry = (scope: Scope, title: string, body: string) => post<Entry>("/knowledge/entries", { scope, title, body });
export const decideEntry = (id: string, approve: boolean, note?: string) =>
  post<Entry>(`/knowledge/entries/${id}/decide`, { approve, note });
export const retireEntry = (id: string, reason?: string) => post<Entry>(`/knowledge/entries/${id}/retire`, { reason });

export const fetchHistory = (scope: Scope) => call<{ items: HistoryEvent[] }>(`/knowledge/history?${q(scope)}`);
