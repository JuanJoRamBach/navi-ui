import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDownIcon, CheckIcon, PencilIcon, ZapIcon, PaperAirplaneIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT, tintedSurface, tintedGlow } from "./tokens";
import { DevSlateDotGrid } from "./DevSlateDotGrid";
import { fetchModelCatalog, setPinnedModel, type ModelCatalog } from "./devslate";
import { NAVI_BACKEND_URL } from "./config";
import { WORKFLOW_CREATED_EVENT } from "./agentWork";

// Same visual template as Dev Slate's own chat (DevSlateChat.tsx) — dot-grid
// background, bottom-anchored bubbles, floating input pill, model picker +
// edit-mode selector below it — just amber instead of teal (JuanJo,
// 2026-09-01: "use the template of Dev Slate UI... same background and
// same animation, just change the color to amber"). Functionally simpler
// than Dev Slate's in one real way: no file-relay WebSocket — this is a
// plain request/response chat against NAVI's existing /chat/send with
// mode: "agent_work" (see dispatcher/chat.py + dispatcher/modes/
// AGENT_WORK_CHAT.md on the backend), same endpoint every other chat mode
// already uses.

const accent = CANVAS_ACCENT.agentWork.color;
const FLOAT_CLUSTER_RESERVE = 104; // input pill + the edit-mode/model row below it

// Simulated streaming (2026-09-02, JuanJo: "be a bit dramatic, add micro
// delays every period... it gives a suspenseful and time to read"). This
// is NOT real token streaming — /chat/send is a plain blocking POST, the
// full reply already exists by the time this runs. It's a client-side
// typewriter reveal of a reply that already arrived, with an extra pause
// after each sentence for pacing.
const STREAM_CHAR_DELAY_MS = 14;
const STREAM_PERIOD_PAUSE_MS = 200;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function ModelBadge() {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(() => {
    fetchModelCatalog("agent_work").then(setCatalog).catch(() => setCatalog(null));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const pick = async (provider: string, model: string) => {
    setSaving(true);
    const ok = await setPinnedModel("agent_work", provider, model);
    setSaving(false);
    setOpen(false);
    if (ok) refresh();
  };

  const currentLabel = catalog?.current ? `${catalog.current.provider}/${catalog.current.model}` : "loading…";

  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Model used for this chat"
        style={{
          display: "flex", alignItems: "center", gap: spacing.xxs, minWidth: 0,
          padding: `${spacing.xxs}px ${spacing.xs}px`, borderRadius: radius.sm,
          border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)",
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
          position: "absolute", bottom: "100%", right: 0, marginBottom: spacing.xxs, zIndex: 50,
          width: 280, maxHeight: 320, overflowY: "auto",
          background: "#111318", border: "1px solid rgba(255,255,255,0.12)", borderRadius: radius.sm,
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)", padding: spacing.xs,
        }}>
          <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, padding: `${spacing.xxs}px ${spacing.xs}px` }}>
            Model for this chat — needs tool-calling, Groq/OpenRouter excluded (see config/store.py)
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

// Review-vs-auto-accept, same concept as Dev Slate's own EditModeSelector
// but a different mechanism underneath: Agent Work's chat is plain REST,
// no live connection to pause on, so "review" works via prompt
// instruction (see dispatcher/chat.py's AGENT_WORK_REVIEW_INSTRUCTION) —
// the model describes what it would create/run and waits for an explicit
// confirmation on a later turn, rather than a real pending-action gate.
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
        title="How proposed workflows are created/run"
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

const WAKE_POLL_INTERVAL_MS = 5000;
const WAKE_MAX_WAIT_MS = 90000;

async function waitForServer(onStatus: (msg: string) => void): Promise<boolean> {
  const deadline = Date.now() + WAKE_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(NAVI_BACKEND_URL, { method: "GET" });
      if (res.ok) return true;
    } catch {
      // still asleep/booting — keep polling
    }
    onStatus("Waking up NAVI…");
    await new Promise(r => setTimeout(r, WAKE_POLL_INTERVAL_MS));
  }
  return false;
}

interface AgentWorkMessage {
  role: "user" | "navi";
  text: string;
  at: number; // epoch ms — captured client-side when the message is added, not persisted
  usageNote?: string; // navi replies only, when the provider reported one (tokens or Cloudflare Neurons)
}

function formatMessageTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Real server-side conversation memory (2026-09-01 — see
// how_to_handle_context.md), same /chat/send + conversation_id mechanism
// Main Chat uses. sessionStorage, not IndexedDB — this popup has no
// conversation-list/branch model of its own, just one ongoing
// conversation for the tab's session; a fresh session starts clean
// (matches the "no migration" simplicity of the server-authority
// decision).
const AGENT_WORK_CONVERSATION_ID_KEY = "navi-agent-work-conversation-id";

export function AgentWorkChat({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<AgentWorkMessage[]>([]);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  // Default false ("review") — matches Dev Slate's own default (config/
  // store.py: "default is manual per-diff review, auto-accept is an
  // explicit opt-in").
  const [autoAccept, setAutoAccept] = useState(false);
  const sendingRef = useRef(false);
  const conversationIdRef = useRef<string | null>(sessionStorage.getItem(AGENT_WORK_CONVERSATION_ID_KEY));

  // Hydrate from the server on mount — the id survives a page refresh via
  // sessionStorage above, but until now the displayed messages didn't:
  // the server (storage/conversations.py) always had the full history,
  // the UI just never fetched it back (2026-09-02 bug report). Reuses
  // the generic /devslate/conversations/{id}/messages route — despite
  // the "devslate" in the path, get_messages() is mode-agnostic, so no
  // new backend route is needed just for this.
  useEffect(() => {
    const id = conversationIdRef.current;
    if (!id) return;
    fetch(`${NAVI_BACKEND_URL}/devslate/conversations/${encodeURIComponent(id)}/messages`)
      .then(res => res.json())
      .then((data: { messages?: { role: string; content: string; created_at?: number }[] }) => {
        // Backend (storage/conversations.py, via dispatcher/chat.py's
        // append_message calls) stores the assistant's own role as
        // "navi", not "assistant" — matching that here (2026-09-02 fix;
        // the mismatch was why only user messages survived a refresh).
        // No usage_note for restored messages — that's a per-call fact
        // from the provider's response, never persisted to storage.
        const restored = (data.messages ?? [])
          .filter(m => m.role === "user" || m.role === "navi")
          .map(m => ({
            role: m.role === "user" ? "user" as const : "navi" as const,
            text: m.content, at: (m.created_at ?? Date.now() / 1000) * 1000,
          }));
        if (restored.length) setMessages(restored);
      })
      .catch(() => {});
  }, []);

  // Resizable, not native CSS `resize` (JuanJo, 2026-09-01: the native
  // handle sits at the box's bottom-right corner, which is exactly the
  // corner pinned to the screen edge here — dragging it does nothing
  // visually, the box just grows out from behind a handle that never
  // moves). This panel's bottom-right corner is the anchor (App.tsx
  // positions the wrapper via bottom/right) and can't sensibly get a
  // handle of its own — but every OTHER edge/corner can: top edge
  // (height), left edge (width), top-left corner (both). Same window-
  // pointermove/pointerup drag pattern App.tsx's own sidebar/right-panel
  // resize handles already use, parameterized by which axes a given
  // handle controls.
  const [size, setSize] = useState({ width: 380, height: 520 });
  const resizeRef = useRef<{ startX: number; startY: number; startWidth: number; startHeight: number } | null>(null);
  const handleResizeStart = useCallback((axes: "both" | "width" | "height") => (e: React.PointerEvent) => {
    resizeRef.current = { startX: e.clientX, startY: e.clientY, startWidth: size.width, startHeight: size.height };
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const onMove = (moveEvent: PointerEvent) => {
      if (!resizeRef.current) return;
      const { startX, startY, startWidth, startHeight } = resizeRef.current;
      const maxWidth = window.innerWidth - 48;
      const maxHeight = window.innerHeight - 48;
      setSize(prev => ({
        width: axes === "height" ? prev.width : Math.min(maxWidth, Math.max(300, startWidth - (moveEvent.clientX - startX))),
        height: axes === "width" ? prev.height : Math.min(maxHeight, Math.max(360, startHeight - (moveEvent.clientY - startY))),
      }));
    };
    const onUp = () => {
      resizeRef.current = null;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [size]);

  const revealText = useCallback(async (fullText: string, usageNote?: string) => {
    setPending(null);
    setStreamingText("");
    for (let i = 1; i <= fullText.length; i++) {
      setStreamingText(fullText.slice(0, i));
      await sleep(fullText[i - 1] === "." ? STREAM_CHAR_DELAY_MS + STREAM_PERIOD_PAUSE_MS : STREAM_CHAR_DELAY_MS);
    }
    setMessages(m => [...m, { role: "navi", text: fullText, at: Date.now(), usageNote }]);
    setStreamingText(null);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sendingRef.current) return;
    sendingRef.current = true;
    setInput("");
    setMessages(m => [...m, { role: "user", text, at: Date.now() }]);
    setPending("Thinking…");

    const post = () => fetch(`${NAVI_BACKEND_URL}/chat/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text, mode: "agent_work", auto_accept: autoAccept,
        ...(conversationIdRef.current ? { conversation_id: conversationIdRef.current } : {}),
      }),
    }).then(res => res.json());

    try {
      let data: { reply?: string; error?: string; conversation_id?: string; usage_note?: string };
      try {
        data = await post();
      } catch {
        setPending("Waking up NAVI…");
        const awake = await waitForServer(setPending);
        if (!awake) {
          setMessages(m => [...m, { role: "navi", text: "Couldn't reach NAVI after a while — it may be down. Try again shortly.", at: Date.now() }]);
          return;
        }
        data = await post();
      }
      if (data.conversation_id && data.conversation_id !== conversationIdRef.current) {
        conversationIdRef.current = data.conversation_id;
        sessionStorage.setItem(AGENT_WORK_CONVERSATION_ID_KEY, data.conversation_id);
      }
      await revealText(data.reply ?? data.error ?? "(empty reply)", data.usage_note);
      // Tool calls (create_workflow, run_workflow) happen entirely
      // server-side — this popup has no visibility into which ones fired,
      // so refresh the sidebar's workflow/run lists unconditionally after
      // every reply rather than trying to detect specific tool calls.
      window.dispatchEvent(new Event(WORKFLOW_CREATED_EVENT));
    } catch {
      setMessages(m => [...m, { role: "navi", text: "That message failed to send — try again.", at: Date.now() }]);
    } finally {
      setPending(null);
      sendingRef.current = false;
    }
  }, [input, autoAccept, revealText]);

  const reversedMessages = [...messages].reverse();

  return (
    <div style={{
      position: "relative",
      width: size.width, height: size.height,
      display: "flex", flexDirection: "column",
      background: "rgba(10,12,18,0.95)", border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: radius.lg, boxShadow: `0 8px 30px rgba(0,0,0,0.5), 0 0 20px ${CANVAS_ACCENT.agentWork.glow}`,
      overflow: "hidden", fontFamily,
    }}>
      {/* Top-left corner — resizes both axes. */}
      <div
        onPointerDown={handleResizeStart("both")}
        title="Drag to resize"
        aria-hidden="true"
        style={{
          position: "absolute", top: 0, left: 0, width: 16, height: 16, zIndex: 3,
          cursor: "nwse-resize",
        }}
      >
        <div style={{
          position: "absolute", top: 4, left: 4, width: 8, height: 8,
          borderTop: "2px solid rgba(255,255,255,0.25)", borderLeft: "2px solid rgba(255,255,255,0.25)",
          borderTopLeftRadius: 3,
        }} />
      </div>
      {/* Top edge — height only. */}
      <div
        onPointerDown={handleResizeStart("height")}
        title="Drag to resize"
        aria-hidden="true"
        style={{ position: "absolute", top: 0, left: 16, right: 0, height: 6, zIndex: 3, cursor: "ns-resize" }}
      />
      {/* Left edge — width only. */}
      <div
        onPointerDown={handleResizeStart("width")}
        title="Drag to resize"
        aria-hidden="true"
        style={{ position: "absolute", top: 16, left: 0, bottom: 0, width: 6, zIndex: 3, cursor: "ew-resize" }}
      />
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: `${spacing.sm}px ${spacing.md}px`, borderBottom: "1px solid rgba(255,255,255,0.08)",
        position: "relative", zIndex: 2, background: "rgba(10,12,18,0.6)",
      }}>
        <span style={{ fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: neutral.textPrimary }}>
          Agent Work chat
        </span>
        <button
          aria-label="Collapse chat"
          onClick={onClose}
          style={{
            width: 22, height: 22, borderRadius: radius.xs, border: "none", background: "transparent",
            color: neutral.textMuted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          ×
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <DevSlateDotGrid accentColor={accent} />

        <div className="hide-scrollbar message-fade-top" style={{
          position: "relative", zIndex: 1, height: "100%", overflowY: "auto", padding: spacing.sm,
          paddingBottom: FLOAT_CLUSTER_RESERVE,
          display: "flex", flexDirection: "column-reverse", gap: spacing.sm,
        }}>
          {messages.length === 0 && !pending && (
            <div style={{ alignSelf: "center", margin: "auto", textAlign: "center", color: neutral.textFaint, fontSize: fontSize.xxs, maxWidth: 260 }}>
              Describe a workflow and I'll define and run it — one task or several
              steps, on demand or on a schedule.
            </div>
          )}
          {pending && streamingText === null && (
            <div style={{
              alignSelf: "flex-start", display: "flex", alignItems: "center", gap: spacing.xs,
              padding: `${spacing.xxs}px ${spacing.xs}px`, fontSize: fontSize.xxs, color: neutral.textFaint, fontFamily,
            }}>
              <span className="step-pulse" style={{ width: 6, height: 6, borderRadius: 9999, background: accent }} />
              <span className="step-pulse">{pending}</span>
            </div>
          )}
          {streamingText !== null && (
            <div style={{
              alignSelf: "flex-start", maxWidth: "90%",
              background: tintedSurface(CANVAS_ACCENT.agentWork.hue, 21, 0.045),
              border: `1px solid oklch(65% 0.12 ${CANVAS_ACCENT.agentWork.hue} / 0.3)`,
              boxShadow: `0 4px 18px rgba(0,0,0,0.35), 0 0 14px ${CANVAS_ACCENT.agentWork.glow}`,
              borderRadius: radius.lg, padding: `${spacing.sm}px ${spacing.md}px`,
              fontSize: fontSize.sm, color: "rgba(246, 246, 246, 0.85)", whiteSpace: "pre-wrap",
            }}>
              {streamingText}
              <span className="step-pulse" style={{ opacity: 0.7 }}>▍</span>
            </div>
          )}
          {reversedMessages.map((m, i) => (
            <div key={reversedMessages.length - i} style={{
              display: "flex", flexDirection: "column", gap: 3,
              alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "90%",
            }}>
              <div style={{
                background: m.role === "user" ? neutral.userBubbleBg : tintedSurface(CANVAS_ACCENT.agentWork.hue, 21, 0.045),
                border: m.role === "user"
                  ? `1px solid ${neutral.userBubbleBorder}`
                  : `1px solid oklch(65% 0.12 ${CANVAS_ACCENT.agentWork.hue} / 0.3)`,
                boxShadow: m.role === "user"
                  ? `0 4px 18px rgba(0,0,0,0.35), 0 0 14px ${neutral.userBubbleGlow}`
                  : `0 4px 18px rgba(0,0,0,0.35), 0 0 14px ${CANVAS_ACCENT.agentWork.glow}`,
                borderRadius: radius.lg, padding: `${spacing.sm}px ${spacing.md}px`,
                fontSize: fontSize.sm,
                color: m.role === "user" ? neutral.textPrimary : "rgba(246, 246, 246, 0.85)",
                whiteSpace: "pre-wrap",
              }}>
                {m.text}
              </div>
              {/* Metadata line — outside the bubble, not part of the
                  reply's own text (2026-09-02, JuanJo: "not inside the
                  bubble, just below it... 'date · X tokens were used'"). */}
              <div style={{
                fontSize: fontSize.xxs, color: neutral.textFaint, padding: `0 ${spacing.xxs}px`,
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              }}>
                {formatMessageTime(m.at)}{m.usageNote ? ` · ${m.usageNote}` : ""}
              </div>
            </div>
          ))}
        </div>

        <div style={{
          position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 2,
          padding: spacing.sm,
        }}>
          <div style={{
            display: "flex", alignItems: "flex-end", gap: spacing.xs,
            padding: spacing.xs, borderRadius: radius.xl,
            background: neutral.surface, border: "1px solid rgba(255,255,255,0.12)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder="Describe a workflow…"
              style={{
                flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none",
                color: neutral.textPrimary, fontSize: fontSize.sm, fontFamily,
                padding: `${spacing.xs}px ${spacing.xs}px`,
              }}
            />
            <button onClick={() => void send()} disabled={!input.trim() || !!pending} aria-label="Send" title="Send" style={{
              flexShrink: 0, width: 30, height: 30,
              display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: radius.md, border: `1px solid ${tintedGlow(CANVAS_ACCENT.agentWork.hue, 0.4)}`,
              background: tintedGlow(CANVAS_ACCENT.agentWork.hue, 0.15), color: accent,
              cursor: input.trim() && !pending ? "pointer" : "default", opacity: input.trim() && !pending ? 1 : 0.5,
            }}>
              <PaperAirplaneIcon size={14} />
            </button>
          </div>

          {/* Edit mode at bottom-left, model picker at bottom-right —
              same layout as Dev Slate's own chat. */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.xs, marginTop: spacing.xs, flexWrap: "wrap", minWidth: 0 }}>
            <EditModeSelector autoAccept={autoAccept} onChange={setAutoAccept} />
            <ModelBadge />
          </div>
        </div>
      </div>
    </div>
  );
}
