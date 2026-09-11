import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDownIcon, CheckIcon, PaperAirplaneIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, tintedSurface, tintedGlow, surface } from "./tokens";
import { DevSlateDotGrid } from "./DevSlateDotGrid";
import { fetchModelCatalog, setPinnedModel, type ModelCatalog } from "./devslate";
import { NAVI_BACKEND_URL } from "./config";
import { ChoiceButtons } from "./ChoiceButtons";

// AgentWorkChat.tsx's exact UI, recolored (2026-09-10, JuanJo: "just
// copy the UI of the agent work chat, apply it there, change the colors
// to neutral ones... as it will be a chat that doesn't live in a
// Canvas"). Deliberately a SEPARATE component, not a shared one with a
// color prop — these are two unrelated concepts that happen to share a
// visual template (a canvas-scoped helper chat for editing one workflow
// vs. a rail-triggered chat for running one saved standalone agent),
// not two variants of the same feature. No coordination between them,
// no shared state, nothing to keep in sync.
//
// "Neutral, considering day/night" — real mechanism, not invented: hue-
// based helpers (tintedGlow, tintedSurface, ChoiceButtons' own color)
// all already mirror lightness for day/night automatically; passing
// chroma=0 to each (new optional param, see tokens.ts/ChoiceButtons.tsx)
// makes the hue argument irrelevant and yields a true gray at the same
// theme-correct lightness, rather than building a parallel gray-only
// color path. neutral.userBubbleGlow/textMuted are used directly where
// a plain (non-hue) neutral token already existed.
//
// Real per-agent backend now wired (2026-09-11): posts to
// POST /agents/{agentId}/chat (server.py), which runs
// dispatcher/chat.py's run_agent_vault_chat against THAT agent's own
// instructions/tools/model — not agent_work's generic brief, which is
// what this used to fall through to (see server.py's own docstring on
// that route for the full before/after). conversation_id is no longer
// client-minted/sessionStorage'd — the backend uses the agent's own id
// as its one stable conversation, so switching agents or reopening this
// panel later naturally picks the right thread back up.
//
// EditModeSelector (Review changes / Auto-accept) was dropped here, not
// carried over from AgentWorkChat's copy — auto_accept only ever
// configured agent_work's own "review the created workflow before it
// runs" behavior, which has no equivalent for a plain saved-agent chat;
// keeping a control that no longer does anything would be worse than
// not having it. ModelBadge stays: agent.model is null for every agent
// today (no UI sets it — see AgentVault.tsx), so run_agent_vault_chat
// always falls back to the shared agent_work role's own current model,
// meaning ModelBadge's "model used for this chat" label is still
// accurate, if shared/global rather than truly per-agent.

const accent = neutral.textMuted;
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
          background: surface.raised, border: "1px solid rgba(255,255,255,0.12)", borderRadius: radius.sm,
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

interface AgentVaultMessage {
  role: "user" | "navi";
  text: string;
  at: number; // epoch ms — captured client-side when the message is added, not persisted
  usageNote?: string; // navi replies only, when the provider reported one (tokens or Cloudflare Neurons)
  choices?: string[]; // navi replies only, from ask_user_choice — doesn't survive a page refresh, same as usageNote
}

function formatMessageTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function AgentVaultChat({ onClose, agentId, agentName }: { onClose: () => void; agentId: string | null; agentName?: string }) {
  const [messages, setMessages] = useState<AgentVaultMessage[]>([]);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const sendingRef = useRef(false);

  // Hydrate from the server whenever the selected agent changes — the
  // agent's own id IS its conversation id (server.py's POST
  // /agents/{id}/chat), so no client-minted/sessionStorage'd id is
  // needed here at all. Clears the displayed messages first so switching
  // from one agent's chat to another's doesn't briefly show the wrong
  // agent's history while the new fetch is in flight.
  useEffect(() => {
    setMessages([]);
    if (!agentId) return;
    fetch(`${NAVI_BACKEND_URL}/devslate/conversations/${encodeURIComponent(agentId)}/messages`)
      .then(res => res.json())
      .then((data: { messages?: { role: string; content: string; created_at?: number }[] }) => {
        const restored = (data.messages ?? [])
          .filter(m => m.role === "user" || m.role === "navi")
          .map(m => ({
            role: m.role === "user" ? "user" as const : "navi" as const,
            text: m.content, at: (m.created_at ?? Date.now() / 1000) * 1000,
          }));
        if (restored.length) setMessages(restored);
      })
      .catch(() => {});
  }, [agentId]);

  // Resizable, not native CSS `resize` — see AgentWorkChat.tsx's own
  // comment on why (the native handle sits exactly where this panel is
  // pinned to the screen edge). This panel is pinned bottom-LEFT (it
  // opens from the left rail, not a canvas' own bottom-right corner —
  // see App.tsx's mount point), so its bottom-left corner is the fixed
  // anchor; every other edge/corner gets a resize handle.
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
        // Mirrored from AgentWorkChat's own (that panel is right-
        // anchored, dragging its left edge left GROWS width; this panel
        // is left-anchored, so dragging its right edge right grows
        // width instead — same math, opposite sign).
        width: axes === "height" ? prev.width : Math.min(maxWidth, Math.max(300, startWidth + (moveEvent.clientX - startX))),
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

  const revealText = useCallback(async (fullText: string, usageNote?: string, choices?: string[]) => {
    setPending(null);
    setStreamingText("");
    for (let i = 1; i <= fullText.length; i++) {
      setStreamingText(fullText.slice(0, i));
      await sleep(fullText[i - 1] === "." ? STREAM_CHAR_DELAY_MS + STREAM_PERIOD_PAUSE_MS : STREAM_CHAR_DELAY_MS);
    }
    setMessages(m => [...m, { role: "navi", text: fullText, at: Date.now(), usageNote, choices }]);
    setStreamingText(null);
  }, []);

  // overrideText: set when a ChoiceButtons click sends its label directly,
  // bypassing whatever's currently (or not) typed in the input box.
  const send = useCallback(async (overrideText?: string) => {
    const text = overrideText ?? input.trim();
    if (!text || sendingRef.current || !agentId) return;
    sendingRef.current = true;
    setInput("");
    setMessages(m => [...m, { role: "user", text, at: Date.now() }]);
    setPending("Thinking…");

    // Real per-agent endpoint (server.py's POST /agents/{id}/chat) — no
    // mode/auto_accept/conversation_id in the body; the URL already
    // identifies which agent, and the backend derives the conversation
    // id from that same agent id.
    const post = () => fetch(`${NAVI_BACKEND_URL}/agents/${encodeURIComponent(agentId)}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).then(res => res.json());

    try {
      let data: { text?: string; error?: string; conversation_id?: string; usage_note?: string; choices?: string[] };
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
      await revealText(data.text ?? data.error ?? "(empty reply)", data.usage_note, data.choices);
    } catch {
      setMessages(m => [...m, { role: "navi", text: "That message failed to send — try again.", at: Date.now() }]);
    } finally {
      setPending(null);
      sendingRef.current = false;
    }
  }, [input, agentId, revealText]);

  const reversedMessages = [...messages].reverse();

  return (
    <div style={{
      position: "relative",
      width: size.width, height: size.height,
      display: "flex", flexDirection: "column",
      background: neutral.surfaceSolid, border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: radius.lg, boxShadow: `0 8px 30px rgba(0,0,0,0.5), 0 0 20px ${neutral.userBubbleGlow}`,
      overflow: "hidden", fontFamily,
    }}>
      {/* Top-right corner — resizes both axes. Mirrored from
          AgentWorkChat's top-left: this panel is left-anchored (opens
          from the rail), so the far corner from the anchor is top-right
          here instead of top-left. */}
      <div
        onPointerDown={handleResizeStart("both")}
        title="Drag to resize"
        aria-hidden="true"
        style={{
          position: "absolute", top: 0, right: 0, width: 16, height: 16, zIndex: 3,
          cursor: "nesw-resize",
        }}
      >
        <div style={{
          position: "absolute", top: 4, right: 4, width: 8, height: 8,
          borderTop: "2px solid rgba(255,255,255,0.25)", borderRight: "2px solid rgba(255,255,255,0.25)",
          borderTopRightRadius: 3,
        }} />
      </div>
      {/* Top edge — height only. */}
      <div
        onPointerDown={handleResizeStart("height")}
        title="Drag to resize"
        aria-hidden="true"
        style={{ position: "absolute", top: 0, left: 0, right: 16, height: 6, zIndex: 3, cursor: "ns-resize" }}
      />
      {/* Right edge — width only. */}
      <div
        onPointerDown={handleResizeStart("width")}
        title="Drag to resize"
        aria-hidden="true"
        style={{ position: "absolute", top: 16, right: 0, bottom: 0, width: 6, zIndex: 3, cursor: "ew-resize" }}
      />
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: `${spacing.sm}px ${spacing.md}px`, borderBottom: "1px solid rgba(255,255,255,0.08)",
        position: "relative", zIndex: 2,
        background: tintedSurface(0, 14, 0),
      }}>
        <span style={{ fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: neutral.textPrimary }}>
          {agentName ?? "Agent Vault chat"}
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
              {agentId
                ? "Chat with this saved agent — it uses whatever instructions and tools it was given in Agent Vault."
                : "Pick an agent from Agent Vault (the chat icon on its card) to start a conversation."}
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
              alignSelf: "flex-start", minWidth: 0, display: "flex", gap: spacing.xs,
              fontSize: fontSize.sm, color: neutral.textPrimary, whiteSpace: "pre-wrap", overflowWrap: "anywhere",
            }}>
              {streamingText}
              <span className="step-pulse" style={{ opacity: 0.7 }}>▍</span>
            </div>
          )}
          {reversedMessages.map((m, i) => (
            <div key={reversedMessages.length - i} style={{
              display: "flex", flexDirection: "column", gap: 3, minWidth: 0,
              alignSelf: m.role === "user" ? "flex-end" : "stretch",
              maxWidth: m.role === "user" ? "90%" : "100%",
            }}>
              {/* Author line — NAVI replies are content-first, no bubble. */}
              <div style={{
                fontSize: fontSize.xxs, color: neutral.textFaint, fontFamily,
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              }}>
                <span style={{ fontWeight: fontWeight.medium, color: neutral.textMuted }}>
                  {m.role === "user" ? "You" : "NAVI"}
                </span>
                {" · "}{formatMessageTime(m.at)}{m.usageNote ? ` · ${m.usageNote}` : ""}
              </div>
              <div style={m.role === "user" ? {
                alignSelf: "flex-end", maxWidth: "100%",
                background: neutral.userBubbleBg,
                border: `1px solid ${neutral.userBubbleBorder}`,
                borderRadius: radius.lg, padding: `${spacing.sm}px ${spacing.md}px`,
                fontSize: fontSize.sm, color: neutral.textPrimary,
                whiteSpace: "pre-wrap", overflowWrap: "anywhere",
              } : {
                fontSize: fontSize.sm, color: neutral.textPrimary,
                whiteSpace: "pre-wrap", overflowWrap: "anywhere", minWidth: 0,
              }}>
                {m.text}
              </div>
              {i === 0 && m.choices && m.choices.length > 0 && (
                <ChoiceButtons
                  options={m.choices} hue={0} chroma={0}
                  disabled={pending !== null || streamingText !== null}
                  onPick={(text) => { void send(text); }}
                />
              )}
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
            background: neutral.surface, border: "1px solid var(--border-default)",
          }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              disabled={!agentId}
              placeholder={agentId ? "Message this agent…" : "Pick an agent to start chatting"}
              style={{
                flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none",
                color: neutral.textPrimary, fontSize: fontSize.sm, fontFamily,
                padding: `${spacing.xs}px ${spacing.xs}px`,
              }}
            />
            <button onClick={() => void send()} disabled={!input.trim() || !!pending || !agentId} aria-label="Send" title="Send" style={{
              flexShrink: 0, width: 30, height: 30,
              display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: radius.md, border: `1px solid ${tintedGlow(0, 0.4, 0)}`,
              background: tintedGlow(0, 0.15, 0), color: accent,
              cursor: input.trim() && !pending && agentId ? "pointer" : "default", opacity: input.trim() && !pending && agentId ? 1 : 0.5,
            }}>
              <PaperAirplaneIcon size={14} />
            </button>
          </div>

          {/* Model picker only now — EditModeSelector (Review changes /
              Auto-accept) was dropped along with the agent_work
              placeholder call it configured (see this file's own header
              comment). */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: spacing.xs, marginTop: spacing.xs, flexWrap: "wrap", minWidth: 0 }}>
            <ModelBadge />
          </div>
        </div>
      </div>
    </div>
  );
}
