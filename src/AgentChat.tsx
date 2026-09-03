import { XIcon, CommentDiscussionIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT } from "./tokens";
import { ChoiceButtons } from "./ChoiceButtons";

export interface PendingAgentInput {
  id: string;
  agentName: string;
  question: string;
  options: string[];
}

// The needs-your-input surface (2026-09-03 design) — separate from
// every other chat in NAVI on purpose, same "don't bury the thing that
// needs you inside ambient conversation" reasoning as GitHub's review
// queue or Slack's Threads view. Only ever mounted while at least one
// item is pending (App.tsx's rail button gates this the same way), so
// there's no empty state to design for here — this component's whole
// job is a focused list of real decisions, nothing else.
export function AgentChat({ pending, onAnswer, onClose }: {
  pending: PendingAgentInput[]; onAnswer: (id: string, answer: string) => void; onClose: () => void;
}) {
  const accent = CANVAS_ACCENT.agentWork.color;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "flex-start", justifyContent: "flex-start",
        padding: spacing.lg, paddingTop: 80,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(360px, 100%)", maxHeight: "70vh", display: "flex", flexDirection: "column",
          background: neutral.surfaceSolid, borderRadius: radius.md, border: `1px solid ${accent}33`,
          boxShadow: `0 24px 80px rgba(0,0,0,0.6), 0 0 30px ${CANVAS_ACCENT.agentWork.glow}`, fontFamily,
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: spacing.md, borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0,
        }}>
          <span style={{ display: "flex", alignItems: "center", gap: spacing.xs, fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: neutral.textPrimary }}>
            <CommentDiscussionIcon size={14} fill={accent} /> Agent Chat
          </span>
          <button onClick={onClose} aria-label="Close" style={{ display: "flex", background: "none", border: "none", color: neutral.textMuted, cursor: "pointer" }}>
            <XIcon size={16} />
          </button>
        </div>
        <div className="hide-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: spacing.md, display: "flex", flexDirection: "column", gap: spacing.md }}>
          {pending.map(item => (
            <div key={item.id} style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
              <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, fontWeight: fontWeight.medium }}>{item.agentName}</div>
              <div style={{ fontSize: fontSize.xs, color: neutral.textPrimary, lineHeight: 1.5 }}>{item.question}</div>
              <ChoiceButtons options={item.options} hue={CANVAS_ACCENT.agentWork.hue} onPick={answer => onAnswer(item.id, answer)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
