import { useCallback, useEffect, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, HistoryIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT } from "./tokens";
import { getRunSteps, listRuns, WORKFLOW_CREATED_EVENT, type AgentRun, type AgentRunStep } from "./agentWork";

const accent = CANVAS_ACCENT.agentWork.color;

const STATUS_COLOR: Record<string, string> = {
  completed: "#3ecf8e", running: "#e0b94a", queued: "#e0b94a", failed: "#e05a4a",
};

function formatWhen(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StepRow({ step }: { step: AgentRunStep }) {
  return (
    <div style={{ padding: `${spacing.xxs}px ${spacing.sm}px ${spacing.xxs}px ${spacing.xl}px`, borderLeft: `2px solid ${STATUS_COLOR[step.status] ?? neutral.textFaint}22` }}>
      <div style={{ display: "flex", alignItems: "center", gap: spacing.xs, fontSize: fontSize.xxs }}>
        <span style={{ width: 5, height: 5, borderRadius: 9999, background: STATUS_COLOR[step.status] ?? neutral.textFaint, flexShrink: 0 }} />
        <span style={{ color: neutral.textMuted, fontFamily: "monospace" }}>{step.node_id}</span>
      </div>
      {step.output && (
        <div style={{ fontSize: fontSize.xxs, color: neutral.textFaint, marginTop: 2, whiteSpace: "pre-wrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {step.output.length > 200 ? `${step.output.slice(0, 200)}…` : step.output}
        </div>
      )}
      {step.error && (
        <div style={{ fontSize: fontSize.xxs, color: "#e05a4a", marginTop: 2 }}>{step.error}</div>
      )}
    </div>
  );
}

function RunRow({ run }: { run: AgentRun }) {
  const [expanded, setExpanded] = useState(false);
  const [steps, setSteps] = useState<AgentRunStep[] | null>(null);

  const toggle = () => {
    setExpanded(e => !e);
    if (!expanded && steps === null) {
      getRunSteps(run.id).then(setSteps).catch(() => setSteps([]));
    }
  };

  return (
    <div style={{ marginBottom: 2 }}>
      <button
        onClick={toggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: spacing.xs, textAlign: "left",
          padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs, border: "none",
          background: "transparent", color: neutral.textPrimary, cursor: "pointer", fontFamily,
        }}
      >
        {expanded ? <ChevronDownIcon size={10} /> : <ChevronRightIcon size={10} />}
        <span style={{ width: 6, height: 6, borderRadius: 9999, background: STATUS_COLOR[run.status] ?? neutral.textFaint, flexShrink: 0 }} />
        <span style={{ fontSize: fontSize.xxs, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {run.status} · {run.trigger_source} · {formatWhen(run.started_at)}
        </span>
      </button>
      {expanded && (
        <div>
          {steps === null && <div style={{ padding: `${spacing.xxs}px ${spacing.xl}px`, fontSize: fontSize.xxs, color: neutral.textFaint }}>Loading…</div>}
          {steps?.length === 0 && <div style={{ padding: `${spacing.xxs}px ${spacing.xl}px`, fontSize: fontSize.xxs, color: neutral.textFaint }}>No steps yet.</div>}
          {steps?.map(s => <StepRow key={s.id} step={s} />)}
          {run.error && (
            <div style={{ padding: `${spacing.xxs}px ${spacing.sm}px ${spacing.xxs}px ${spacing.xl}px`, fontSize: fontSize.xxs, color: "#e05a4a" }}>
              {run.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Recent runs across every workflow in this project — right sidebar's
// secondary pane for Agent Work. Click a run to expand it in place and
// see its step log (JuanJo, 2026-09-01: inline expand, not a separate
// view — matches how sidebar lists already work here).
export function AgentWorkRunHistory() {
  const [runs, setRuns] = useState<AgentRun[] | null>(null);

  const refresh = useCallback(() => {
    listRuns().then(setRuns).catch(() => setRuns([]));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  // A run started via the manual form's "Run now" or the chat's
  // create_workflow+run_workflow tool calls doesn't otherwise show up
  // here until a manual refresh (2026-09-02 bug report) — same event
  // AgentWorkWorkflows.tsx already listens to.
  useEffect(() => {
    window.addEventListener(WORKFLOW_CREATED_EVENT, refresh);
    return () => window.removeEventListener(WORKFLOW_CREATED_EVENT, refresh);
  }, [refresh]);

  if (runs === null) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: neutral.textFaint, fontSize: fontSize.xs, fontFamily }}>
        Loading…
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div style={{
        height: "100%", display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", padding: spacing.lg, textAlign: "center", color: neutral.textFaint, gap: spacing.xs, fontFamily,
      }}>
        <HistoryIcon size={18} fill={accent} />
        <div style={{ fontSize: fontSize.xxs }}>No runs yet.</div>
      </div>
    );
  }

  return (
    <div className="hide-scrollbar" style={{ height: "100%", overflowY: "auto", padding: spacing.xs, fontFamily }}>
      {runs.map(run => <RunRow key={run.id} run={run} />)}
    </div>
  );
}
