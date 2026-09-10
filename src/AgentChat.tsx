import { useEffect, useRef, useState } from "react";
import { XIcon, AlertIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT, tintedGlow } from "./tokens";

export interface PendingDecision {
  id: string;
  // Where this question came from — an Agent Work run's name today
  // ("Invoice Follow-up Agent"), but deliberately NOT agent-specific:
  // any chat surface (Normal, Research, Brainstorm) can raise one of
  // these too (e.g. "this conversation wants a more capable model —
  // switch?"), with its own mode name here instead. Renamed from
  // agentName (2026-09-10) specifically so this reads as a general
  // "the dispatcher needs you to decide" primitive, not an Agent-Work-
  // branded feature — see this file's own header comment.
  sourceLabel: string;
  question: string;
  options: string[];
}

// A dispatcher-needs-you-to-decide-right-now prompt (2026-09-03,
// redesigned 2026-09-10). Deliberately NOT tied to Agent Work — despite
// the component's filename (kept for now; only the exported names and
// on-screen copy changed), this is a general primitive any chat surface
// can raise a question through. Crucial property, worth stating
// explicitly since it's easy to assume otherwise from the name: this
// NEVER navigates anywhere. It's a plain overlay rendered as a sibling
// in the same tree App.tsx already has mounted — answering or
// dismissing just resolves a callback in that same app state. Whatever
// conversation was on screen when this appeared is still exactly what's
// on screen once it's answered. It does not open Agent Vault, does not
// switch canvases, does not start a new chat.
//
// Same "don't bury the thing that needs you inside ambient conversation"
// reasoning as GitHub's review queue or Slack's Threads view, now with
// real weight behind it (JuanJo, 2026-09-10: "it's just buttons below
// what's written, nothing that makes you notice it... we need it to be
// a 'hey! you need to choose now!' UI") — see App.tsx's floating trigger
// for the other half of that redesign.
//
// One decision at a time, not a scrolled list of every pending item — a
// list reads as browsable reference material; a single question with a
// "1 of 3" counter reads as something to resolve before doing anything
// else.
//
// Real interaction lock (2026-09-10, JuanJo: "no input from the user
// besides the buttons can be done") — focus moves into the panel on
// mount and Tab/Shift+Tab cycle only among its own buttons, so a
// keyboard user can't tab back out into the chat input behind it
// (mouse interaction was already blocked: the full-screen backdrop
// physically sits on top of everything at z-index 400). Not a generic
// `inert`-the-rest-of-the-app approach — this component renders deep
// inside App.tsx's own tree rather than as a portal sibling to the
// whole app, so trapping focus locally is the correct-scoped fix here
// without restructuring how App.tsx mounts things.
export function PendingDecisionPrompt({ pending, onAnswer, onDismiss }: {
  pending: PendingDecision[];
  onAnswer: (id: string, answer: string) => void;
  // Explicit "no, keep going as normal" — distinct from just closing
  // this panel (which the old design conflated: closing left the item
  // silently still pending, reappearing later with no record of what
  // the user actually decided). This one resolves the item for real,
  // the same way picking a real option does — it just answers "keep
  // things as they are" instead of switching anything.
  onDismiss: (id: string) => void;
}) {
  const accent = CANVAS_ACCENT.agentWork.color;
  const [pickedId, setPickedId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const current = pending[0];

  useEffect(() => {
    if (!current) return;
    // Move focus off whatever had it (the chat textarea, the trigger
    // button that opened this, most likely) and onto the panel itself
    // the moment a decision appears. Deferred a tick (real bug caught
    // live, 2026-09-10): calling focus() synchronously here lost a race
    // against the browser's own native focus-follows-click behavior on
    // whatever button was just clicked to open this — that native
    // focus happens as part of the same click, and can still land
    // AFTER this effect's synchronous call. A macrotask defer runs
    // after that settles, so this call wins for real instead of being
    // silently overwritten a moment later.
    const id = setTimeout(() => panelRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [current?.id]);

  if (!current) return null; // App.tsx only mounts this while pending.length > 0; guards a mid-answer race

  const pick = (answer: string) => {
    setPickedId(current.id);
    onAnswer(current.id, answer);
  };

  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusable = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>("button:not(:disabled)"),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (!panelRef.current.contains(active)) {
      // Focus somehow escaped the panel (e.g. a prior render's stale
      // ref) — pull it back rather than letting Tab continue outward.
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.65)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: spacing.lg, paddingTop: 80,
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={trapTab}
        className="agent-chat-alert-pulse"
        style={{
          width: "min(420px, 100%)", display: "flex", flexDirection: "column",
          background: neutral.surfaceSolid, borderRadius: radius.md, border: `1.5px solid ${accent}77`,
          boxShadow: `0 24px 80px rgba(0,0,0,0.6)`, fontFamily, outline: "none",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: `${spacing.md}px ${spacing.md}px ${spacing.sm}px`, flexShrink: 0,
        }}>
          <span style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
            <span style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
              background: tintedGlow(CANVAS_ACCENT.agentWork.hue, 0.22), color: accent,
            }}>
              <AlertIcon size={15} />
            </span>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: neutral.textPrimary }}>
                Waiting on you
              </span>
              <span style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>{current.sourceLabel}</span>
            </span>
          </span>
          {pending.length > 1 && (
            <span style={{
              fontSize: fontSize.xxs, fontWeight: fontWeight.medium, color: neutral.textMuted,
              padding: `2px ${spacing.xs}px`, borderRadius: radius.sm, background: "rgba(255,255,255,0.06)",
            }}>
              1 of {pending.length}
            </span>
          )}
        </div>

        <div style={{
          padding: `0 ${spacing.md}px ${spacing.md}px`, display: "flex", flexDirection: "column", gap: spacing.md,
        }}>
          <div style={{ fontSize: fontSize.sm, color: neutral.textPrimary, lineHeight: 1.55 }}>
            {current.question}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
            {current.options.map((option, i) => {
              const disabled = pickedId === current.id;
              return (
                <button
                  key={i}
                  onClick={() => pick(option)}
                  disabled={disabled}
                  style={{
                    padding: `${spacing.sm}px ${spacing.md}px`, borderRadius: radius.sm,
                    border: `1px solid ${accent}55`, background: tintedGlow(CANVAS_ACCENT.agentWork.hue, 0.1),
                    color: neutral.textPrimary, cursor: disabled ? "default" : "pointer",
                    opacity: disabled ? 0.5 : 1, textAlign: "left",
                    fontSize: fontSize.sm, fontWeight: fontWeight.medium, fontFamily,
                    transition: "background 0.15s ease, border-color 0.15s ease",
                  }}
                  onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = tintedGlow(CANVAS_ACCENT.agentWork.hue, 0.2); e.currentTarget.style.borderColor = `${accent}aa`; } }}
                  onMouseLeave={e => { e.currentTarget.style.background = tintedGlow(CANVAS_ACCENT.agentWork.hue, 0.1); e.currentTarget.style.borderColor = `${accent}55`; }}
                >
                  {option}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => { setPickedId(current.id); onDismiss(current.id); }}
            disabled={pickedId === current.id}
            style={{
              alignSelf: "center", padding: `${spacing.xxs}px ${spacing.sm}px`,
              background: "none", border: "none", color: neutral.textMuted,
              cursor: pickedId === current.id ? "default" : "pointer",
              opacity: pickedId === current.id ? 0.5 : 1,
              fontSize: fontSize.xxs, fontFamily, textDecoration: "underline", textUnderlineOffset: 2,
            }}
          >
            Not now — keep chatting normally
          </button>
        </div>
      </div>
    </div>
  );
}
