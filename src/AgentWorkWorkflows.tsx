import { useCallback, useEffect, useState } from "react";
import { PlayIcon, PlusIcon, CalendarIcon, CommentDiscussionIcon, TrashIcon, AlertIcon } from "@primer/octicons-react";
import { spacing, radius, fontSize, fontWeight, neutral, fontFamily, CANVAS_ACCENT, tintedGlow } from "./tokens";
import { sidebarRow } from "./sidebar-tokens";
import { WORKFLOW_CREATED_EVENT, deleteWorkflow, listRuns, listWorkflows, runWorkflowNow, type AgentRun, type WorkflowDefinition } from "./agentWork";

const accent = CANVAS_ACCENT.agentWork.color;

const STATUS_COLOR: Record<string, string> = {
  completed: "#3ecf8e", running: "#e0b94a", queued: "#e0b94a", failed: "#e05a4a",
};

function formatWhen(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Confirm-before-destroy (2026-09-02, JuanJo, after a workflow he created
// recurred every 5 minutes indefinitely: "make a warning pop up over the
// erase/eliminate button to confirm — we don't want accidents happening").
// A real overlay, not an inline "are you sure" row — a stray second click
// on a spot the row un-expectedly reflows into shouldn't be able to
// confirm a delete it never meant to.
function DeleteConfirmDialog({ name, scheduled, deleting, onCancel, onConfirm }: {
  name: string; scheduled: boolean; deleting: boolean;
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
          <span style={{ fontSize: fontSize.sm, fontWeight: fontWeight.medium }}>Delete this workflow?</span>
        </div>
        <div style={{ fontSize: fontSize.xs, color: neutral.textMuted, lineHeight: 1.5 }}>
          <strong style={{ color: neutral.textPrimary }}>{name}</strong> will be permanently deleted.
          {scheduled && " Its schedule is cancelled immediately — it will not fire again."}
          {" "}Past runs stay in Run History; this can't be undone.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: spacing.xs, marginTop: spacing.xxs }}>
          <button
            onClick={onCancel}
            disabled={deleting}
            style={{
              padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs, border: "1px solid rgba(255,255,255,0.15)",
              background: "transparent", color: neutral.textMuted, cursor: deleting ? "default" : "pointer", fontSize: fontSize.xs, fontFamily,
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            style={{
              padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.xs, border: "1px solid #e05a4a55",
              background: "#e05a4a22", color: "#e05a4a", cursor: deleting ? "default" : "pointer",
              fontSize: fontSize.xs, fontWeight: fontWeight.medium, fontFamily, opacity: deleting ? 0.6 : 1,
            }}
          >
            {deleting ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>
  );
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
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; name: string; scheduled: boolean } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
      // Also refreshes AgentWorkRunHistory's separate sidebar pane —
      // same event, not a new one, since it's the same "something
      // workflow-related just happened" signal.
      window.dispatchEvent(new Event(WORKFLOW_CREATED_EVENT));
    } finally {
      setRunningId(null);
    }
  };

  const confirmDelete = async () => {
    if (!confirmTarget) return;
    setDeletingId(confirmTarget.id);
    try {
      await deleteWorkflow(confirmTarget.id);
      setConfirmTarget(null);
      refresh();
      window.dispatchEvent(new Event(WORKFLOW_CREATED_EVENT));
    } finally {
      setDeletingId(null);
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
        // Wording matters here (2026-09-01, JuanJo: "we must show the
        // user that those 'jobs' exist... no 'forever' wording") — an
        // indefinite schedule and a bounded one used to look identical
        // ("Scheduled" either way), which is exactly the "invisible,
        // perpetually repeating, wasting resources" risk being flagged
        // against. "No expiration set" mirrors the same wording the
        // manual creation form uses for the same field.
        const trigger = wf.trigger;
        const triggerLabel = trigger.type !== "scheduled"
          ? "Manual"
          : trigger.next_run_at == null
            ? "Scheduled · done"
            : trigger.remaining_runs == null
              ? "Scheduled · no expiration set"
              : `Scheduled · ${trigger.remaining_runs} left`;
        return (
          <div key={wf.id} style={{
            padding: `${sidebarRow.paddingV}px ${sidebarRow.paddingH}px`, borderRadius: sidebarRow.radius,
            display: "flex", flexDirection: "column", gap: 4, marginBottom: 2,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing.xs, minWidth: 0 }}>
              <span style={{ fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: neutral.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                {wf.name}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                <button
                  onClick={() => runNow(wf.id)}
                  disabled={runningId === wf.id}
                  title="Run now"
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: `2px ${spacing.xs}px`, borderRadius: radius.xs,
                    border: `1px solid ${accent}55`, background: "transparent",
                    color: accent, cursor: runningId === wf.id ? "default" : "pointer",
                    fontSize: fontSize.xxs, fontFamily, opacity: runningId === wf.id ? 0.5 : 1,
                  }}
                >
                  <PlayIcon size={10} /> {runningId === wf.id ? "Starting…" : "Run"}
                </button>
                <button
                  onClick={() => setConfirmTarget({ id: wf.id, name: wf.name, scheduled })}
                  title="Delete workflow"
                  style={{
                    display: "flex", alignItems: "center", padding: `2px ${spacing.xxs}px`, borderRadius: radius.xs,
                    border: "1px solid rgba(255,255,255,0.1)", background: "transparent",
                    color: neutral.textFaint, cursor: "pointer",
                  }}
                >
                  <TrashIcon size={10} />
                </button>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: spacing.xs, fontSize: fontSize.xxs, color: neutral.textFaint }}>
              <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
                {scheduled && <CalendarIcon size={10} />}
                {triggerLabel}
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
      {confirmTarget && (
        <DeleteConfirmDialog
          name={confirmTarget.name}
          scheduled={confirmTarget.scheduled}
          deleting={deletingId === confirmTarget.id}
          onCancel={() => setConfirmTarget(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
