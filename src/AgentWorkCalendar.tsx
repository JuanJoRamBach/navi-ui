import { useEffect, useMemo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT, tintedGlow } from "./tokens";
import { listWorkflows, type WorkflowDefinition } from "./agentWork";

const accent = CANVAS_ACCENT.agentWork.color;
const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// "What's going to fire when" across every scheduled workflow — a real
// month-grid calendar (JuanJo, 2026-09-01: "it fits the Calendar design
// really well"), not just a list. Relocated 2026-09-06 (JuanJo: "we can
// move the calendar to agent vault, at the bottom of it, reusing the
// 2-tools-per-tab pattern") from its own floating popover (which the
// Agent Work canvas's round button now opens a real per-workflow
// SCHEDULE EDITOR instead — a different, no-longer-read-only surface,
// not this global browsing view) into a plain embedded content block —
// no popover chrome (border/shadow/close button/fixed width) of its own
// anymore, since the embedding parent (AgentVault) now owns that.
export function AgentWorkCalendar() {
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
    // No scroll wrapper of its own — StackedPanels.tsx's own section body
    // already owns scroll+resize+collapse for whatever's embedded in it
    // (2026-09-06, JuanJo: "the fix is not a scrollbar, it must fit well
    // without a scrollbar" — the real fix was making the SECTION resizable,
    // not scrolling its contents), so this component just renders its
    // natural height and lets the parent panel grow/shrink to fit.
    <div style={{ display: "flex", flexDirection: "column", fontFamily }}>
      <div style={{ padding: `${spacing.xs}px ${spacing.sm}px 0`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.xs }}>
          <button
            aria-label="Previous month"
            onClick={() => setViewDate(new Date(year, month - 1, 1))}
            style={{ background: "none", border: "none", color: neutral.textMuted, cursor: "pointer", display: "flex" }}
          >
            <ChevronLeftIcon size={14} />
          </button>
          <span style={{ fontSize: fontSize.xxs, fontWeight: fontWeight.medium, color: neutral.textPrimary }}>
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

      <div style={{ flexShrink: 0 }}>
        {selectedKey && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", padding: spacing.sm }}>
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
    </div>
  );
}
