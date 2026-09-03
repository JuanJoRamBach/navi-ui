import { useCallback, useEffect, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, HistoryIcon, TrashIcon, AlertIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT } from "./tokens";
import { deleteAllRuns, deleteRun, getRunSteps, listRuns, WORKFLOW_CREATED_EVENT, type AgentRun, type AgentRunStep } from "./agentWork";

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

function RunRow({ run, deleting, onDelete }: { run: AgentRun; deleting: boolean; onDelete: () => void }) {
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
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          onClick={toggle}
          style={{
            flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: spacing.xs, textAlign: "left",
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
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          disabled={deleting}
          title="Delete this run"
          style={{
            display: "flex", alignItems: "center", padding: `2px ${spacing.xxs}px`, borderRadius: radius.xs,
            border: "1px solid rgba(255,255,255,0.1)", background: "transparent",
            color: neutral.textFaint, cursor: deleting ? "default" : "pointer", opacity: deleting ? 0.5 : 1, flexShrink: 0,
          }}
        >
          <TrashIcon size={10} />
        </button>
      </div>
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

// Same "don't let one accidental click destroy something you can't get
// back" reasoning as AgentWorkWorkflows.tsx's own delete-workflow
// dialog — clearing every run is unrecoverable and has real blast
// radius (could be dozens of records), so it gets a real confirm
// overlay; a single run's delete (RunRow above) doesn't, same weight
// distinction that file already draws between "delete the workflow
// itself" and lighter per-item actions.
function ClearAllConfirmDialog({ count, clearing, error, onCancel, onConfirm }: {
  count: number; clearing: boolean; error: string | null;
  onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "center", fontFamily,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 300, background: "#161616", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: radius.sm, padding: spacing.md, display: "flex", flexDirection: "column", gap: spacing.sm,
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: spacing.xs, color: "#e05a4a" }}>
          <AlertIcon size={16} />
          <span style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium }}>Clear all run history?</span>
        </div>
        <div style={{ fontSize: fontSize.xs, color: neutral.textMuted, lineHeight: 1.5 }}>
          <strong style={{ color: neutral.textPrimary }}>{count}</strong> run{count === 1 ? "" : "s"} and their step logs will be
          permanently deleted. Workflow definitions themselves aren't touched — this can't be undone.
        </div>
        {error && <div style={{ fontSize: fontSize.xxs, color: "#e05a4a" }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: spacing.xs, marginTop: spacing.xxs }}>
          <button
            onClick={onCancel}
            disabled={clearing}
            style={{
              padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs, border: "1px solid rgba(255,255,255,0.15)",
              background: "transparent", color: neutral.textMuted, cursor: clearing ? "default" : "pointer", fontSize: fontSize.xs, fontFamily,
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={clearing}
            style={{
              padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs, border: "1px solid #e05a4a55",
              background: "#e05a4a22", color: "#e05a4a", cursor: clearing ? "default" : "pointer",
              fontSize: fontSize.xs, fontWeight: fontWeight.medium, fontFamily, opacity: clearing ? 0.6 : 1,
            }}
          >
            {clearing ? "Clearing…" : "Clear all"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Recent runs across every workflow in this project — right sidebar's
// secondary pane for Agent Work. Click a run to expand it in place and
// see its step log (JuanJo, 2026-09-01: inline expand, not a separate
// view — matches how sidebar lists already work here).
export function AgentWorkRunHistory() {
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingClearAll, setConfirmingClearAll] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

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

  const handleDeleteRun = async (runId: string) => {
    setDeletingId(runId);
    try {
      await deleteRun(runId);
      refresh();
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAll = async () => {
    setClearing(true);
    setClearError(null);
    try {
      const ok = await deleteAllRuns();
      if (!ok) {
        setClearError("Couldn't clear history — NAVI may be unreachable. Try again.");
        return;
      }
      setConfirmingClearAll(false);
      refresh();
    } finally {
      setClearing(false);
    }
  };

  const header = (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: `${spacing.xs}px ${spacing.sm}px`, borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
    }}>
      <span style={{ fontSize: fontSize.xxs, fontWeight: fontWeight.medium, color: neutral.textMuted, letterSpacing: "0.04em" }}>
        RUN HISTORY
      </span>
      {!!runs?.length && (
        <button
          onClick={() => { setConfirmingClearAll(true); setClearError(null); }}
          title="Clear all run history"
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: `2px ${spacing.xs}px`, borderRadius: radius.xs,
            border: "1px solid rgba(255,255,255,0.12)", background: "transparent",
            color: neutral.textFaint, cursor: "pointer", fontSize: fontSize.xxs, fontFamily,
          }}
        >
          <TrashIcon size={10} /> Clear all
        </button>
      )}
    </div>
  );

  if (runs === null) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily }}>
        {header}
        <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", color: neutral.textFaint, fontSize: fontSize.xs }}>
          Loading…
        </div>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily }}>
        {header}
        <div style={{
          flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: spacing.lg, textAlign: "center", color: neutral.textFaint, gap: spacing.xs,
        }}>
          <HistoryIcon size={18} fill={accent} />
          <div style={{ fontSize: fontSize.xxs }}>No runs yet.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", fontFamily }}>
      {header}
      <div className="hide-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: spacing.xs }}>
        {runs.map(run => (
          <RunRow key={run.id} run={run} deleting={deletingId === run.id} onDelete={() => handleDeleteRun(run.id)} />
        ))}
      </div>
      {confirmingClearAll && (
        <ClearAllConfirmDialog
          count={runs.length} clearing={clearing} error={clearError}
          onCancel={() => { setConfirmingClearAll(false); setClearError(null); }}
          onConfirm={handleClearAll}
        />
      )}
    </div>
  );
}
