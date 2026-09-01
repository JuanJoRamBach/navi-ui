import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, CheckIcon, PaperclipIcon, XIcon, FileIcon, PencilIcon, ZapIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT } from "./tokens";
import {
  connectDevSlate, createSlate, fetchModelCatalog, loadSlateHistory, setPinnedModel,
  type DevSlateConnection, type DevSlateMessage, type ModelCatalog,
} from "./devslate";
import { connectFolder, getConnectedFolderName, hasLocalFsSupport, listAllFiles, readLocalFile } from "./devslateFs";
import { requestWriteReview, useDevSlateState } from "./devslateStore";
import "./devslate-chat-bg.css";

const accent = CANVAS_ACCENT.devSlate.color;

// Reads/writes the current Slate id from sessionStorage — a Root Slate
// per browser session for now (sub-Slates / a real Slate switcher aren't
// wired to any UI action yet, see dispatcher/devslate_chat.py's module
// docstring). Cheap persistence so a reload doesn't silently start a
// brand-new Slate and lose history.
const SLATE_ID_KEY = "navi-devslate-root-id";

function useDevSlateConversation() {
  const [conversationId, setConversationId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = sessionStorage.getItem(SLATE_ID_KEY);
      if (stored) {
        if (!cancelled) setConversationId(stored);
        return;
      }
      const slate = await createSlate();
      sessionStorage.setItem(SLATE_ID_KEY, slate.id);
      if (!cancelled) setConversationId(slate.id);
    })();
    return () => { cancelled = true; };
  }, []);

  return conversationId;
}

function ModelBadge({ conversationId }: { conversationId: string }) {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(() => {
    fetchModelCatalog("devslate").then(setCatalog).catch(() => setCatalog(null));
  }, []);

  useEffect(() => { refresh(); }, [refresh, conversationId]);

  const pick = async (provider: string, model: string) => {
    setSaving(true);
    const ok = await setPinnedModel("dev_slate_chat", provider, model);
    setSaving(false);
    setOpen(false);
    if (ok) refresh();
  };

  const currentLabel = catalog?.current ? `${catalog.current.provider}/${catalog.current.model}` : "loading…";

  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Model used for this Slate's chat"
        style={{
          display: "flex", alignItems: "center", gap: spacing.xxs, minWidth: 0,
          padding: `${spacing.xxs}px ${spacing.xs}px`, borderRadius: radius.sm,
          border: `1px solid rgba(255,255,255,0.1)`, background: "rgba(255,255,255,0.04)",
          color: neutral.textMuted, cursor: "pointer", fontSize: fontSize.xxs, fontFamily,
          maxWidth: 150, overflow: "hidden",
        }}
      >
        <span style={{ width: 5, height: 5, borderRadius: 9999, background: accent, flexShrink: 0 }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentLabel}</span>
        <ChevronDownIcon size={11} />
      </button>
      {open && (
        <div style={{
          // Opens upward — this badge now sits near the pane's bottom
          // edge (moved there 2026-09-01), a downward "top:100%" popover
          // would get clipped by the pane's own bottom boundary.
          position: "absolute", bottom: "100%", right: 0, marginBottom: spacing.xxs, zIndex: 50,
          width: 280, maxHeight: 320, overflowY: "auto",
          background: "#111318", border: "1px solid rgba(255,255,255,0.12)", borderRadius: radius.sm,
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)", padding: spacing.xs,
        }}>
          <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, padding: `${spacing.xxs}px ${spacing.xs}px` }}>
            Model for this Slate — Groq excluded (8K TPM too tight for Dev Slate's context size)
          </div>
          {!catalog?.candidates.length && (
            <div style={{ fontSize: fontSize.xxs, color: neutral.textMuted, padding: spacing.xs }}>No ranked candidates cached yet.</div>
          )}
          {catalog?.candidates.map(c => {
            const isCurrent = catalog.current?.provider === c.provider && catalog.current?.model === c.model;
            return (
              <button
                key={`${c.provider}/${c.model}`}
                disabled={saving || isCurrent}
                onClick={() => pick(c.provider, c.model)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.xs,
                  width: "100%", textAlign: "left", padding: `${spacing.xxs}px ${spacing.xs}px`,
                  borderRadius: radius.xs, border: "none",
                  background: isCurrent ? "rgba(255,255,255,0.06)" : "transparent",
                  color: isCurrent ? neutral.textPrimary : neutral.textMuted,
                  cursor: isCurrent ? "default" : "pointer", fontSize: fontSize.xxs, fontFamily,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.provider}/{c.model}</span>
                {isCurrent && <CheckIcon size={12} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// The "kind of edition" selector — review-first vs. auto-accept, per
// write_file's default-mode decision (JuanJo, 2026-09-01: default is
// manual per-diff review, auto-accept is an explicit opt-in). Compact
// icon+label trigger that opens a small floating popup with the two
// options, same shape as ModelBadge right next to it — JuanJo's call,
// 2026-09-01: both small, both under the input, not an always-expanded
// segmented control.
function EditModeSelector({ autoAccept, onChange }: { autoAccept: boolean; onChange: (value: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const OPTIONS: { value: boolean; label: string; icon: typeof PencilIcon }[] = [
    { value: false, label: "Review changes", icon: PencilIcon },
    { value: true, label: "Auto-accept", icon: ZapIcon },
  ];
  const current = OPTIONS.find(o => o.value === autoAccept)!;

  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="How proposed edits are applied"
        style={{
          display: "flex", alignItems: "center", gap: 4, minWidth: 0,
          padding: `${spacing.xxs}px ${spacing.xs}px`, borderRadius: radius.sm,
          border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)",
          color: neutral.textMuted, cursor: "pointer", fontSize: fontSize.xxs, fontFamily,
        }}
      >
        <current.icon size={11} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current.label}</span>
        <ChevronDownIcon size={11} />
      </button>
      {open && (
        <div style={{
          position: "absolute", bottom: "100%", left: 0, marginBottom: spacing.xxs, zIndex: 50,
          width: 180, background: "#111318", border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: radius.sm, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", padding: spacing.xs,
        }}>
          {OPTIONS.map(({ value, label, icon: Icon }) => {
            const active = autoAccept === value;
            return (
              <button
                key={label}
                onClick={() => { onChange(value); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.xs,
                  width: "100%", textAlign: "left", padding: `${spacing.xxs}px ${spacing.xs}px`,
                  borderRadius: radius.xs, border: "none",
                  background: active ? "rgba(255,255,255,0.06)" : "transparent",
                  color: active ? neutral.textPrimary : neutral.textMuted,
                  cursor: active ? "default" : "pointer", fontSize: fontSize.xxs, fontFamily,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Icon size={12} /> {label}</span>
                {active && <CheckIcon size={12} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// The user handing the model a file directly — distinct from read_file,
// which is the model deciding on its own to pull one in. Attaching is
// the more reliable path when the user already knows exactly what's
// relevant, rather than hoping the model asks for the right file.
function AttachFilePicker({ attached, onAttach }: { attached: string[]; onAttach: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [files, setFiles] = useState<string[] | null>(null);

  useEffect(() => {
    if (!open) return;
    listAllFiles().then(setFiles).catch(() => setFiles([]));
  }, [open]);

  const filtered = (files ?? []).filter(p => p.toLowerCase().includes(filter.toLowerCase()) && !attached.includes(p)).slice(0, 40);

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Attach a file to this message"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          width: 30, height: 30, borderRadius: radius.sm,
          border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)",
          color: neutral.textMuted, cursor: "pointer",
        }}
      >
        <PaperclipIcon size={14} />
      </button>
      {open && (
        <div style={{
          position: "absolute", bottom: "100%", left: 0, marginBottom: spacing.xxs, zIndex: 50,
          width: 260, maxHeight: 280, display: "flex", flexDirection: "column",
          background: "#111318", border: "1px solid rgba(255,255,255,0.12)", borderRadius: radius.sm,
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        }}>
          <input
            autoFocus
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter files…"
            style={{
              margin: spacing.xs, padding: spacing.xxs, borderRadius: radius.xs,
              border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)",
              color: neutral.textPrimary, fontSize: fontSize.xxs, fontFamily,
            }}
          />
          <div style={{ overflowY: "auto", padding: `0 ${spacing.xs}px ${spacing.xs}px` }}>
            {files === null && <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, padding: spacing.xs }}>Loading…</div>}
            {files !== null && filtered.length === 0 && (
              <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, padding: spacing.xs }}>No matching files.</div>
            )}
            {filtered.map(path => (
              <button
                key={path}
                onClick={() => { onAttach(path); setOpen(false); setFilter(""); }}
                style={{
                  display: "flex", alignItems: "center", gap: spacing.xxs, width: "100%", textAlign: "left",
                  padding: `${spacing.xxs}px ${spacing.xs}px`, borderRadius: radius.xs, border: "none",
                  background: "transparent", color: neutral.textPrimary, cursor: "pointer",
                  fontSize: fontSize.xxs, fontFamily,
                }}
              >
                <FileIcon size={12} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{path}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function DevSlateChat() {
  const conversationId = useDevSlateConversation();
  const [messages, setMessages] = useState<DevSlateMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");
  const [autoAccept, setAutoAccept] = useState(false);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [attachedPaths, setAttachedPaths] = useState<string[]>([]);
  const [activity, setActivity] = useState<string | null>(null);
  const connRef = useRef<DevSlateConnection | null>(null);
  const autoAcceptRef = useRef(autoAccept);
  autoAcceptRef.current = autoAccept;
  const { pendingWrite } = useDevSlateState();

  useEffect(() => {
    getConnectedFolderName().then(setFolderName);
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;

    loadSlateHistory(conversationId).then(({ messages: history }) => {
      if (!cancelled) setMessages(history);
    });

    const conn = connectDevSlate(conversationId, {
      onMessage: (msg) => { setActivity(null); setMessages(m => [...m, msg]); },
      onStatusChange: setStatus,
      onActivity: setActivity,
      getAutoAccept: () => autoAcceptRef.current,
      onWriteRequest: (write) => requestWriteReview(write),
    });
    connRef.current = conn;

    return () => { cancelled = true; conn.close(); };
  }, [conversationId]);

  const send = async () => {
    const text = input.trim();
    if (!text || !connRef.current) return;

    // Attached files are read fresh at send time (not when picked) so
    // the model sees their current content even if they changed in
    // between — wrapped the same way a real coding-agent's explicit
    // file context reads, one tagged block per file, ahead of the
    // user's own text.
    let outgoing = text;
    if (attachedPaths.length > 0) {
      const blocks = await Promise.all(attachedPaths.map(async (path) => {
        const content = await readLocalFile(path);
        return `<attached_file path="${path}">\n${content}\n</attached_file>`;
      }));
      outgoing = `${blocks.join("\n\n")}\n\n${text}`;
    }

    setMessages(m => [...m, { role: "user", text: attachedPaths.length ? `${text}\n\n📎 ${attachedPaths.join(", ")}` : text }]);
    connRef.current.send(outgoing);
    setInput("");
    setAttachedPaths([]);
  };

  const handleConnectFolder = async () => {
    const name = await connectFolder();
    if (name) setFolderName(name);
  };

  // column-reverse means DOM-first renders visually last (pinned at the
  // bottom) — same "spawns from the bottom, grows upward" technique the
  // main Chat canvas already uses, no scroll-to-bottom JS needed. The
  // activity/pendingWrite indicators go BEFORE the reversed messages in
  // DOM order so they land at the very bottom, exactly where the real
  // reply will appear once it arrives.
  const reversedMessages = useMemo(() => [...messages].reverse(), [messages]);

  return (
    // minWidth is a hard floor, not a suggestion — react-resizable-panels'
    // Panel sizing is percentage-based and doesn't stop the user dragging
    // this pane narrower than its content can sit comfortably in (JuanJo,
    // 2026-09-01: "I can squash elements so much it deforms the UI").
    // Below this width the pane scrolls horizontally instead of squashing
    // its rows.
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 220, overflowX: "auto", fontFamily, position: "relative" }}>
      {/* Left-padded — the app-wide floating "open left sidebar" button
          (position:absolute, top:spacing.xl, width:controlSize.md,
          zIndex:31) floats over whatever's in that corner regardless of
          canvas; Dev Slate's Chat pane is just the first one to put
          real content there. Shifting this row clear of it keeps the
          button a true floating overlay (no reserved dead space
          elsewhere in the canvas — that was tried and looked bad,
          JuanJo 2026-09-01). 52px ≈ spacing.xl(20) + controlSize.md(38). */}
      <div style={{
        display: "flex", alignItems: "center", gap: spacing.xs,
        padding: spacing.sm, paddingLeft: 52,
        borderBottom: "2px solid rgba(255,255,255,0.08)", flexShrink: 0, zIndex: 1,
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: 9999, flexShrink: 0,
          background: status === "open" ? "#3ecf8e" : status === "connecting" ? "#e0b94a" : "#e05a4a",
        }} title={status} />
      </div>

      {!folderName && (
        <div style={{ padding: spacing.sm, borderBottom: "2px solid rgba(255,255,255,0.08)" }}>
          {hasLocalFsSupport() ? (
            <button onClick={handleConnectFolder} style={{
              width: "100%", padding: spacing.xs, borderRadius: radius.sm, border: `1px solid ${accent}66`,
              background: "transparent", color: accent, cursor: "pointer", fontSize: fontSize.xs, fontFamily,
            }}>
              Connect a project folder
            </button>
          ) : (
            <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint }}>
              Local file access needs Chrome, Edge, or Opera — this browser doesn't support it yet.
            </div>
          )}
        </div>
      )}
      {folderName && (
        <div style={{ padding: `${spacing.xxs}px ${spacing.sm}px`, fontSize: fontSize.xxs, color: neutral.textFaint, borderBottom: "2px solid rgba(255,255,255,0.08)" }}>
          Connected: {folderName}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <div className="devslate-chat-bg">
          <div className="devslate-chat-bg-dots" />
          <div className="devslate-chat-bg-glow" />
        </div>
        <div className="hide-scrollbar message-fade-top" style={{
          position: "relative", zIndex: 1, height: "100%", overflowY: "auto", padding: spacing.sm,
          display: "flex", flexDirection: "column-reverse", gap: spacing.sm,
        }}>
          {activity && (
            <div style={{
              alignSelf: "flex-start", display: "flex", alignItems: "center", gap: spacing.xs,
              padding: `${spacing.xxs}px ${spacing.xs}px`, fontSize: fontSize.xxs, color: neutral.textFaint, fontFamily,
            }}>
              <span className="step-pulse" style={{ width: 6, height: 6, borderRadius: 9999, background: accent }} />
              <span className="step-pulse">{activity}</span>
            </div>
          )}
          {pendingWrite && (
            <div style={{
              alignSelf: "flex-start", display: "flex", alignItems: "center", gap: spacing.xs,
              border: `1px solid ${accent}55`, borderRadius: radius.sm, padding: spacing.xs,
              fontSize: fontSize.xxs, color: neutral.textMuted, fontFamily: "monospace",
            }}>
              <CheckIcon size={12} />
              Reviewing a change to {pendingWrite.path} — see the Code pane
            </div>
          )}
          {reversedMessages.map((m, i) => (
            <div key={reversedMessages.length - i} style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "90%",
              background: m.role === "user" ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
              borderRadius: radius.sm, padding: spacing.xs, fontSize: fontSize.sm, color: neutral.textPrimary,
              whiteSpace: "pre-wrap",
            }}>
              {m.text}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs, padding: spacing.sm, borderTop: "2px solid rgba(255,255,255,0.08)" }}>
        {attachedPaths.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: spacing.xxs }}>
            {attachedPaths.map(path => (
              <span key={path} style={{
                display: "flex", alignItems: "center", gap: 4, padding: `2px ${spacing.xxs}px`,
                borderRadius: radius.xs, background: "rgba(255,255,255,0.06)",
                fontSize: fontSize.xxs, color: neutral.textMuted, fontFamily: "monospace",
              }}>
                {path}
                <button
                  onClick={() => setAttachedPaths(paths => paths.filter(p => p !== path))}
                  style={{ display: "flex", background: "none", border: "none", color: neutral.textFaint, cursor: "pointer", padding: 0 }}
                >
                  <XIcon size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: spacing.xs }}>
          {folderName && (
            <AttachFilePicker
              attached={attachedPaths}
              onAttach={(path) => setAttachedPaths(paths => paths.includes(path) ? paths : [...paths, path])}
            />
          )}
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder="Ask for a change…"
            style={{
              flex: 1, minWidth: 0, padding: spacing.xs, borderRadius: radius.sm, border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.03)", color: neutral.textPrimary, fontSize: fontSize.sm, fontFamily,
            }}
          />
          <button onClick={() => void send()} disabled={status !== "open"} style={{
            flexShrink: 0, padding: `${spacing.xs}px ${spacing.md}px`, borderRadius: radius.sm, border: "none",
            background: accent, color: "#08110d", cursor: status === "open" ? "pointer" : "default",
            fontSize: fontSize.sm, fontWeight: fontWeight.medium, fontFamily, opacity: status === "open" ? 1 : 0.5,
          }}>
            Send
          </button>
        </div>

        {/* "Kind of edition" (review-vs-auto-accept) at bottom-left,
            model selector at bottom-right — both compact, both under
            the input, JuanJo's layout call 2026-09-01. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.xs, minWidth: 0 }}>
          <EditModeSelector autoAccept={autoAccept} onChange={setAutoAccept} />
          {conversationId && <ModelBadge conversationId={conversationId} />}
        </div>
      </div>
    </div>
  );
}
