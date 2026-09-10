import { useState } from "react";
import { XIcon, AlertIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT, tintedGlow } from "./tokens";

export interface PendingAgentInput {
  id: string;
  agentName: string;
  question: string;
  options: string[];
}

// The needs-your-input surface (2026-09-03 design, redesigned 2026-09-10
// per JuanJo: "it's just buttons below what's written, nothing that
// makes you notice it... we need it to be a 'hey! you need to choose
// now!' UI"). Separate from every other chat in NAVI on purpose, same
// "don't bury the thing that needs you inside ambient conversation"
// reasoning as GitHub's review queue or Slack's Threads view — now with
// real weight behind that reasoning instead of just a modal shape.
//
// Two real changes from the original design:
// 1. One decision at a time, not a scrolled list of every pending item.
//    A list reads as browsable reference material; a single question
//    with a "1 of 3" counter reads as something to resolve before doing
//    anything else — the same shift a checkout flow makes from "here's
//    everything" to "here's the next step."
// 2. A real pulse (agent-chat-alert-pulse, index.css) on the header
//    icon and the panel's own border — Agent Work's existing accent
//    hue turned up into an actual "something needs you" signal, not a
//    static amber tint. The floating trigger that opens this (App.tsx,
//    near the other fixed-position chrome) carries the same pulse, so
//    the signal starts before the user even opens this panel.
//
// Only ever mounted while at least one item is pending (App.tsx's
// trigger gates this the same way), so there's no empty state to design
// for here — this component's whole job is one real decision at a time.
export function AgentChat({ pending, onAnswer, onClose }: {
  pending: PendingAgentInput[]; onAnswer: (id: string, answer: string) => void; onClose: () => void;
}) {
  const accent = CANVAS_ACCENT.agentWork.color;
  const [pickedId, setPickedId] = useState<string | null>(null);
  const current = pending[0];
  if (!current) return null; // App.tsx only mounts this while pending.length > 0; guards a mid-answer race

  const pick = (answer: string) => {
    setPickedId(current.id);
    onAnswer(current.id, answer);
    // Not reset in a .then — this component unmounts once pending drops
    // to 0, and otherwise the NEXT item's own id naturally makes this
    // stale disabled-state harmless (it never matches a different id).
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.65)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: spacing.lg, paddingTop: 80,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="agent-chat-alert-pulse"
        style={{
          width: "min(420px, 100%)", display: "flex", flexDirection: "column",
          background: neutral.surfaceSolid, borderRadius: radius.md, border: `1.5px solid ${accent}77`,
          boxShadow: `0 24px 80px rgba(0,0,0,0.6)`, fontFamily,
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
              <span style={{ fontSize: fontSize.xxs, color: neutral.textMuted }}>{current.agentName}</span>
            </span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
            {pending.length > 1 && (
              <span style={{
                fontSize: fontSize.xxs, fontWeight: fontWeight.medium, color: neutral.textMuted,
                padding: `2px ${spacing.xs}px`, borderRadius: radius.sm, background: "rgba(255,255,255,0.06)",
              }}>
                1 of {pending.length}
              </span>
            )}
            <button onClick={onClose} aria-label="Close" title="Decide later" style={{ display: "flex", background: "none", border: "none", color: neutral.textMuted, cursor: "pointer" }}>
              <XIcon size={16} />
            </button>
          </span>
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
        </div>
      </div>
    </div>
  );
}
