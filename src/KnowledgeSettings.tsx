import { useCallback, useEffect, useState } from "react";
import { ChevronLeftIcon, HistoryIcon, PlusIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, status } from "./tokens";
import { SectionTitle, ghostButton, inputStyle } from "./AccountSettings";
import {
  addEntry, approveBrief, archiveProject, createServerProject, decideEntry, fetchBrief, fetchEntries, fetchHistory,
  fetchMembers, isError, proposeBrief, rejectBrief, restoreBrief, retireEntry, reviewBrief, setMember,
  type Access, type BriefState, type BriefStatus, type BriefVersion, type EntryList, type HistoryEvent,
  type KnowledgeOverview, type MemberList, type Scope, type ServerProject,
} from "./knowledgeApi";

// Settings → Company knowledge and Settings → Projects (2026-09-24).
//
// The company and each project get the same three things: a BRIEF NAVI
// reads on every message there, a LIBRARY it searches when a question
// needs it, and the HISTORY of every change. Who can do what is decided
// by the server (storage/knowledge.py) and reported back per screen
// (can_edit, can_approve_pending, can_review); this file only shows or
// hides controls to match, and shows the server's own reason when it
// refuses something.

const when = (epochSeconds: number | null | undefined) =>
  epochSeconds ? new Date(epochSeconds * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";

const STATUS_LABEL: Record<BriefStatus, string> = {
  pending: "Waiting for approval",
  approved: "Approved",
  applied_unreviewed: "Owner change, not reviewed",
  reviewed: "Owner change, reviewed",
  flagged: "Owner change, flagged",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  superseded: "Replaced by a newer proposal",
  stale: "Outdated: the brief changed first",
};

const ACTION_LABEL: Record<string, string> = {
  brief_proposed: "proposed a brief change",
  brief_approved: "approved a brief change",
  brief_applied_unreviewed: "applied a brief change without review (Owner)",
  brief_reviewed: "reviewed the Owner's change",
  brief_flagged: "flagged the Owner's change",
  brief_rejected: "rejected a brief change",
  brief_withdrawn: "withdrew their proposal",
  brief_superseded: "replaced a waiting proposal",
  brief_stale: "found a proposal outdated",
  brief_restored: "restored an earlier approved version",
  entry_added: "added to the library",
  entry_suggested: "suggested a library entry",
  entry_approved: "approved a library suggestion",
  entry_rejected: "rejected a library suggestion",
  entry_retired: "retired a library entry",
  project_created: "created the project",
  project_archived: "archived the project",
  member_set: "changed someone's access",
  member_removed: "removed a member",
};

// ---- Small pieces ------------------------------------------------------------

function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return <div style={{ fontSize: fontSize.xxs, color: status.danger.color, lineHeight: 1.5 }}>{text}</div>;
}

function Chip({ tone, children }: { tone: "neutral" | "success" | "warning" | "danger"; children: React.ReactNode }) {
  const c = tone === "neutral" ? { color: neutral.textMuted, bg: "transparent", border: "rgba(255,255,255,0.15)" } : status[tone];
  return (
    <span style={{
      fontSize: 10, lineHeight: "14px", padding: "0 6px", borderRadius: 9999, whiteSpace: "nowrap",
      color: c.color, background: c.bg, border: `1px solid ${c.border}`, fontFamily,
    }}>
      {children}
    </span>
  );
}

function statusTone(s: BriefStatus): "neutral" | "success" | "warning" | "danger" {
  if (s === "approved" || s === "reviewed") return "success";
  if (s === "pending" || s === "applied_unreviewed") return "warning";
  if (s === "flagged" || s === "rejected") return "danger";
  return "neutral";
}

function Panel({ title, hint, children, right }: { title: string; hint?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: spacing.sm }}>
        <span style={{ fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: neutral.textPrimary }}>{title}</span>
        {right}
      </div>
      {hint && <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, lineHeight: 1.5 }}>{hint}</div>}
      {children}
    </div>
  );
}

const boxStyle: React.CSSProperties = {
  padding: spacing.sm, borderRadius: radius.sm, background: "var(--surface-panel)",
  border: "1px solid var(--border-default)", fontSize: fontSize.xs, color: neutral.textPrimary,
  whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.55,
};

function toneBox(tone: "warning" | "danger"): React.CSSProperties {
  return {
    display: "flex", flexDirection: "column", gap: spacing.xs, padding: spacing.sm, borderRadius: radius.sm,
    background: status[tone].bg, border: `1px solid ${status[tone].border}`,
  };
}

const primaryButton: React.CSSProperties = {
  ...ghostButton, padding: `${spacing.xxs}px ${spacing.md}px`, fontSize: fontSize.xs, fontWeight: fontWeight.medium,
  border: `1px solid ${status.success.border}`, background: status.success.bg, color: status.success.color,
};

// A button that asks once more before doing something immediate.
function ConfirmButton({ label, confirmLabel, onConfirm, disabled }: {
  label: string; confirmLabel: string; onConfirm: () => void; disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      disabled={disabled}
      onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}
      style={armed ? { ...ghostButton, color: status.danger.color, borderColor: status.danger.border } : ghostButton}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

// ---- Brief ---------------------------------------------------------------------

function BriefPanel({ scope, me, onChanged }: { scope: Scope; me: KnowledgeOverview["me"]; onChanged: () => void }) {
  const [state, setState] = useState<BriefState | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showVersions, setShowVersions] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchBrief(scope);
    if (isError(r)) setError(r.error); else setState(r);
  }, [scope]);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (r && typeof r === "object" && "error" in r) { setError((r as { error: string }).error); return false; }
    await load();
    onChanged();
    return true;
  };

  if (!state) return <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>{error ?? "Loading…"}</div>;

  const isOwner = me.role === "owner";
  const where = scope === "company" ? "every chat in the company" : "every chat in this project";
  const mine = (v: BriefVersion) => v.author_id === me.id;

  return (
    <Panel
      title="Brief"
      hint={`NAVI reads this on ${where}. Keep it short: who, what, and rules for every answer. Put detail in the library.`}
      right={<span style={{ fontSize: fontSize.xxs, color: neutral.textMuted, fontVariantNumeric: "tabular-nums" }}>
        {(state.current?.text.length ?? 0).toLocaleString()} / {state.limit.toLocaleString()} characters
      </span>}
    >
      <div style={boxStyle}>
        {state.current?.text || <span style={{ color: neutral.textMuted }}>No brief yet.</span>}
      </div>
      {state.current && (
        <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>
          In force since {when(state.current.live_at)} · written by {state.current.author_email}
          {state.current.decided_by && state.current.status === "approved" && ` · approved by ${state.current.decided_by}`}
        </div>
      )}

      {/* Owner changes applied without review, until an Admin looks at them. */}
      {state.unreviewed.map(v => (
        <div key={v.id} style={toneBox("warning")}>
          <span style={{ fontSize: fontSize.xxs, color: status.warning.color, lineHeight: 1.5 }}>
            {v.author_email} (Owner) changed the brief on {when(v.created_at)} without review.
            {state.can_review && !mine(v) ? " Please review it." : " An Admin reviews it afterwards."}
          </span>
          {state.can_review && !mine(v) && (
            <span style={{ display: "flex", gap: spacing.xs }}>
              <button disabled={busy} style={ghostButton} onClick={() => void act(() => reviewBrief(v.id, false))}>Mark reviewed</button>
              <button disabled={busy} style={{ ...ghostButton, color: status.danger.color }} onClick={() => void act(() => reviewBrief(v.id, true))}>Flag it</button>
            </span>
          )}
        </div>
      ))}

      {/* The one change waiting for someone else's approval. */}
      {state.pending && (
        <div style={toneBox("warning")}>
          <span style={{ fontSize: fontSize.xxs, color: status.warning.color }}>
            Waiting for approval · proposed by {state.pending.author_email} on {when(state.pending.created_at)}
          </span>
          <div style={{ ...boxStyle, background: "transparent" }}>{state.pending.text || <em>(empty brief)</em>}</div>
          <span style={{ display: "flex", gap: spacing.xs, flexWrap: "wrap", alignItems: "center" }}>
            {state.can_approve_pending && (
              <>
                <button disabled={busy} style={primaryButton} onClick={() => void act(() => approveBrief(state.pending!.id))}>Approve</button>
                <button disabled={busy} style={ghostButton} onClick={() => void act(() => rejectBrief(state.pending!.id))}>Reject</button>
              </>
            )}
            {mine(state.pending) && (
              <>
                <span style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>Someone else with edit rights has to approve it.</span>
                <button disabled={busy} style={ghostButton} onClick={() => void act(() => rejectBrief(state.pending!.id))}>Withdraw</button>
              </>
            )}
            {!state.can_approve_pending && !mine(state.pending) && (
              <span style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>Only someone with edit rights, other than its author, can approve it.</span>
            )}
          </span>
        </div>
      )}

      {state.can_edit && !editing && (
        <div>
          <button style={ghostButton} onClick={() => { setDraft(state.current?.text ?? ""); setEditing(true); setError(null); }}>
            {state.current ? "Propose a change" : "Write the brief"}
          </button>
        </div>
      )}
      {editing && (
        <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
          <textarea
            value={draft} onChange={e => setDraft(e.target.value)} rows={6}
            style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
          />
          <span style={{
            fontSize: fontSize.xxs, fontVariantNumeric: "tabular-nums",
            color: draft.length > state.limit ? status.danger.color : neutral.textMuted,
          }}>
            {draft.length.toLocaleString()} / {state.limit.toLocaleString()} characters
          </span>
          <span style={{ fontSize: fontSize.xxs, color: neutral.textMuted, lineHeight: 1.5 }}>
            {isOwner
              ? "As the Owner, your change applies straight away and is marked as not reviewed until an Admin reviews it."
              : "Someone else with edit rights has to approve it before NAVI uses it. Any change still waiting is replaced by this one."}
          </span>
          <span style={{ display: "flex", gap: spacing.xs }}>
            <button
              disabled={busy || draft.length > state.limit}
              style={{ ...primaryButton, opacity: busy || draft.length > state.limit ? 0.5 : 1 }}
              onClick={async () => { if (await act(() => proposeBrief(scope, draft))) setEditing(false); }}
            >
              {busy ? "Saving…" : isOwner ? "Apply now" : "Submit for approval"}
            </button>
            <button disabled={busy} style={ghostButton} onClick={() => setEditing(false)}>Cancel</button>
          </span>
        </div>
      )}
      <ErrorLine text={error} />

      <div>
        <button style={{ ...ghostButton, border: "none", paddingLeft: 0 }} onClick={() => setShowVersions(v => !v)}>
          {showVersions ? "Hide" : "Show"} earlier versions ({state.versions.length})
        </button>
      </div>
      {showVersions && (
        <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
          {state.versions.map(v => (
            <div key={v.id} style={{ ...boxStyle, display: "flex", flexDirection: "column", gap: 4, whiteSpace: "normal" }}>
              <span style={{ display: "flex", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" }}>
                <Chip tone={statusTone(v.status)}>{STATUS_LABEL[v.status]}</Chip>
                {state.current?.id === v.id && <Chip tone="success">In force</Chip>}
                <span style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>
                  {v.author_email} · {when(v.created_at)}
                  {v.decided_by && ` · ${v.status === "approved" ? "approved" : "decided"} by ${v.decided_by}`}
                  {v.reverted_from && " · restored from an earlier version"}
                </span>
              </span>
              <span style={{ whiteSpace: "pre-wrap", fontSize: fontSize.xxs, color: neutral.textPrimary }}>{v.text || "(empty)"}</span>
              {v.note && <span style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>Note: {v.note}</span>}
              {state.restorable.includes(v.id) && (
                <span>
                  <ConfirmButton
                    label="Restore this version" confirmLabel="Restore now? It takes effect immediately"
                    disabled={busy} onConfirm={() => void act(() => restoreBrief(v.id))}
                  />
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---- Library ---------------------------------------------------------------------

function LibraryPanel({ scope, onChanged }: { scope: Scope; onChanged: () => void }) {
  const [list, setList] = useState<EntryList | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetchEntries(scope);
    if (isError(r)) setError(r.error); else setList(r);
  }, [scope]);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (r && typeof r === "object" && "error" in r) { setError((r as { error: string }).error); return false; }
    await load();
    onChanged();
    return true;
  };

  if (!list) return <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>{error ?? "Loading…"}</div>;

  return (
    <Panel
      title="Library"
      hint="Longer facts NAVI looks up only when a question needs them, so a big library costs nothing until it's used."
      right={<span style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>{list.active.length} in use</span>}
    >
      {list.pending.length > 0 && (
        <div style={toneBox("warning")}>
          <span style={{ fontSize: fontSize.xxs, color: status.warning.color }}>
            {list.can_edit ? "Suggestions waiting for approval" : "Your suggestions, waiting for an editor"}
          </span>
          {list.pending.map(e => (
            <div key={e.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: fontSize.xs, color: neutral.textPrimary, fontWeight: fontWeight.medium }}>{e.title}</span>
              <span style={{ fontSize: fontSize.xxs, color: neutral.textPrimary, whiteSpace: "pre-wrap" }}>{e.body}</span>
              <span style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>
                {e.source === "navi" ? "Suggested by NAVI from a chat" : `Suggested by ${e.author_email}`} · {when(e.created_at)}
              </span>
              {list.can_edit && (
                <span style={{ display: "flex", gap: spacing.xs }}>
                  <button disabled={busy} style={primaryButton} onClick={() => void act(() => decideEntry(e.id, true))}>Approve</button>
                  <button disabled={busy} style={ghostButton} onClick={() => void act(() => decideEntry(e.id, false))}>Reject</button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {!adding && (
        <div>
          <button style={ghostButton} onClick={() => { setAdding(true); setNote(null); setError(null); }}>
            <PlusIcon size={10} /> {list.can_edit ? "Add an entry" : "Suggest an entry"}
          </button>
        </div>
      )}
      {adding && (
        <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
          <input placeholder="Title, e.g. Invoicing" value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} />
          <textarea
            placeholder="The fact, written so someone new could rely on it." value={body}
            onChange={e => setBody(e.target.value)} rows={4} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
          />
          <span style={{ display: "flex", gap: spacing.xs }}>
            <button
              disabled={busy || !title.trim() || !body.trim()}
              style={{ ...primaryButton, opacity: busy || !title.trim() || !body.trim() ? 0.5 : 1 }}
              onClick={async () => {
                if (await act(() => addEntry(scope, title, body))) {
                  setTitle(""); setBody(""); setAdding(false);
                  setNote(list.can_edit ? null : "Suggested. An editor approves it before NAVI uses it.");
                }
              }}
            >
              {list.can_edit ? "Add" : "Suggest"}
            </button>
            <button disabled={busy} style={ghostButton} onClick={() => setAdding(false)}>Cancel</button>
          </span>
        </div>
      )}
      {note && <div style={{ fontSize: fontSize.xxs, color: status.success.color }}>{note}</div>}
      <ErrorLine text={error} />

      {list.active.length === 0 && <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>Nothing in the library yet.</div>}
      {list.active.map(e => (
        <div key={e.id} style={{ ...boxStyle, display: "flex", flexDirection: "column", gap: 4, whiteSpace: "normal" }}>
          <span style={{ fontWeight: fontWeight.medium }}>{e.title}</span>
          <span style={{ whiteSpace: "pre-wrap", fontSize: fontSize.xxs }}>{e.body}</span>
          <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.xs }}>
            <span style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>
              {e.source === "editor" ? e.author_email : `Suggested by ${e.source === "navi" ? "NAVI" : e.author_email}, approved by ${e.decided_by}`} · {when(e.created_at)}
            </span>
            {list.can_edit && (
              <ConfirmButton label="Retire" confirmLabel="Retire it?" disabled={busy} onConfirm={() => void act(() => retireEntry(e.id))} />
            )}
          </span>
        </div>
      ))}
    </Panel>
  );
}

// ---- History -----------------------------------------------------------------------

function HistoryPanel({ scope, refreshKey }: { scope: Scope; refreshKey: number }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<HistoryEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetchHistory(scope).then(r => { if (isError(r)) setError(r.error); else setEvents(r.items); });
  }, [open, scope, refreshKey]);

  return (
    <Panel
      title="Change history"
      hint="Every change, who made it and when. Nobody can edit or delete this record, not even the Owner."
      right={<button style={{ ...ghostButton, border: "none" }} onClick={() => setOpen(o => !o)}><HistoryIcon size={12} /> {open ? "Hide" : "Show"}</button>}
    >
      {open && !events && <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>{error ?? "Loading…"}</div>}
      {open && events && events.length === 0 && <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>No changes yet.</div>}
      {open && events && events.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {events.map(ev => (
            <div key={ev.seq} style={{ display: "flex", gap: spacing.sm, fontSize: fontSize.xxs, lineHeight: 1.5 }}>
              <span style={{ color: neutral.textMuted, flexShrink: 0, fontVariantNumeric: "tabular-nums", minWidth: 130 }}>{when(ev.at)}</span>
              <span style={{ color: neutral.textPrimary, minWidth: 0, overflowWrap: "anywhere" }}>
                {ev.actor} {ACTION_LABEL[ev.action] ?? ev.action}
                {ev.detail && <span style={{ color: neutral.textMuted }}> · {ev.detail}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function ScopeKnowledge({ scope, me, onChanged }: { scope: Scope; me: KnowledgeOverview["me"]; onChanged: () => void }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const changed = () => { setRefreshKey(k => k + 1); onChanged(); };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing.xl }}>
      <BriefPanel scope={scope} me={me} onChanged={changed} />
      <LibraryPanel scope={scope} onChanged={changed} />
      <HistoryPanel scope={scope} refreshKey={refreshKey} />
    </div>
  );
}

// ---- Company knowledge ---------------------------------------------------------------

export function CompanyKnowledgeSettings({ overview, onChanged }: { overview: KnowledgeOverview; onChanged: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
      <SectionTitle>Company knowledge</SectionTitle>
      <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, lineHeight: 1.5, marginTop: -spacing.xs }}>
        What NAVI should know about the company in every chat. Only an Owner or Admin can change it, and every change
        needs a second person's approval, except the Owner's. Everyone can read it.
      </div>
      <ScopeKnowledge scope="company" me={overview.me} onChanged={onChanged} />
    </div>
  );
}

// ---- Projects -------------------------------------------------------------------------

function MembersPanel({ project, onChanged }: { project: ServerProject; onChanged: () => void }) {
  const [list, setList] = useState<MemberList | null>(null);
  const [addId, setAddId] = useState("");
  const [addAccess, setAddAccess] = useState<Access>("chat");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEdit = project.access === "edit";

  const load = useCallback(async () => {
    const r = await fetchMembers(project.id);
    if (isError(r)) setError(r.error); else setList(r);
  }, [project.id]);
  useEffect(() => { void load(); }, [load]);

  const change = async (userId: string, access: Access | null) => {
    setBusy(true);
    setError(null);
    const r = await setMember(project.id, userId, access);
    setBusy(false);
    if (isError(r)) { setError(r.error); return; }
    setAddId("");
    await load();
    onChanged();
  };

  return (
    <Panel
      title="Members"
      hint="Can chat: reads the project and chats in it. Can edit: also changes its brief, library and members. Owners and Admins can edit every project."
    >
      {!list && <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>{error ?? "Loading…"}</div>}
      {list?.members.map(m => (
        <div key={m.user_id} style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.xs,
          padding: `${spacing.xs}px ${spacing.sm}px`, borderRadius: radius.xs,
          background: "var(--surface-panel)", border: "1px solid var(--border-default)",
        }}>
          <span style={{ minWidth: 0, fontSize: fontSize.xs, color: neutral.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {m.name || m.email}
            {m.name && <span style={{ color: neutral.textMuted, fontSize: fontSize.xxs }}> · {m.email}</span>}
          </span>
          {m.via_role ? (
            <Chip tone="neutral">Owner / Admin</Chip>
          ) : canEdit ? (
            <span style={{ display: "flex", gap: spacing.xs, flexShrink: 0 }}>
              <select
                value={m.access} disabled={busy}
                onChange={e => void change(m.user_id, e.target.value as Access)}
                style={{ ...inputStyle, width: "auto", padding: `2px ${spacing.xs}px`, fontSize: fontSize.xxs }}
              >
                <option value="chat">Can chat</option>
                <option value="edit">Can edit</option>
              </select>
              <ConfirmButton label="Remove" confirmLabel="Remove?" disabled={busy} onConfirm={() => void change(m.user_id, null)} />
            </span>
          ) : (
            <Chip tone="neutral">{m.access === "edit" ? "Can edit" : "Can chat"}</Chip>
          )}
        </div>
      ))}
      {canEdit && list && list.addable.length > 0 && (
        <span style={{ display: "flex", gap: spacing.xs, flexWrap: "wrap" }}>
          <select value={addId} onChange={e => setAddId(e.target.value)} style={{ ...inputStyle, width: "auto", flex: 1, minWidth: 160 }}>
            <option value="">Add someone…</option>
            {list.addable.map(p => <option key={p.user_id} value={p.user_id}>{p.name || p.email}</option>)}
          </select>
          <select value={addAccess} onChange={e => setAddAccess(e.target.value as Access)} style={{ ...inputStyle, width: "auto" }}>
            <option value="chat">Can chat</option>
            <option value="edit">Can edit</option>
          </select>
          <button disabled={busy || !addId} style={{ ...primaryButton, opacity: busy || !addId ? 0.5 : 1 }} onClick={() => void change(addId, addAccess)}>
            Add
          </button>
        </span>
      )}
      <ErrorLine text={error} />
    </Panel>
  );
}

export function ProjectsSettings({ overview, initialProjectId, onChanged }: {
  overview: KnowledgeOverview; initialProjectId?: string | null; onChanged: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(initialProjectId ?? null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = overview.me.role !== "member";
  const project = overview.projects.find(p => p.id === openId) ?? null;

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const r = await createServerProject(name.trim());
    setBusy(false);
    if (isError(r)) { setError(r.error); return; }
    setName("");
    onChanged();
    setOpenId(r.id);
  };

  if (project) {
    const scope = `project:${project.id}` as Scope;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: spacing.lg }}>
        <div>
          <button style={{ ...ghostButton, border: "none", paddingLeft: 0 }} onClick={() => setOpenId(null)}>
            <ChevronLeftIcon size={12} /> All projects
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
          <SectionTitle>{project.name}</SectionTitle>
          <Chip tone="neutral">{project.access === "edit" ? "You can edit" : "You can chat"}</Chip>
        </div>
        <MembersPanel project={project} onChanged={onChanged} />
        <ScopeKnowledge scope={scope} me={overview.me} onChanged={onChanged} />
        {isAdmin && (
          <Panel title="Archive" hint="Hides the project for everyone. Its history is kept.">
            <div>
              <ConfirmButton
                label="Archive this project" confirmLabel="Archive it for everyone?" disabled={busy}
                onConfirm={async () => {
                  const r = await archiveProject(project.id);
                  if (isError(r)) setError(r.error); else { setOpenId(null); onChanged(); }
                }}
              />
            </div>
            <ErrorLine text={error} />
          </Panel>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
      <SectionTitle>Projects</SectionTitle>
      <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, lineHeight: 1.5, marginTop: -spacing.xs }}>
        A project is a client or an engagement. Chats in it read its brief and can search its library. Pick the project
        for a chat in the sidebar's Projects panel.
      </div>
      <span style={{ display: "flex", gap: spacing.xs }}>
        <input
          placeholder="New project name" value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") void create(); }} style={{ ...inputStyle, flex: 1 }}
        />
        <button disabled={busy || !name.trim()} style={{ ...primaryButton, opacity: busy || !name.trim() ? 0.5 : 1 }} onClick={() => void create()}>
          Create
        </button>
      </span>
      <ErrorLine text={error} />
      {overview.projects.length === 0 && (
        <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>No shared projects yet.</div>
      )}
      {overview.projects.map(p => {
        const waiting = overview.waiting[`project:${p.id}`] ?? 0;
        return (
          <button
            key={p.id} onClick={() => setOpenId(p.id)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.sm,
              padding: `${spacing.sm}px`, borderRadius: radius.sm, cursor: "pointer", textAlign: "left", fontFamily,
              background: "var(--surface-panel)", border: "1px solid var(--border-default)", color: neutral.textPrimary,
            }}
          >
            <span style={{ fontSize: fontSize.xs, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
            <span style={{ display: "flex", gap: spacing.xs, flexShrink: 0 }}>
              {waiting > 0 && <Chip tone="warning">{waiting} waiting for you</Chip>}
              <Chip tone="neutral">{p.access === "edit" ? "Can edit" : "Can chat"}</Chip>
            </span>
          </button>
        );
      })}
    </div>
  );
}
