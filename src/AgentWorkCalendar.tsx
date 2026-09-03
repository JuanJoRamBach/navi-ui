import { useEffect, useMemo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT, tintedGlow } from "./tokens";
import { listWorkflows, type WorkflowDefinition } from "./agentWork";

const accent = CANVAS_ACCENT.agentWork.color;
const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// "What's going to fire when" across every scheduled workflow — a real
// month-grid calendar (JuanJo, 2026-09-01: "it fits the Calendar design
// really well"), not just a list. Lives in its own floating overlay,
// triggered by a second button stacked above the chat button — not a
// right-sidebar pane, since a calendar genuinely wants more width than
// a sidebar column gives, and a popover keeps the user in their
// workflow without navigating away (real UX guidance, not guessed —
// see how_to_handle_context.md-adjacent session notes).
export function AgentWorkCalendar({ onClose }: { onClose: () => void }) {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => { listWorkflows().then(setWorkflows).catch(() => setWorkflows([])); }, []);

  const scheduledByDay = useMemo(() => {
    const map: Record<string, WorkflowDefinition[]> = {};
    for (const wf of workflows) {
      if (wf.trigger.type !== "scheduled" || !wf.trigger.next_run_at) continue;
      const key = dayKey(new Date(wf.trigger.next_run_at * 1000));
      (map[key] ??= []).push(wf);
    }
    return map;
  }, [workflows]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = dayKey(new Date());

  const cells: (Date | null)[] = [
    ...Array(startWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];

  const selectedWorkflows = selectedKey ? scheduledByDay[selectedKey] ?? [] : [];

  return (
    <div style={{
      width: 320, display: "flex", flexDirection: "column",
      background: neutral.surfaceSolid, border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: radius.lg, boxShadow: `0 8px 30px rgba(0,0,0,0.5), 0 0 20px ${CANVAS_ACCENT.agentWork.glow}`,
      overflow: "hidden", fontFamily,
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: `${spacing.sm}px ${spacing.md}px`, borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}>
        <span style={{ fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: neutral.textPrimary }}>Schedule</span>
        <button
          aria-label="Close calendar"
          onClick={onClose}
          style={{
            width: 22, height: 22, borderRadius: radius.xs, border: "none", background: "transparent",
            color: neutral.textMuted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <XIcon size={14} />
        </button>
      </div>

      <div style={{ padding: spacing.sm }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.xs }}>
          <button
            aria-label="Previous month"
            onClick={() => setViewDate(new Date(year, month - 1, 1))}
            style={{ background: "none", border: "none", color: neutral.textMuted, cursor: "pointer", display: "flex" }}
          >
            <ChevronLeftIcon size={14} />
          </button>
          <span style={{ fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: neutral.textPrimary }}>
            {viewDate.toLocaleDateString([], { month: "long", year: "numeric" })}
          </span>
          <button
            aria-label="Next month"
            onClick={() => setViewDate(new Date(year, month + 1, 1))}
            style={{ background: "none", border: "none", color: neutral.textMuted, cursor: "pointer", display: "flex" }}
          >
            <ChevronRightIcon size={14} />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
          {DAY_LABELS.map((d, i) => (
            <div key={i} style={{ textAlign: "center", fontSize: fontSize.xxs, color: neutral.textFaint, padding: 2 }}>{d}</div>
          ))}
          {cells.map((date, i) => {
            if (!date) return <div key={i} />;
            const key = dayKey(date);
            const hasEvents = !!scheduledByDay[key]?.length;
            const isToday = key === todayKey;
            const isSelected = key === selectedKey;
            return (
              <button
                key={i}
                onClick={() => setSelectedKey(hasEvents ? (isSelected ? null : key) : null)}
                disabled={!hasEvents}
                style={{
                  aspectRatio: "1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  borderRadius: radius.xs, border: isToday ? `1px solid ${accent}` : "1px solid transparent",
                  background: isSelected ? tintedGlow(CANVAS_ACCENT.agentWork.hue, 0.18) : "transparent",
                  color: hasEvents ? neutral.textPrimary : neutral.textFaint,
                  cursor: hasEvents ? "pointer" : "default", fontSize: fontSize.xxs, fontFamily, padding: 0,
                }}
              >
                {date.getDate()}
                {hasEvents && <span style={{ width: 4, height: 4, borderRadius: 9999, background: accent, marginTop: 1 }} />}
              </button>
            );
          })}
        </div>
      </div>

      {selectedKey && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", padding: spacing.sm, maxHeight: 160, overflowY: "auto" }}>
          {selectedWorkflows.map(wf => (
            <div key={wf.id} style={{ display: "flex", alignItems: "center", gap: spacing.xs, padding: `${spacing.xxs}px 0`, fontSize: fontSize.xxs }}>
              <span style={{ width: 5, height: 5, borderRadius: 9999, background: accent, flexShrink: 0 }} />
              <span style={{ color: neutral.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{wf.name}</span>
              <span style={{ color: neutral.textFaint, flexShrink: 0, marginLeft: "auto" }}>
                {wf.trigger.type === "scheduled" && wf.trigger.next_run_at
                  ? new Date(wf.trigger.next_run_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {workflows.every(wf => wf.trigger.type !== "scheduled") && (
        <div style={{ padding: spacing.md, textAlign: "center", fontSize: fontSize.xxs, color: neutral.textFaint }}>
          No scheduled workflows yet — everything's manual-trigger right now.
        </div>
      )}
    </div>
  );
}
