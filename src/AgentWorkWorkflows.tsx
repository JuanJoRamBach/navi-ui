import { useCallback, useEffect, useState } from "react";
import { PlayIcon, PlusIcon, CalendarIcon, CommentDiscussionIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT, tintedGlow } from "./tokens";
import { sidebarRow } from "./sidebar-tokens";
import { WORKFLOW_CREATED_EVENT, listRuns, listWorkflows, runWorkflowNow, type AgentRun, type WorkflowDefinition } from "./agentWork";

const accent = CANVAS_ACCENT.agentWork.color;

const STATUS_COLOR: Record<string, string> = {
  completed: "#3ecf8e", running: "#e0b94a", queued: "#e0b94a", failed: "#e05a4a",
};

function formatWhen(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Every saved workflow_definition — name, trigger, most recent run
// (client-side joined against a plain listRuns() call rather than a new
// backend field, since run volume is small right now), manual "Run Now".
// Right sidebar's primary pane for Agent Work (JuanJo, 2026-09-01: this
// replaces the earlier "Schedule" calendar placeholder here — the
// calendar itself moved to its own floating overlay instead, see
// AgentWorkCalendar.tsx).
//
// onNewWorkflow (2026-09-01): "that button should be inside where
// workflows live" — the sidebar's own header is the primary entry point
// now; App.tsx still keeps a fallback CTA in the empty-canvas state too,
// since the right sidebar defaults closed and auto-closes on a canvas
// switch, so this alone wouldn't always be reachable.
export function AgentWorkWorkflows({ onNewWorkflow }: { onNewWorkflow: (e: React.MouseEvent<HTMLButtonElement>) => void }) {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[] | null>(null);
  const [lastRunByWorkflow, setLastRunByWorkflow] = useState<Record<string, AgentRun>>({});
  const [runningId, setRunningId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listWorkflows().then(setWorkflows).catch(() => setWorkflows([]));
    listRuns().then(runs => {
      const latest: Record<string, AgentRun> = {};
      for (const run of runs) {
        if (!run.workflow_id) continue;
        const existing = latest[run.workflow_id];
        if (!existing || run.started_at > existing.started_at) latest[run.workflow_id] = run;
      }
      setLastRunByWorkflow(latest);
    }).catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    window.addEventListener(WORKFLOW_CREATED_EVENT, refresh);
    return () => window.removeEventListener(WORKFLOW_CREATED_EVENT, refresh);
  }, [refresh]);

  const runNow = async (workflowId: string) => {
    setRunningId(workflowId);
    try {
      await runWorkflowNow(workflowId);
      refresh();
    } finally {
      setRunningId(null);
    }
  };

  const header = (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: `${spacing.xs}px ${spacing.sm}px`, borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
    }}>
      <span style={{ fontSize: fontSize.xxs, fontWeight: fontWeight.medium, color: neutral.textMuted, letterSpacing: "0.04em" }}>
        WORKFLOWS
      </span>
      <button
        onClick={onNewWorkflow}
        title="New Workflow"
        style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: `2px ${spacing.xs}px`, borderRadius: radius.xs,
          border: `1px solid ${accent}55`, background: tintedGlow(CANVAS_ACCENT.agentWork.hue, 0.1),
          color: accent, cursor: "pointer", fontSize: fontSize.xxs, fontFamily,
        }}
      >
        <PlusIcon size={10} /> New
      </button>
    </div>
  );

  if (workflows === null) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily }}>
        {header}
        <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", color: neutral.textFaint, fontSize: fontSize.xs }}>
          Loading…
        </div>
      </div>
    );
  }

  if (workflows.length === 0) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily }}>
        {header}
        <div style={{
          flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: spacing.lg, textAlign: "center", color: neutral.textFaint, gap: spacing.xs,
        }}>
          <CommentDiscussionIcon size={22} fill={accent} />
          <div style={{ fontSize: fontSize.xs, color: neutral.textMuted, fontWeight: fontWeight.medium }}>No workflows yet</div>
          <div style={{ fontSize: fontSize.xxs }}>Describe one in the chat, or create one with the button above.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily }}>
      {header}
      <div className="hide-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: spacing.xs }}>
      {workflows.map(wf => {
        const lastRun = lastRunByWorkflow[wf.id];
        const scheduled = wf.trigger.type === "scheduled";
        return (
          <div key={wf.id} style={{
            padding: `${sidebarRow.paddingV}px ${sidebarRow.paddingH}px`, borderRadius: sidebarRow.radius,
            display: "flex", flexDirection: "column", gap: 4, marginBottom: 2,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.xs, minWidth: 0 }}>
              <span style={{ fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: neutral.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                {wf.name}
              </span>
              <button
                onClick={() => runNow(wf.id)}
                disabled={runningId === wf.id}
                title="Run now"
                style={{
                  flexShrink: 0, display: "flex", alignItems: "center", gap: 4,
                  padding: `2px ${spacing.xs}px`, borderRadius: radius.xs,
                  border: `1px solid ${accent}55`, background: "transparent",
                  color: accent, cursor: runningId === wf.id ? "default" : "pointer",
                  fontSize: fontSize.xxs, fontFamily, opacity: runningId === wf.id ? 0.5 : 1,
                }}
              >
                <PlayIcon size={10} /> {runningId === wf.id ? "Starting…" : "Run"}
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: spacing.xs, fontSize: fontSize.xxs, color: neutral.textFaint }}>
              <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
                {scheduled && <CalendarIcon size={10} />}
                {scheduled ? "Scheduled" : "Manual"}
              </span>
              {lastRun && (
                <>
                  <span>·</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 5, height: 5, borderRadius: 9999, background: STATUS_COLOR[lastRun.status] ?? neutral.textFaint }} />
                    {lastRun.status} {formatWhen(lastRun.started_at)}
                  </span>
                </>
              )}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
